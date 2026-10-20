"""Stream a tracked source cutout through explicit transforms. No ML runtime."""
from fractions import Fraction
from pathlib import Path
import argparse
import hashlib
import importlib.util
import json
import math
import os
import re

import av
import numpy as np
from PIL import Image, ImageFilter, ImageOps

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('subject_media', ROOT / 'custom_nodes/aftertake/media_utils.py')
media = importlib.util.module_from_spec(spec)
spec.loader.exec_module(media)


def digest(path):
    with open(path, 'rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest()


def inspect_media(path, role):
    if role not in ('source', 'prepared', 'mask'):
        raise ValueError('Choose a source, prepared video or lossless mask.')
    with av.open(str(path)) as container:
        if len(container.streams.video) != 1:
            raise ValueError('Use media with exactly one video stream.')
        stream = container.streams.video[0]
        width, height = stream.width, stream.height
        if not 1 <= width <= 4096 or not 1 <= height <= 4096 or width * height > 8847360:
            raise ValueError('Source video exceeds the bounded 4K canvas.')
        duration = float(stream.duration * stream.time_base) if stream.duration else float(container.duration or 0) / av.time_base
        result = {'width': width, 'height': height, 'duration': duration,
                  'hasAudio': bool(container.streams.audio), 'sha256': digest(path)}
        if role == 'source':
            if not 0 < duration <= 3615:
                raise ValueError('Use a source video under one hour.')
            return result
        if width % 32 or height % 32 or width * height > 1000000 or stream.average_rate != 24:
            raise ValueError('Prepared video and mask need the reviewed 24 fps canvas, at most one megapixel.')
        if role == 'mask' and stream.codec_context.name != 'ffv1':
            raise ValueError('Import the original lossless FFV1 person mask, not an encoded preview.')
        count, anchor = 0, None
        for index, frame in enumerate(container.decode(video=0)):
            # Matroska FFV1 uses millisecond timestamps; allow only that
            # container quantization, never a missing/duplicated 24 fps frame.
            if index >= 360 or frame.pts is None or abs(float(frame.pts * frame.time_base) - index / 24) > .0011:
                raise ValueError('Selection media must retain its complete regular 24 fps clock.')
            if role == 'mask':
                pixels = frame.to_ndarray(format='gray')
                if not np.isin(pixels, (0, 255)).all() or not pixels.any():
                    raise ValueError('Use a complete binary person mask with no lost frames.')
                if anchor is None:
                    left, top, right, bottom = Image.fromarray(pixels).getbbox()
                    anchor = [(left + right) / 2, (top + bottom) / 2]
            count += 1
        if not 24 <= count <= 360:
            raise ValueError('Use a complete one-to-fifteen-second person selection.')
        return {**result, 'frames': count, 'fps': 24, 'duration': count / 24, 'anchor': anchor}


def validate_settings(request):
    copies = request.get('copies')
    if not isinstance(copies, list) or not 0 <= len(copies) <= 4:
        raise ValueError('Choose up to four subject copies.')
    limits = {'x': (-1, 1), 'y': (-1, 1), 'scale': (.1, 3), 'opacity': (0, 1)}
    for copy in copies:
        if not isinstance(copy, dict):
            raise ValueError('A copy needs explicit placement settings.')
        for key, (low, high) in limits.items():
            value = copy.get(key)
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
                raise ValueError('A subject transform exceeds its allowed bounds.')
        if not isinstance(copy.get('flipX', False), bool):
            raise ValueError('Horizontal flip must be a boolean.')
        angle = copy.get('rotation', 0)
        if isinstance(angle, bool) or not isinstance(angle, (int, float)) or not math.isfinite(angle) or not -180 <= angle <= 180:
            raise ValueError('Rotation must be between minus180 and180 degrees.')
        if 'color' in copy and (not isinstance(copy['color'], str) or not re.fullmatch(r'#[a-fA-F0-9]{6}', copy['color'])):
            raise ValueError('Silhouette color must be a six-digit hex color.')
        if not isinstance(copy.get('behindSubject', False), bool):
            raise ValueError('Behind-original placement must be a boolean.')
    feather, grow = request.get('feather', 0), request.get('grow', 0)
    if isinstance(feather, bool) or not isinstance(feather, (int, float)) or not math.isfinite(feather) or not 0 <= feather <= 12:
        raise ValueError('Feather must be zero to twelve pixels.')
    if isinstance(grow, bool) or not isinstance(grow, int) or not -16 <= grow <= 32:
        raise ValueError('Mask growth must be minus sixteen to thirty-two pixels.')
    for key, low, high in [('backgroundBlur', 0, 32), ('backgroundExposureEV', -2, 2)]:
        value = request.get(key, 0)
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
            raise ValueError('Background focus settings exceed their allowed bounds.')
    return copies, feather, grow


def background_frame(source, matte, blur=0, exposure=0):
    if blur == 0 and exposure == 0:
        return source.copy()
    protected = matte == 255
    backdrop = source.astype(np.float32) / 255
    if blur:
        # Exclude the actor from the samples instead of blurring their colors
        # into the surrounding background, which creates a cutout halo.
        weight = (~protected).astype(np.float32)
        blurred_weight = np.asarray(Image.fromarray(np.rint(weight * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(blur))).astype(np.float32) / 255
        numerator = np.asarray(Image.fromarray(np.rint(source * weight[..., None]).astype(np.uint8)).filter(ImageFilter.GaussianBlur(blur))).astype(np.float32) / 255
        backdrop = np.where(blurred_weight[..., None] > 1e-5,
            numerator / np.maximum(blurred_weight[..., None], 1e-5), backdrop).clip(0, 1)
    if exposure:
        linear = np.where(backdrop <= .04045, backdrop / 12.92, ((backdrop + .055) / 1.055) ** 2.4)
        linear = (linear * 2 ** exposure).clip(0, 1)
        backdrop = np.where(linear <= .0031308, linear * 12.92, 1.055 * linear ** (1 / 2.4) - .055)
    output = np.rint(backdrop * 255).clip(0, 255).astype(np.uint8)
    output[protected] = source[protected]
    return output


def composite_frame(source, matte, copies, feather=0, grow=0, *, anchor=None, background_blur=0, background_exposure=0):
    """Copy original pixels using a fixed shot anchor; later copies draw on top.

    Positive rotation is clockwise. The renderer binds anchor to the first raw
    mask's center for the entire shot, so SAM bbox changes cannot jitter it.
    """
    if source.ndim != 3 or source.shape[2] != 3 or source.dtype != np.uint8 or matte.shape != source.shape[:2] or matte.dtype != np.uint8:
        raise ValueError('Source pixels and person mask must share the same canvas.')
    mask = Image.fromarray(matte)
    if grow:
        mask = mask.filter(ImageFilter.MaxFilter(2 * grow + 1) if grow > 0 else ImageFilter.MinFilter(-2 * grow + 1))
    if feather:
        mask = mask.filter(ImageFilter.GaussianBlur(feather))
    box = mask.getbbox()
    output = background_frame(source, matte, background_blur, background_exposure)
    if box is None:
        return output
    left, top, right, bottom = box
    width, height = source.shape[1], source.shape[0]
    center_x, center_y = (left + right) / 2, (top + bottom) / 2
    anchor_x, anchor_y = anchor if anchor is not None else (width / 2, height / 2)
    cutout = Image.fromarray(source).convert('RGBA')
    cutout.putalpha(mask)
    cutout = cutout.crop(box)
    for copy in copies:
        angle = copy.get('rotation', 0)
        if copy['opacity'] == 0 or (not copy.get('color') and background_blur == 0 and background_exposure == 0 and copy['x'] == 0 and copy['y'] == 0 and copy['scale'] == 1 and angle == 0 and not copy.get('flipX', False)):
            continue
        scaled_width = max(1, round((right - left) * copy['scale']))
        scaled_height = max(1, round((bottom - top) * copy['scale']))
        if copy.get('color'):
            layer = Image.new('RGBA', cutout.size, copy['color'])
            layer.putalpha(cutout.getchannel('A'))
        else:
            layer = cutout
        layer = layer.convert('RGBa')
        layer = ImageOps.mirror(layer) if copy.get('flipX', False) else layer
        layer = layer.resize((scaled_width, scaled_height), Image.Resampling.LANCZOS)
        if angle:
            layer = layer.rotate(-angle, resample=Image.Resampling.BICUBIC, expand=True)
        layer = layer.convert('RGBA')
        radians = math.radians(angle)
        vx, vy = (center_x - anchor_x) * copy['scale'], (center_y - anchor_y) * copy['scale']
        target_x = anchor_x + copy['x'] * width + math.cos(radians) * vx - math.sin(radians) * vy
        target_y = anchor_y + copy['y'] * height + math.sin(radians) * vx + math.cos(radians) * vy
        scaled_width, scaled_height = layer.size
        x, y = round(target_x - scaled_width / 2), round(target_y - scaled_height / 2)
        x0, y0, x1, y1 = max(0, x), max(0, y), min(width, x + scaled_width), min(height, y + scaled_height)
        if x0 >= x1 or y0 >= y1:
            continue
        pixels = np.asarray(layer.crop((x0 - x, y0 - y, x1 - x, y1 - y)))
        alpha = pixels[..., 3:4].astype(np.float32) / 255 * copy['opacity']
        if copy.get('behindSubject', False):
            # The current-frame original person occludes every silhouette,
            # including overlapping limbs; no translated box or prior mask.
            alpha *= 1 - matte[y0:y1, x0:x1, None].astype(np.float32) / 255
        destination = output[y0:y1, x0:x1]
        output[y0:y1, x0:x1] = np.rint(destination + alpha * (pixels[..., :3].astype(np.float32) - destination)).clip(0, 255).astype(np.uint8)
    return output


def render(settings):
    copies, feather, grow = validate_settings(settings['request'])
    paths = {key: Path(settings[key]) for key in ('source', 'prepared', 'mask')}
    for key, path in paths.items():
        if digest(path) != settings['hashes'][key]:
            raise ValueError('A reviewed source or person mask changed before compositing.')
    source_info = inspect_media(paths['source'], 'source')
    prepared, mask_info = inspect_media(paths['prepared'], 'prepared'), inspect_media(paths['mask'], 'mask')
    info = settings['selection']
    if not math.isfinite(settings['trimStart']) or settings['trimStart'] < 0 or settings['trimStart'] + info['frames'] / 24 > source_info['duration'] + 1 / 24:
        raise ValueError('The selected audio/video range extends outside the original source.')
    for key in ('width', 'height', 'frames', 'fps'):
        if prepared[key] != info[key] or mask_info[key] != info[key]:
            raise ValueError('Prepared video and person mask must retain the reviewed frame clock and dimensions.')
    output = Path(settings['output'])
    stage = output.with_name(output.stem + '.part.mp4')
    try:
        with av.open(str(paths['prepared'])) as source_container, av.open(str(paths['mask'])) as mask_container, av.open(str(stage), 'w') as encoded:
            encoded.metadata['comment'] = json.dumps({'recipe': settings['recipe'], 'renderer': 'aftertake-local-subject-compositor/1'}, allow_nan=False)
            stream = encoded.add_stream('libx264', rate=24)
            stream.width, stream.height, stream.pix_fmt = info['width'], info['height'], 'yuv420p'
            stream.options = {'crf': '17', 'preset': 'fast', 'threads': '2'}
            sources, masks = iter(source_container.decode(video=0)), iter(mask_container.decode(video=0))
            for index in range(info['frames']):
                a, b = next(sources, None), next(masks, None)
                if a is None or b is None:
                    raise ValueError('Selection media ended early; refusing to truncate the video.')
                result = composite_frame(a.to_ndarray(format='rgb24'), b.to_ndarray(format='gray'), copies, feather, grow,
                    anchor=mask_info['anchor'], background_blur=settings['request'].get('backgroundBlur', 0),
                    background_exposure=settings['request'].get('backgroundExposureEV', 0))
                frame = av.VideoFrame.from_ndarray(result, format='rgb24')
                frame.pts, frame.time_base = index, Fraction(1, 24)
                for packet in stream.encode(frame):
                    encoded.mux(packet)
            if next(sources, None) is not None or next(masks, None) is not None:
                raise ValueError('Selection media has extra frames; refusing a mismatched clock.')
            for packet in stream.encode():
                encoded.mux(packet)
        has_audio = media.mux_source_audio(stage, paths['source'], settings['trimStart'], info['frames'] / 24)
        os.replace(stage, output)
        return {'width': info['width'], 'height': info['height'], 'frames': info['frames'],
                'fps': 24, 'duration': info['frames'] / 24, 'hasAudio': has_audio,
                'sha256': digest(output), 'renderer': 'aftertake-local-subject-compositor/1',
                'anchor': mask_info['anchor']}
    finally:
        stage.unlink(missing_ok=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('settings', nargs='?', type=Path)
    parser.add_argument('--inspect', type=Path)
    parser.add_argument('--role', choices=('source', 'prepared', 'mask'))
    args = parser.parse_args()
    if args.inspect:
        result = inspect_media(args.inspect, args.role)
    elif args.settings:
        result = render(json.loads(args.settings.read_text(encoding='utf-8')))
    else:
        parser.error('Supply a settings file or --inspect media --role role.')
    print(json.dumps(result, allow_nan=False))
