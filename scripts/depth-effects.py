"""Apply bounded still-image effects to a genuine, lossless DA3 depth field. No ML runtime."""
import base64
import hashlib
import json
import math
from pathlib import Path
import zlib

import numpy as np
from PIL import Image, ImageFilter, PngImagePlugin

MODEL_SHA = '9c0a53d157c5b315d4c82908a43d93eeaa3a9ac3de9d15c2b4242ef46b5508ad'


def normalize_depth(depth):
    if depth.ndim != 2 or not np.isfinite(depth).all() or not (depth > 0).all():
        raise ValueError('Use a finite, positive model depth field.')
    near, far = np.percentile(depth, (2, 98))
    if far <= near:
        raise ValueError('The model returned no usable depth variation.')
    return np.clip((depth - near) / (far - near), 0, 1).astype(np.float32), [float(near), float(far)]


def validate_settings(settings):
    limits = {'focus': (0, 1), 'blur': (0, 32), 'haze': (0, 1), 'lightAzimuth': (-180, 180),
              'lightElevation': (0, 90), 'lightStrength': (0, 1)}
    if set(settings) != set(limits) | {'hazeColor'}:
        raise ValueError('Use the complete depth-effect settings.')
    for key, (low, high) in limits.items():
        value = settings[key]
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
            raise ValueError('A depth effect setting exceeds its supported range.')
    color = settings['hazeColor']
    if not isinstance(color, str) or len(color) != 7 or not color.startswith('#'):
        raise ValueError('Use a six-digit haze color.')
    return np.array([int(color[index:index + 2], 16) / 255 for index in (1, 3, 5)], dtype=np.float32)


def apply_effects(source, depth, settings):
    haze_color = validate_settings(settings)
    if source.dtype != np.uint8 or source.ndim != 3 or source.shape[-1] != 3 or source.shape[:2] != depth.shape:
        raise ValueError('Image and depth must share one RGB canvas.')
    normalized, bounds = normalize_depth(depth)
    if not any(settings[key] for key in ('blur', 'haze', 'lightStrength')):
        return source.copy(), bounds
    rgb = source.astype(np.float32) / 255
    if settings['blur']:
        # A depth-binned, premultiplied approximation. Samples from another
        # depth band cannot leak actor colors into its blurred background.
        result, total = np.zeros_like(rgb), np.zeros_like(normalized)
        for center in np.linspace(0, 1, 9):
            weight = np.maximum(0, 1 - np.abs(normalized - center) * 8)
            radius = settings['blur'] * abs(float(center) - settings['focus'])
            if radius < .1:
                blurred_weight, numerator = weight, rgb * weight[..., None]
            else:
                blurred_weight = np.asarray(Image.fromarray(np.rint(weight * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(radius))).astype(np.float32) / 255
                numerator = np.asarray(Image.fromarray(np.rint(rgb * weight[..., None] * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(radius))).astype(np.float32) / 255
            filtered = np.where(blurred_weight[..., None] > 1e-5,
                numerator / np.maximum(blurred_weight[..., None], 1e-5), rgb)
            result += filtered * weight[..., None]
            total += weight
        rgb = np.where(total[..., None] > 1e-5, result / np.maximum(total[..., None], 1e-5), rgb).clip(0, 1)
    if settings['lightStrength']:
        # These are 2.5D normals from relative depth, not measured scene lights
        # or a claim of physical shadows / full 3D reconstruction.
        height, width = depth.shape
        # Low-frequency normals avoid lighting the quantization terraces of
        # a reduced-precision estimator. Geometry still comes from raw depth.
        smooth = np.asarray(Image.fromarray(depth).resize((max(16, width // 12), max(16, height // 12)),
            Image.Resampling.BILINEAR).resize((width, height), Image.Resampling.BICUBIC))
        yy, xx = np.mgrid[:height, :width].astype(np.float32)
        focal = .7 * width  # approximate intrinsics, not measured camera data
        points = np.stack(((xx - (width - 1) / 2) * smooth / focal,
            (yy - (height - 1) / 2) * smooth / focal, smooth), axis=-1)
        dy, dx = np.gradient(points, axis=(0, 1))
        normal = np.cross(dx, dy)
        normal /= np.maximum(np.linalg.norm(normal, axis=-1, keepdims=True), 1e-6)
        azimuth, elevation = math.radians(settings['lightAzimuth']), math.radians(settings['lightElevation'])
        light = np.array([math.cos(elevation) * math.sin(azimuth), -math.cos(elevation) * math.cos(azimuth), math.sin(elevation)])
        diffuse = np.maximum(normal @ light, 0)
        diffuse = np.asarray(Image.fromarray(np.rint(diffuse.clip(0, 1) * 255).astype(np.uint8)).filter(
            ImageFilter.GaussianBlur(max(2, min(width, height) / 40)))).astype(np.float32) / 255
        exposure = settings['lightStrength'] * (diffuse - math.sin(elevation))
        rgb = (rgb * np.exp2(exposure)[..., None]).clip(0, 1)
    if settings['haze']:
        alpha = (settings['haze'] * normalized ** 1.6)[..., None]
        rgb = rgb * (1 - alpha) + haze_color * alpha
    return np.rint(rgb * 255).clip(0, 255).astype(np.uint8), bounds


def run(work):
    source_path, depth_path = Path(work['source']), Path(work['depth'])
    request = work['request']
    if hashlib.sha256(source_path.read_bytes()).hexdigest() != request['clip']['sha256']:
        raise ValueError('The image changed after admission.')
    if depth_path.stat().st_size > 64 * 1024 ** 2:
        raise ValueError('The depth result exceeds its bounded payload.')
    with Image.open(depth_path) as image:
        receipt = json.loads(image.info['aftertake_depth'])
    width, height = request['clip']['width'], request['clip']['height']
    if not 4096 >= width >= 64 or not 4096 >= height >= 64 or width * height > 4194304:
        raise ValueError('The requested image exceeds the bounded canvas.')
    if (receipt.get('format') != 'aftertake-raw-depth/1' or receipt.get('encoding') != 'zlib-base64-f32le' or
            receipt.get('request') != request or receipt.get('width') != width or receipt.get('height') != height or
            receipt.get('modelSha256') != MODEL_SHA or receipt.get('inferenceDtype') != 'bfloat16' or
            not str(receipt.get('device', '')).startswith('cuda:')):
        raise ValueError('The depth output does not match its native BF16 source and model receipt.')
    inflater = zlib.decompressobj()
    raw = inflater.decompress(base64.b64decode(receipt['data'], validate=True), width * height * 4 + 1)
    if len(raw) != width * height * 4 or not inflater.eof or inflater.unused_data or inflater.unconsumed_tail:
        raise ValueError('The raw model depth payload has an invalid length.')
    if hashlib.sha256(raw).hexdigest() != receipt['rawSha256']:
        raise ValueError('The raw model depth hash differs from its receipt.')
    depth = np.frombuffer(raw, dtype='<f4').reshape(height, width)
    with Image.open(source_path) as image:
        source = np.asarray(image.convert('RGB'))
    result, bounds = apply_effects(source, depth, request['settings'])
    raw_path = Path(work['raw'])
    with raw_path.open('wb') as handle:
        np.savez_compressed(handle, depth=depth)
    metadata = {'format': 'aftertake-depth-effect-recipe/1', 'request': request,
        'model': work['model'], 'rawDepthSha256': receipt['rawSha256'], 'depthNormalization': bounds,
        'scope': 'still-image', 'workflow': receipt['workflow']}
    png = PngImagePlugin.PngInfo()
    png.add_itxt('aftertake_depth_effect', json.dumps(metadata, separators=(',', ':'), allow_nan=False))
    Image.fromarray(result).save(work['output'], pnginfo=png)
    return {'width': width, 'height': height, 'sha256': hashlib.sha256(Path(work['output']).read_bytes()).hexdigest(),
        'rawSha256': receipt['rawSha256'], 'depthSha256': hashlib.sha256(depth_path.read_bytes()).hexdigest(),
        'modelSha256': MODEL_SHA, 'workflow': receipt['workflow']}


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('work')
    args = parser.parse_args()
    print(json.dumps(run(json.loads(Path(args.work).read_text(encoding='utf-8'))), allow_nan=False))
