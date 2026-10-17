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
from .media_utils import display_transform, oriented_image, mux_source_audio


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


def track_spatial_mask(spatial, images, anchor):
    """Advect a cue both ways from its painted frame using backward optical flow.

    Backward flow maps each target pixel to the previous frame. This avoids
    holes from forward splatting. Dense flow is deterministic classical CV;
    there is no network or additional inference service.
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


class AftertakeComposite:
    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {'original': ('IMAGE',), 'generated': ('IMAGE',), 'mask': ('MASK',)}}
    RETURN_TYPES = ('IMAGE',)
    FUNCTION = 'execute'
    CATEGORY = 'Aftertake'

    def execute(self, original, generated, mask):
        if original.shape[0] != generated.shape[0] or mask.shape[0] != original.shape[0]:
            raise ValueError('Frame counts must match; refusing to silently truncate the shot')
        if original.shape != generated.shape:
            generated = F.interpolate(generated.movedim(-1, 1), size=original.shape[1:3], mode='bilinear', align_corners=False).movedim(1, -1)
        if mask.shape[1:3] != original.shape[1:3]:
            mask = F.interpolate(mask[:, None], size=original.shape[1:3], mode='bilinear', align_corners=False)[:, 0]
        alpha = mask.to(device=original.device, dtype=original.dtype).clamp(0, 1)[..., None]
        # Source is bit-exact wherever alpha is zero, before lossy video encoding.
        return (original + alpha * (generated.to(original) - original),)


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
            'audio_start': ('FLOAT', {'default': 0, 'min': 0, 'max': 3600}),
        }, 'hidden': {'prompt': 'PROMPT'}}
    RETURN_TYPES = ()
    FUNCTION = 'execute'
    CATEGORY = 'Aftertake'
    OUTPUT_NODE = True

    def execute(self, images, fps, filename_prefix, recipe_json, prompt=None, source_audio='', audio_start=0):
        import folder_paths
        folder, name, counter, subfolder, _ = folder_paths.get_save_image_path(filename_prefix, folder_paths.get_output_directory())
        filename = f'{name}_{counter:05}_.mp4'
        with av.open(os.path.join(folder, filename), 'w') as container:
            container.metadata['comment'] = json.dumps({'recipe': json.loads(recipe_json), 'workflow': prompt})
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
        # Comfy's v2 proxy recognizes video outputs under the established gifs key.
        return {'ui': {'gifs': [{'filename': filename, 'subfolder': subfolder, 'type': 'output', 'format': 'video/mp4'}]}}


NODE_CLASS_MAPPINGS = {cls.__name__: cls for cls in [AftertakeCueMask, AftertakeLoadClip, AftertakeComposite, AftertakeFilmGrade, AftertakeSaveVideo]}
NODE_DISPLAY_NAME_MAPPINGS = {key: key.replace('Aftertake', 'Aftertake · ') for key in NODE_CLASS_MAPPINGS}
