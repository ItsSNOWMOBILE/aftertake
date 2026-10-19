"""Shared Aftertake cue, optical-flow and composition math. MIT.

Imports CPU-capable media/tensor libraries only; no Comfy or model modules.
Native custom nodes re-export these functions without changing their contracts.
"""
import av
import numpy as np
import torch
import torch.nn.functional as F

if __package__:
    from .media_utils import display_transform, oriented_image
else:
    from media_utils import display_transform, oriented_image


def smoothstep(x):
    return x.clamp(0, 1).square() * (3 - 2 * x.clamp(0, 1))


def decode_clip(path, width, height, frames, fps, trim_start):
    def pixels(frame):
        if display_transform(frame) is None:
            array = frame.reformat(width=width, height=height, format='rgb24').to_ndarray()
        else:
            from PIL import Image
            array = np.asarray(oriented_image(frame).resize((width, height), Image.Resampling.BICUBIC))
        return torch.from_numpy(array.copy()).float() / 255

    selected, next_time, last, last_decoded = [], trim_start, None, None
    with av.open(str(path)) as container:
        stream = container.streams.video[0]
        origin = float(stream.start_time * stream.time_base) if stream.start_time else 0
        duration = float(stream.duration * stream.time_base) if stream.duration else float(container.duration or 0) / av.time_base
        if trim_start > 0:
            container.seek(int((trim_start + origin) * av.time_base), backward=True)
        for frame in container.decode(video=0):
            last_decoded = frame
            timestamp = float(frame.time or 0) - origin
            if timestamp + 1e-6 < next_time:
                continue
            last = pixels(frame)
            while timestamp + 1e-6 >= next_time and len(selected) < frames:
                selected.append(last)
                next_time = trim_start + len(selected) / fps
            if len(selected) == frames:
                break
        # A time inside the final frame's display interval has no later PTS.
        # Hold that frame, as the browser and full-frame export do.
        if last is None and last_decoded is not None and trim_start < duration:
            last = pixels(last_decoded)
    if last is None:
        raise ValueError('No decodable frames in the selected source range')
    while len(selected) < frames:
        selected.append(last)
    return torch.stack(selected)


def camera_flow(target, previous, grid_x, grid_y):
    """Estimate a conservative camera prior where dense flow has no texture.

    Require distributed, agreeing feature tracks; reject estimates supported
    only in one small region. Return no prior when evidence is sparse or the
    inter-frame transform is implausibly large.
    """
    import cv2
    points = cv2.goodFeaturesToTrack(target, maxCorners=600, qualityLevel=.01, minDistance=8, blockSize=7)
    if points is None or len(points) < 16:
        return None
    matches, status, errors = cv2.calcOpticalFlowPyrLK(target, previous, points, None,
        winSize=(25, 25), maxLevel=4,
        criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 30, .01))
    if matches is None or status is None or errors is None:
        return None
    good = (status.ravel() == 1) & (errors.ravel() < 25) & np.isfinite(matches).all(axis=(1, 2))
    source, destination = points[good], matches[good]
    if len(source) < 16:
        return None
    affine, inliers = cv2.estimateAffinePartial2D(source, destination, method=cv2.RANSAC,
        ransacReprojThreshold=1.5, maxIters=1000, confidence=.99, refineIters=10)
    if affine is None or inliers is None or inliers.sum() < 16 or inliers.mean() < .65:
        return None
    reliable = source[inliers.ravel().astype(bool), 0, :]
    height, width = target.shape
    if np.ptp(reliable[:, 0]) < width * .4 or np.ptp(reliable[:, 1]) < height * .4:
        return None
    scale = np.linalg.norm(affine[0, :2])
    if not .9 <= scale <= 1.1 or abs(affine[0, 2]) > width * .12 or abs(affine[1, 2]) > height * .12:
        return None
    return np.stack([affine[0, 0] * grid_x + affine[0, 1] * grid_y + affine[0, 2] - grid_x,
                     affine[1, 0] * grid_x + affine[1, 1] * grid_y + affine[1, 2] - grid_y], axis=-1).astype(np.float32)


def track_spatial_mask(spatial, images, anchor):
    """Advect a cue both ways from its painted frame using backward optical flow.

    Backward flow maps each target pixel to the previous frame. This avoids
    holes from forward splatting. Low-detail areas can use a guarded camera
    prior. Both are classical CV, without a network or inference service.
    """
    import cv2
    source = (images.detach().cpu().clamp(0, 1).numpy() * 255).round().astype(np.uint8)
    gray = [cv2.cvtColor(image[..., :3], cv2.COLOR_RGB2GRAY) for image in source]
    count, height, width = len(gray), spatial.shape[0], spatial.shape[1]
    anchor = max(0, min(count - 1, anchor))
    tracked = np.zeros((count, height, width), dtype=np.float32)
    tracked[anchor] = spatial.numpy()
    grid_y, grid_x = np.mgrid[0:height, 0:width].astype(np.float32)
    for indices in [range(anchor + 1, count), range(anchor - 1, -1, -1)]:
        for index in indices:
            previous = index - 1 if index > anchor else index + 1
            flow = cv2.calcOpticalFlowFarneback(gray[index], gray[previous], None,
                                             .5, 4, 25, 5, 7, 1.5, 0)
            camera = camera_flow(gray[index], gray[previous], grid_x, grid_y)
            if camera is not None:
                # The small structure-tensor eigenvalue detects the aperture
                # problem too: one straight edge cannot determine 2D motion.
                texture = cv2.cornerMinEigenVal(gray[index], blockSize=15, ksize=3)
                weight = np.clip(texture / .00025, 0, 1)[..., None]
                flow = flow * weight + camera * (1 - weight)
            tracked[index] = cv2.remap(tracked[previous], grid_x + flow[..., 0], grid_y + flow[..., 1],
                                       interpolation=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    return torch.from_numpy(tracked).clamp(0, 1)


def temporal_envelope(frames, fps, cue):
    times = torch.arange(frames, dtype=torch.float32) / fps
    start, end = cue['start'], cue['end']
    fade = min(max(0, cue['fade']), (end - start) / 2)
    active = ((times >= start) & (times <= end)).float()
    return active if fade == 0 else active * smoothstep(torch.minimum((times - start) / fade, (end - times) / fade))


def build_cue_mask(width, height, frames, fps, cue, images=None, apply_envelope=True):
    """Normalized brush paths; radius and feather are fractions of the SHORT edge.

    Evaluate distance to line segments, rather than sampled points, so sparsely
    sampled pointer motion cannot leave holes. A soft spatial edge and temporal
    envelope use the same semantics as the editor preview.
    """
    if not (0 <= cue['start'] < cue['end']) or fps <= 0:
        raise ValueError('Invalid cue interval or frame rate')
    if not cue.get('strokes'):
        raise ValueError('Draw at least one region')
    short = min(width, height)
    yy, xx = torch.meshgrid(torch.arange(height) + 0.5, torch.arange(width) + 0.5, indexing='ij')
    spatial = torch.zeros(height, width)
    feather = max(0.001, cue['feather']) * short
    for stroke in cue['strokes']:
        points = stroke['points']
        if not points:
            continue
        radius = stroke['radius'] * short
        distance = torch.full((height, width), float('inf'))
        pairs = zip(points[:-1], points[1:]) if len(points) > 1 else [(points[0], points[0])]
        for a, b in pairs:
            ax, ay, bx, by = a['x'] * width, a['y'] * height, b['x'] * width, b['y'] * height
            dx, dy = bx - ax, by - ay
            t = ((xx - ax) * dx + (yy - ay) * dy) / max(dx * dx + dy * dy, 1e-12)
            t = t.clamp(0, 1)
            segment = ((xx - ax - t * dx).square() + (yy - ay - t * dy).square()).sqrt()
            distance = torch.minimum(distance, segment)
        stroke_mask = 1 - smoothstep((distance - radius + feather) / feather)
        spatial = spatial * (1 - stroke_mask) if stroke.get('mode') == 'erase' else torch.maximum(spatial, stroke_mask)
    if cue.get('tracking', 'static') == 'flow':
        if images is None or images.shape[:3] != (frames, height, width):
            raise ValueError('Motion tracking requires source frames matching the cue dimensions')
        spatial = track_spatial_mask(spatial, images, round(cue.get('anchor', 0) * fps))
    if spatial.ndim == 2:
        spatial = spatial.unsqueeze(0).expand(frames, -1, -1)
    return temporal_envelope(frames, fps, cue)[:, None, None] * spatial if apply_envelope else spatial


def match_boundary_color(original, generated, spatial):
    """Extend source-minus-generation boundary color smoothly into the edit.

    Solve a low-resolution harmonic correction, retaining generated texture
    and detail. Spatial masks keep the correction independent of temporal fades.
    Final alpha compositing still preserves every unpainted source pixel.
    """
    import cv2
    source=original.detach().cpu().numpy()
    target=generated.detach().cpu().numpy()
    regions=spatial.detach().cpu().numpy()
    height,width=source.shape[1:3]
    scale=min(1,64/max(width,height));size=(max(4,round(width*scale)),max(4,round(height*scale)))
    corrections=[]
    for a,b,mask in zip(source,target,regions):
        delta=cv2.resize(a-b,size,interpolation=cv2.INTER_AREA)
        delta=cv2.GaussianBlur(delta,(0,0),.8)
        inside=cv2.resize(mask,size,interpolation=cv2.INTER_AREA)>.01
        if not inside.any() or inside.all():
            corrections.append(np.zeros_like(b));continue
        ring=cv2.dilate(inside.astype(np.uint8),np.ones((3,3),np.uint8)).astype(bool)&~inside
        correction=delta.copy();correction[inside]=np.median(delta[ring],axis=0)
        for _ in range(400):
            smoothed=cv2.blur(correction,(3,3),borderType=cv2.BORDER_REFLECT)
            correction[inside]=smoothed[inside]
        corrections.append(cv2.resize(correction,(width,height),interpolation=cv2.INTER_LINEAR).clip(-.15,.15))
    return (generated+torch.from_numpy(np.stack(corrections)).to(generated)).clamp(0,1)


def composite_images(original, generated, mask, match_color=False, spatial_mask=None):
    if original.shape[0] != generated.shape[0] or mask.shape[0] != original.shape[0]:
        raise ValueError('Frame counts must match; refusing to silently truncate the shot')
    if original.shape != generated.shape:
        generated = F.interpolate(generated.movedim(-1, 1), size=original.shape[1:3], mode='bilinear', align_corners=False).movedim(1, -1)
    if mask.shape[1:3] != original.shape[1:3]:
        mask = F.interpolate(mask[:, None], size=original.shape[1:3], mode='bilinear', align_corners=False)[:, 0]
    generated=generated.to(original)
    if match_color:
        spatial=spatial_mask if spatial_mask is not None else mask / mask.amax(dim=(1,2),keepdim=True).clamp_min(1e-6)
        if spatial.shape != mask.shape:
            raise ValueError('Spatial color-match masks must match the composite mask')
        generated=match_boundary_color(original,generated,spatial)
    alpha = mask.to(device=original.device, dtype=original.dtype).clamp(0, 1)[..., None]
    # Source is bit-exact wherever alpha is zero, before lossy video encoding.
    return original + alpha * (generated - original)
