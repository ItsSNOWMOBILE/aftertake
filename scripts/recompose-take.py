"""Recompose verified completed video on the CPU; never load models or Comfy.

The original generation workflow is retained as provenance, not executed here.
Only the final composite region and boundary-color matching may change.
"""
import hashlib
import json
import math
import os
from pathlib import Path
import sys
import tempfile
from fractions import Fraction
from copy import deepcopy

import av
import numpy as np
import torch
import torch.nn.functional as F

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'custom_nodes/aftertake'))
from composite_math import build_cue_mask, composite_images, decode_clip, temporal_envelope
from media_utils import mux_source_audio

PROCESSOR = 'aftertake-cpu-recomposition/1'
POLICY = 'aftertake-native-final-composite/1'
CHUNK = 8


def file_hash(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)


def generation_identity(recipe):
    """Bind tensor inputs by content/geometry, not workspace display metadata."""
    result = deepcopy({key: value for key, value in recipe.items()
                       if key not in {'compositeRegion', 'matchSourceColor'}})
    roles = [('clip',), ('editReference',), ('endFrame',), ('transfer', 'reference'),
             ('transfer', 'finish', 'generation'), ('transfer', 'finish', 'matte')]
    for role in roles:
        parent = result
        for key in role[:-1]:
            parent = parent.get(key) if isinstance(parent, dict) else None
        value = parent.get(role[-1]) if isinstance(parent, dict) else None
        if isinstance(value, dict):
            parent[role[-1]] = {key: value.get(key) for key in ('sha256', 'width', 'height', 'duration')}
            parent[role[-1]]['kind'] = value.get('kind', 'video')
    return canonical(result)


def finite(value, low, high, name):
    if type(value) not in (int, float) or not math.isfinite(value) or not low <= value <= high:
        raise ValueError(f'{name} must be finite and between {low} and {high}.')
    return value


def validate_cue(cue, region=False):
    allowed = {'feather', 'tracking', 'anchor', 'strokes'}
    if not region:
        allowed |= {'start', 'end', 'fade'}
    if not isinstance(cue, dict) or set(cue) - allowed:
        raise ValueError('Use a supported painted cue object.')
    if not region:
        finite(cue.get('start'), 0, 12, 'Cue start')
        finite(cue.get('end'), 0, 12, 'Cue end')
        finite(cue.get('fade'), 0, 2, 'Cue fade')
        if cue['end'] <= cue['start']:
            raise ValueError('Cue end must follow its start.')
    finite(cue.get('feather'), .001, .2, 'Cue feather')
    if cue.get('tracking', 'static') not in ('static', 'flow'):
        raise ValueError('Choose static or flow tracking.')
    if 'anchor' in cue:
        finite(cue['anchor'], 0, 12, 'Cue anchor')
    strokes = cue.get('strokes')
    if not isinstance(strokes, list) or not 1 <= len(strokes) <= 100:
        raise ValueError('Draw between one and one hundred strokes.')
    for stroke in strokes:
        if not isinstance(stroke, dict) or set(stroke) - {'points', 'radius', 'mode'}:
            raise ValueError('Use a supported brush stroke.')
        finite(stroke.get('radius'), .005, .5, 'Stroke radius')
        if stroke.get('mode', 'paint') not in ('paint', 'erase'):
            raise ValueError('Choose paint or erase.')
        points = stroke.get('points')
        if not isinstance(points, list) or not 1 <= len(points) <= 300:
            raise ValueError('A stroke needs between one and three hundred points.')
        for point in points:
            if not isinstance(point, dict) or set(point) != {'x', 'y'}:
                raise ValueError('A brush point needs normalized x and y.')
            finite(point['x'], 0, 1, 'Point x')
            finite(point['y'], 0, 1, 'Point y')
    if not any(stroke.get('mode') != 'erase' for stroke in strokes):
        raise ValueError('Paint at least one region.')


def expected_dimensions(recipe):
    clip = recipe.get('clip', {})
    width = finite(clip.get('width'), 1, 16384, 'Source width')
    height = finite(clip.get('height'), 1, 16384, 'Source height')
    duration = finite(clip.get('duration'), .04, 36000, 'Source duration')
    trim = finite(recipe.get('trimStart'), 0, 3600, 'Source trim')
    if duration - trim < .6:
        raise ValueError('The selected source range is too short.')
    quality = recipe.get('quality')
    if quality not in ('draft', 'final'):
        raise ValueError('Choose draft or final quality.')
    fps, maximum, edge = (16, 49, 512) if quality == 'draft' else (24, 97, 768)
    frames = min(maximum, math.floor(((duration - trim) * fps - 1) / 8) * 8 + 1)
    ratio = width / height
    if recipe.get('resolution') == '720p':
        if quality != 'final' or abs(math.log(max(ratio, 1 / ratio) / (16 / 9))) >= .01:
            raise ValueError('The 720p finish needs final quality and a 16:9 source.')
        w, h = (1280, 720) if ratio >= 1 else (720, 1280)
        return dict(width=w, height=h, frames=frames, fps=fps,
            displayWidth=w, displayHeight=h,
            rawWidth=math.ceil(w / 32) * 32, rawHeight=math.ceil(h / 32) * 32)
    rounded = lambda value: math.floor(value + .5)
    w = max(64, rounded((edge if ratio >= 1 else edge * ratio) / 32) * 32)
    h = max(64, rounded((edge / ratio if ratio >= 1 else edge) / 32) * 32)
    return dict(width=w, height=h, frames=frames, fps=fps,
        displayWidth=w if ratio >= 1 else max(2, rounded(h * ratio / 2) * 2),
        displayHeight=max(2, rounded(w / ratio / 2) * 2) if ratio >= 1 else h)


def validate_work(work):
    fields = {'format', 'source', 'raw', 'output', 'receipt', 'expected',
              'originalRecipe', 'newRecipe', 'dimensions', 'originalGenerationWorkflow'}
    if not isinstance(work, dict) or set(work) != fields or work['format'] != 'aftertake-recompose-work/1':
        raise ValueError('Use a complete internal recomposition work request.')
    for name in ('source', 'raw', 'output', 'receipt'):
        if not isinstance(work[name], str) or not work[name]:
            raise ValueError('Recomposition needs resolved local media paths.')
    paths = [Path(work[name]).resolve() for name in ('source', 'raw', 'output', 'receipt')]
    if len(set(paths)) != len(paths) or not all(path.is_file() for path in paths[:2]):
        raise ValueError('Keep existing input media and separate output/receipt files.')
    expected = work['expected']
    if not isinstance(expected, dict) or set(expected) != {'sourceSha256', 'rawSha256'}:
        raise ValueError('Bind both original input hashes.')
    import re
    if not all(isinstance(value, str) and re.fullmatch('[a-f0-9]{64}', value) for value in expected.values()):
        raise ValueError('Use complete SHA-256 input bindings.')
    original, revised = work['originalRecipe'], work['newRecipe']
    if not isinstance(original, dict) or not isinstance(revised, dict):
        raise ValueError('Keep the original generation recipe and revised final controls.')
    if generation_identity(original) != generation_identity(revised):
        raise ValueError('Only compositeRegion and matchSourceColor may change after generation.')
    for recipe in (original, revised):
        if recipe.get('format') != 'aftertake/1' or recipe.get('pipeline', 'structure') not in ('structure', 'inpaint'):
            raise ValueError('Recomposition supports completed region VFX and masked edits.')
        if recipe.get('clip', {}).get('kind', 'video') == 'image':
            raise ValueError('Recomposition requires a source video.')
        if recipe.get('clip', {}).get('sha256') != expected['sourceSha256']:
            raise ValueError('The recipe source hash differs from the original media binding.')
        if 'matchSourceColor' in recipe and type(recipe['matchSourceColor']) is not bool:
            raise ValueError('Boundary color matching must be boolean.')
        validate_cue(recipe.get('cue'))
        if 'compositeRegion' in recipe:
            validate_cue(recipe['compositeRegion'], region=True)
    dimensions = work['dimensions']
    if (not isinstance(dimensions, dict) or
            any(type(value) is not int for value in dimensions.values()) or
            dimensions != expected_dimensions(original)):
        raise ValueError('Recomposition geometry must match the native generation recipe.')
    graph = work['originalGenerationWorkflow']
    if not isinstance(graph, dict) or not graph:
        raise ValueError('Keep the actual original generation workflow as provenance.')
    canonical(graph)
    for name, binding in [('source', 'sourceSha256'), ('raw', 'rawSha256')]:
        if file_hash(work[name]) != expected[binding]:
            raise ValueError('An original recomposition input has changed on disk.')
    return work


def pyramid_blend(raw, plate, mask):
    """Standard Laplacian blending using Kornia's Apache-2.0 public functions.

    Independently implemented wrapper; no LTX extension code is included or
    imported. Padding, seven-level cap and 64px mask dilation match the native
    final-inpainting policy, checked against the separately installed reference.
    """
    from kornia.geometry.transform.pyramid import build_laplacian_pyramid, build_pyramid, PyrUp
    a, b, region = raw.movedim(-1, 1), plate.movedim(-1, 1), mask[:, None]
    height, width = a.shape[-2:]
    padded_h, padded_w = 1 << (height - 1).bit_length(), 1 << (width - 1).bit_length()
    level = min(7, int(math.log2(min(padded_h, padded_w))))
    ratio = 64 / max(height, width)
    small = (max(1, round(height * ratio)), max(1, round(width * ratio)))
    dilated = F.interpolate(region.float(), size=small, mode='bilinear', align_corners=False)
    dilated = F.max_pool2d(dilated, kernel_size=13, stride=1, padding=6)
    dilated = F.interpolate(dilated, size=(height, width), mode='bilinear', align_corners=False)
    padding = (0, padded_w - width, 0, padded_h - height)
    if any(padding):
        a, b, dilated = [F.pad(value, padding, mode='reflect') for value in (a, b, dilated)]
    left = build_laplacian_pyramid(a, max_level=level)
    right = build_laplacian_pyramid(b, max_level=level)
    weights = build_pyramid(dilated, level, 'reflect', False)
    result = left[-1] * weights[-1] + right[-1] * (1 - weights[-1])
    expand = PyrUp()
    for index in range(len(left) - 2, -1, -1):
        detail = left[index] * weights[index] + right[index] * (1 - weights[index])
        result = expand(result) + detail
    return result[..., :height, :width].clamp(0, 1).movedim(1, -1)


def checked_raw_frames(path, dimensions):
    with av.open(str(path)) as movie:
        if len(movie.streams.video) != 1:
            raise ValueError('The raw generation needs exactly one video stream.')
        stream = movie.streams.video[0]
        raw_width = dimensions.get('rawWidth', dimensions['width'])
        raw_height = dimensions.get('rawHeight', dimensions['height'])
        if (stream.width, stream.height) != (raw_width, raw_height):
            raise ValueError('The raw generation dimensions differ from its recipe.')
        count = 0
        for frame in movie.decode(video=0):
            if count >= dimensions['frames'] or frame.pts is None or abs(float(frame.pts * frame.time_base) - count / dimensions['fps']) > 1e-6:
                raise ValueError('The raw generation frame clock differs from its recipe.')
            count += 1
            pixels = frame.to_ndarray(format='rgb24')
            # HD raw takes retain the model's padded latent canvas. Remove
            # only that padding; no resize of the original or generated pixels.
            left = (raw_width - dimensions['width']) // 2
            top = (raw_height - dimensions['height']) // 2
            pixels = pixels[top:top + dimensions['height'], left:left + dimensions['width']]
            yield torch.from_numpy(pixels.copy()).float() / 255
        if count != dimensions['frames']:
            raise ValueError('The raw generation is incomplete; refusing to hold or drop raw frames.')


def final_cue(recipe):
    cue = dict(recipe['cue'])
    if recipe.get('compositeRegion'):
        region = recipe['compositeRegion']
        cue.update({**region, 'tracking': region.get('tracking', 'static'), 'anchor': region.get('anchor', 0)})
    return cue


def spatial_mask(source, width, height, frames, fps, trim, cue):
    if cue.get('tracking', 'static') == 'flow':
        # Whole-shot context preserves bidirectional native flow and its anchor.
        # Native recipe bounds cap this at 97 frames and a 768px working edge.
        images = decode_clip(source, width, height, frames, fps, trim)
        return build_cue_mask(width, height, frames, fps, cue, images, apply_envelope=False)
    return build_cue_mask(width, height, 1, fps, cue, apply_envelope=False)


def run(work):
    validate_work(work)
    dimensions = work['dimensions']
    width, height, count, fps = [dimensions[key] for key in ('width', 'height', 'frames', 'fps')]
    display_w, display_h = dimensions['displayWidth'], dimensions['displayHeight']
    recipe, source, raw = work['newRecipe'], work['source'], work['raw']
    separate = bool(recipe.get('compositeRegion'))
    target_w, target_h = (display_w, display_h) if separate else (width, height)
    trim = recipe['trimStart']
    cue = final_cue(recipe)
    envelope = temporal_envelope(count, fps, cue)
    spatial = spatial_mask(source, target_w, target_h, count, fps, trim, cue)
    uses_pyramid = recipe.get('pipeline') == 'inpaint' and recipe['quality'] == 'final' and not recipe.get('matchSourceColor', False)
    generation_region = spatial_mask(source, width, height, count, fps, trim, recipe['cue']) if uses_pyramid else None
    stages = ['source-clock-sampling']
    if uses_pyramid:
        stages.append('final-inpaint-laplacian-blend')
    stages.append('display-grid-final-mask' if separate else 'working-grid-final-mask')
    if recipe.get('matchSourceColor', False):
        stages.append('boundary-color-match')
    if not separate and (target_w, target_h) != (display_w, display_h):
        stages.append('display-bicubic')
    output, receipt = Path(work['output']), Path(work['receipt'])
    output.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix='aftertake-recompose-', suffix='.mp4', dir=output.parent)
    os.close(descriptor)
    temporary = Path(temporary)
    protected_exact = True
    raw_iterator = iter(checked_raw_frames(raw, dimensions))
    try:
        with av.open(str(temporary), 'w') as movie:
            movie.metadata['comment'] = canonical({'processor': PROCESSOR, 'recipe': recipe,
                'originalRecipe': work['originalRecipe'], 'originalGenerationWorkflow': work['originalGenerationWorkflow'],
                'noModelInvocation': True, 'noComfyGraphExecution': True})
            stream = movie.add_stream('libx264', rate=fps)
            stream.width, stream.height, stream.pix_fmt = display_w, display_h, 'yuv420p'
            stream.options = {'crf': '17', 'preset': 'fast', 'threads': '2'}
            for start in range(0, count, CHUNK):
                stop = min(count, start + CHUNK)
                generated = torch.stack([next(raw_iterator) for _ in range(stop - start)])
                original = decode_clip(source, target_w, target_h, stop - start, fps, trim + start / fps)
                region = spatial.expand(stop - start, -1, -1) if spatial.shape[0] == 1 else spatial[start:stop]
                if uses_pyramid:
                    working = original if (target_w, target_h) == (width, height) else decode_clip(source, width, height, stop - start, fps, trim + start / fps)
                    generation = generation_region.expand(stop - start, -1, -1) if generation_region.shape[0] == 1 else generation_region[start:stop]
                    hole = (generation > .01).float()[..., None]
                    plate = working * (1 - hole) + working.new_tensor([102 / 255, 1, 0]) * hole
                    generated = pyramid_blend(generated, plate, generation)
                alpha = region * envelope[start:stop, None, None]
                composed = composite_images(original, generated, alpha, recipe.get('matchSourceColor', False), region)
                protected_exact &= torch.equal(composed[alpha == 0], original[alpha == 0])
                if (target_w, target_h) != (display_w, display_h):
                    composed = F.interpolate(composed.movedim(-1, 1), size=(display_h, display_w), mode='bicubic', align_corners=False).movedim(1, -1)
                for offset, picture in enumerate(composed):
                    pixels = (picture[..., :3].clamp(0, 1).numpy() * 255).round().astype(np.uint8)
                    frame = av.VideoFrame.from_ndarray(pixels, format='rgb24')
                    frame.pts, frame.time_base = start + offset, Fraction(1, fps)
                    for packet in stream.encode(frame):
                        movie.mux(packet)
            # Exhausting checks both a truncated and an unexpectedly long raw.
            try:
                next(raw_iterator)
                raise ValueError('The raw generation has unexpected extra frames.')
            except StopIteration:
                pass
            for packet in stream.encode():
                movie.mux(packet)
        has_audio = mux_source_audio(temporary, source, trim, count / fps)
        if has_audio:
            stages.append('source-audio-mux')
        for name, binding in [('source', 'sourceSha256'), ('raw', 'rawSha256')]:
            if file_hash(work[name]) != work['expected'][binding]:
                raise ValueError('An original input changed during recomposition.')
        result = {'format': PROCESSOR, 'processor': PROCESSOR, 'outputSha256': file_hash(temporary),
            'width': display_w, 'height': display_h, 'frames': count, 'fps': fps,
            'duration': count / fps, 'hasAudio': has_audio, **work['expected'],
            'newRecipe': recipe, 'originalRecipe': work['originalRecipe'],
            'originalGenerationWorkflow': work['originalGenerationWorkflow'],
            'compositionPolicy': POLICY, 'stages': stages,
            'allProtectedPixelsExactBeforeEncoding': bool(protected_exact),
            'protectedPixelsReference': 'display-grid-source' if separate else 'working-grid-source-before-display-resize',
            'noModelInvocation': True, 'noComfyGraphExecution': True}
        os.replace(temporary, output)
        receipt.parent.mkdir(parents=True, exist_ok=True)
        receipt.write_text(json.dumps(result, indent=2, allow_nan=False) + '\n', encoding='utf-8')
        return result
    finally:
        raw_iterator.close()
        temporary.unlink(missing_ok=True)


def main():
    if len(sys.argv) == 2 and sys.argv[1] == '--check':
        import cv2
        import kornia
        print(json.dumps({'ready': True, 'processor': PROCESSOR, 'device': 'cpu',
            'libraries': {'torch': torch.__version__, 'opencv': cv2.__version__, 'kornia': kornia.__version__},
            'modelWeightsAllocated': False, 'comfyImported': False}))
        return
    if len(sys.argv) != 2:
        raise ValueError('Choose --check or one internal work JSON file.')
    path = Path(sys.argv[1])
    if path.stat().st_size > 2 * 1024 * 1024:
        raise ValueError('Use an internal work request of at most 2 MiB.')
    work = json.loads(path.read_text(encoding='utf-8'))
    torch.set_num_threads(2)
    with torch.inference_mode(), torch.device('cpu'):
        result = run(work)
        # The complete, content-bound receipt is persisted and validated by the
        # parent. Keep process diagnostics bounded even for large saved graphs.
        print(json.dumps({key: result[key] for key in (
            'processor', 'outputSha256', 'width', 'height', 'frames', 'fps',
            'hasAudio', 'noModelInvocation', 'noComfyGraphExecution')}, allow_nan=False))


if __name__ == '__main__':
    main()
