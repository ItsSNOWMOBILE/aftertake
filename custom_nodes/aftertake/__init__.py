"""Aftertake: editable spatial/temporal cues for open-weight VFX workflows. MIT."""
import hashlib
import json
import math
import os
from fractions import Fraction

import av
import numpy as np
import torch
import torch.nn.functional as F
from .media_utils import display_transform, oriented_image, mux_source_audio, mux_generated_audio


def smoothstep(x):
    return x.clamp(0, 1).square() * (3 - 2 * x.clamp(0, 1))


def export_prompt(prompt):
    """Comfy adds NaN cache sentinels beside node inputs during native loops.

    Cache invalidation is not part of the executable recipe. Preserve the
    actual class/inputs and other graph metadata; reject non-finite inputs.
    """
    if prompt is None:return None
    return {key:{name:value for name,value in node.items() if name!='is_changed'}
            for key,node in prompt.items()}


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


class AftertakeCueMask:
    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {
            'width': ('INT', {'default': 512, 'min': 64, 'max': 4096}),
            'height': ('INT', {'default': 320, 'min': 64, 'max': 4096}),
            'frames': ('INT', {'default': 49, 'min': 1, 'max': 257}),
            'fps': ('FLOAT', {'default': 16, 'min': 1, 'max': 60}),
            'cue_json': ('STRING', {'multiline': True, 'default': '{}'}),
        }, 'optional': {'images': ('IMAGE',)}}
    RETURN_TYPES = ('MASK', 'MASK', 'MASK')
    RETURN_NAMES = ('edit_mask', 'preserve_attention_mask', 'spatial_region')
    FUNCTION = 'execute'
    CATEGORY = 'Aftertake'

    def execute(self, width, height, frames, fps, cue_json, images=None):
        cue = json.loads(cue_json)
        spatial = build_cue_mask(width, height, frames, fps, cue, images, apply_envelope=False)
        mask = temporal_envelope(frames, fps, cue)[:, None, None] * spatial
        return mask, 1 - mask, spatial


class AftertakeLoadClip:
    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {
            'filename': ('STRING', {'default': 'source.mp4'}),
            'width': ('INT', {'default': 512, 'min': 64, 'max': 4096}),
            'height': ('INT', {'default': 320, 'min': 64, 'max': 4096}),
            'frames': ('INT', {'default': 49, 'min': 1, 'max': 257}),
            'fps': ('FLOAT', {'default': 16, 'min': 1, 'max': 60}),
            'trim_start': ('FLOAT', {'default': 0, 'min': 0, 'max': 3600}),
        }}
    RETURN_TYPES = ('IMAGE', 'STRING')
    RETURN_NAMES = ('frames', 'source_audio')
    FUNCTION = 'execute'
    CATEGORY = 'Aftertake'

    @classmethod
    def IS_CHANGED(cls, filename, **kwargs):
        import folder_paths
        digest = hashlib.sha256()
        with open(folder_paths.get_annotated_filepath(filename), 'rb') as stream:
            while chunk := stream.read(1024 * 1024):
                digest.update(chunk)
        return digest.hexdigest()

    def execute(self, filename, width, height, frames, fps, trim_start):
        import folder_paths
        path = os.path.realpath(folder_paths.get_annotated_filepath(filename))
        input_root = os.path.realpath(folder_paths.get_input_directory())
        if os.path.commonpath([path, input_root]) != input_root:
            raise ValueError('Source must be in the ComfyUI input directory')
        return decode_clip(path, width, height, frames, fps, trim_start), path


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


class AftertakeCropRegion:
    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {'images': ('IMAGE',), **{name: ('INT', {'default': 0 if name in ('x','y') else 64, 'min': 0 if name in ('x','y') else 1, 'max': 16384}) for name in ('x','y','width','height','target_width','target_height')}}}
    RETURN_TYPES = ('IMAGE',)
    FUNCTION = 'execute'
    CATEGORY = 'Aftertake'

    def execute(self, images, x, y, width, height, target_width, target_height):
        if min(x,y)<0 or min(width,height,target_width,target_height)<1 or x+width>images.shape[2] or y+height>images.shape[1]:
            raise ValueError('Keep the complete focus region inside the source frame')
        cropped=images[:,y:y+height,x:x+width]
        return (F.interpolate(cropped.movedim(-1,1),size=(target_height,target_width),mode='bicubic',align_corners=False).movedim(1,-1).clamp(0,1),)


class AftertakeRestoreRegion:
    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {'original': ('IMAGE',), 'generated': ('IMAGE',), **{name: ('INT', {'default': 0 if name in ('x','y') else 64, 'min': 0 if name in ('x','y') else 1, 'max': 16384}) for name in ('x','y','width','height')}}}
    RETURN_TYPES = ('IMAGE',)
    FUNCTION = 'execute'
    CATEGORY = 'Aftertake'

    def execute(self, original, generated, x, y, width, height):
        if min(x,y)<0 or min(width,height)<1 or x+width>original.shape[2] or y+height>original.shape[1]:
            raise ValueError('Keep the complete focus region inside the source frame')
        if original.shape[0]!=generated.shape[0]:raise ValueError('Focused generation must retain the complete source frame clock')
        restored=original.clone()
        region=F.interpolate(generated.movedim(-1,1),size=(height,width),mode='bicubic',align_corners=False).movedim(1,-1).to(original).clamp(0,1)
        restored[:,y:y+height,x:x+width]=region
        return (restored,)


class AftertakeComposite:
    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {'original': ('IMAGE',), 'generated': ('IMAGE',), 'mask': ('MASK',)},
            'optional': {'match_color': ('BOOLEAN', {'default': False}), 'spatial_mask': ('MASK',)}}
    RETURN_TYPES = ('IMAGE',)
    FUNCTION = 'execute'
    CATEGORY = 'Aftertake'

    def execute(self, original, generated, mask, match_color=False, spatial_mask=None):
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
        return (original + alpha * (generated - original),)


class AftertakeFilmGrade:
    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {'images': ('IMAGE',), 'palette': (['source', 'warm', 'cool', 'monochrome'],)}}
    RETURN_TYPES = ('IMAGE',)
    FUNCTION = 'execute'
    CATEGORY = 'Aftertake'

    def execute(self, images, palette):
        if palette == 'source':
            return (images,)
        luma = (images[..., :3] * images.new_tensor([.2126, .7152, .0722])).sum(-1, keepdim=True)
        if palette == 'monochrome':
            return (luma.expand_as(images),)
        red, green, blue = images[..., 0], images[..., 1], images[..., 2]
        shadow = 1 - luma[..., 0]
        if palette == 'warm':
            graded = torch.stack((red * 1.04 + .025 * shadow, green, blue * .92), -1)
        elif palette == 'cool':
            graded = torch.stack((red * .92, green, blue * 1.04 + .02 * shadow), -1)
        else:
            raise ValueError('Unknown film grade')
        return (graded.clamp(0, 1),)


class AftertakeSaveVideo:
    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {
            'images': ('IMAGE',), 'fps': ('FLOAT', {'default': 16, 'min': 1, 'max': 60}),
            'filename_prefix': ('STRING', {'default': 'aftertake/shot'}),
            'recipe_json': ('STRING', {'default': '{}', 'multiline': True}),
        }, 'optional': {
            'source_audio': ('STRING', {'default': ''}),
            'generated_audio': ('AUDIO',),
            'audio_start': ('FLOAT', {'default': 0, 'min': 0, 'max': 3600}),
            'display_width': ('INT', {'default': 0, 'min': 0, 'max': 4096}),
            'display_height': ('INT', {'default': 0, 'min': 0, 'max': 4096}),
        }, 'hidden': {'prompt': 'PROMPT'}}
    RETURN_TYPES = ()
    FUNCTION = 'execute'
    CATEGORY = 'Aftertake'
    OUTPUT_NODE = True

    def execute(self, images, fps, filename_prefix, recipe_json, prompt=None, source_audio='', audio_start=0, display_width=0, display_height=0, generated_audio=None):
        import folder_paths
        if source_audio and generated_audio is not None:
            raise ValueError('Choose either source sound or generated audio for this output.')
        if bool(display_width) != bool(display_height) or display_width%2 or display_height%2:
            raise ValueError('Display geometry needs two even dimensions')
        if display_width and (images.shape[2]!=display_width or images.shape[1]!=display_height):
            images=F.interpolate(images.movedim(-1,1),size=(display_height,display_width),mode='bicubic',align_corners=False).movedim(1,-1)
        folder, name, counter, subfolder, _ = folder_paths.get_save_image_path(filename_prefix, folder_paths.get_output_directory())
        filename = f'{name}_{counter:05}_.mp4'
        with av.open(os.path.join(folder, filename), 'w') as container:
            container.metadata['comment'] = json.dumps({'recipe': json.loads(recipe_json), 'workflow': export_prompt(prompt)},allow_nan=False)
            stream = container.add_stream('libx264', rate=Fraction(str(fps)))
            stream.width, stream.height = images.shape[2], images.shape[1]
            stream.pix_fmt = 'yuv420p'
            stream.options = {'crf': '17', 'preset': 'fast'}
            for image in images:
                pixels = (image[..., :3].detach().cpu().clamp(0, 1).numpy() * 255).round().astype(np.uint8)
                for packet in stream.encode(av.VideoFrame.from_ndarray(pixels, format='rgb24')):
                    container.mux(packet)
            for packet in stream.encode():
                container.mux(packet)
        if source_audio:
            source = os.path.realpath(source_audio)
            input_root = os.path.realpath(folder_paths.get_input_directory())
            if os.path.commonpath([source, input_root]) != input_root:
                raise ValueError('Audio source must be in the ComfyUI input directory')
            mux_source_audio(os.path.join(folder, filename), source, audio_start, len(images) / fps)
        elif generated_audio is not None:
            mux_generated_audio(os.path.join(folder, filename), generated_audio, len(images) / fps)
        # Comfy's v2 proxy recognizes video outputs under the established gifs key.
        return {'ui': {'gifs': [{'filename': filename, 'subfolder': subfolder, 'type': 'output', 'format': 'video/mp4'}]}}


NODE_CLASS_MAPPINGS = {cls.__name__: cls for cls in [AftertakeCueMask, AftertakeLoadClip, AftertakeCropRegion, AftertakeRestoreRegion, AftertakeComposite, AftertakeFilmGrade, AftertakeSaveVideo]}
from .character_nodes import CHARACTER_NODES
from .memory_compat import install as install_safe_weight_copies
install_safe_weight_copies()
NODE_CLASS_MAPPINGS.update(CHARACTER_NODES)
NODE_DISPLAY_NAME_MAPPINGS = {key: key.replace('Aftertake', 'Aftertake · ') for key in NODE_CLASS_MAPPINGS}
