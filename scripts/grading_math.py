"""Independent display-sRGB grading: W3C HSL, monotone PCHIP and Iridas .cube.

No model, network, executable expressions or client-selected paths are involved.
"""
from hashlib import sha256
import math
from pathlib import Path
import re

import numpy as np

CHANNELS = ('red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta')
CURVES = ('master', 'red', 'green', 'blue')
CENTERS = np.array([0, 30, 60, 120, 180, 240, 270, 300, 360], dtype=np.float32)
GRADING_DEFAULTS = {
    'selectiveColor': {name: dict(hueDegrees=0, saturation=0, lightness=0) for name in CHANNELS},
    'curves': {name: [dict(x=0, y=0), dict(x=1, y=1)] for name in CURVES},
    'lut': None, 'lutStrength': 0,
}


def finite(value, lower, upper):
    return (not isinstance(value, bool) and isinstance(value, (int, float)) and
            math.isfinite(value) and lower <= value <= upper)


def validate_grading(settings):
    selective, curves = settings['selectiveColor'], settings['curves']
    if not isinstance(selective, dict) or set(selective) != set(CHANNELS):
        raise ValueError('Use the eight supported selective-color channels.')
    for values in selective.values():
        if (not isinstance(values, dict) or set(values) != {'hueDegrees', 'saturation', 'lightness'} or
                not finite(values['hueDegrees'], -30, 30) or
                not all(finite(values[key], -1, 1) for key in ('saturation', 'lightness'))):
            raise ValueError('Selective HSL controls must be finite and within their ranges.')
    if not isinstance(curves, dict) or set(curves) != set(CURVES):
        raise ValueError('Use master, red, green and blue tone curves.')
    for points in curves.values():
        if not isinstance(points, list) or not 2 <= len(points) <= 16:
            raise ValueError('A curve needs between two and sixteen points.')
        for index, point in enumerate(points):
            if (not isinstance(point, dict) or set(point) != {'x', 'y'} or
                    not all(finite(point[key], 0, 1) for key in ('x', 'y')) or
                    (index and (point['x']-points[index - 1]['x'] < 1e-6 or point['y'] < points[index - 1]['y']))):
                raise ValueError('Curve inputs must increase and outputs must not decrease.')
        if points[0]['x'] != 0 or points[-1]['x'] != 1:
            raise ValueError('Curve input endpoints must be zero and one.')
    if not finite(settings['lutStrength'], 0, 1):
        raise ValueError('LUT strength must be between zero and one.')
    lut = settings['lut']
    if lut is None:
        if settings['lutStrength']:
            raise ValueError('Import a 3D LUT before increasing its strength.')
        return
    if (not isinstance(lut, dict) or set(lut) != {'sha256', 'title', 'size', 'domainMin', 'domainMax', 'interpolation', 'colorSpace'} or
            not isinstance(lut['sha256'], str) or not re.fullmatch('[a-f0-9]{64}', lut['sha256']) or
            not isinstance(lut['title'], str) or len(lut['title']) > 160 or
            type(lut['size']) is not int or not 2 <= lut['size'] <= 64 or
            lut['interpolation'] != 'trilinear' or lut['colorSpace'] != 'srgb'):
        raise ValueError('Use a hash-bound display-sRGB 3D LUT descriptor.')
    for key in ('domainMin', 'domainMax'):
        if not isinstance(lut[key], list) or len(lut[key]) != 3 or not all(finite(v, -1e30, 1e30) for v in lut[key]):
            raise ValueError('LUT input-domain bounds must be three finite numbers.')
    if any(b <= a or not math.isfinite(b - a) for a, b in zip(lut['domainMin'], lut['domainMax'])):
        raise ValueError('LUT input-domain spans must be positive and finite.')


def grading_identity(settings):
    return (not settings.get('lutStrength', 0) and
            all(value == 0 for channel in settings.get('selectiveColor', GRADING_DEFAULTS['selectiveColor']).values()
                for value in channel.values()) and
            all(point['x'] == point['y'] for points in settings.get('curves', GRADING_DEFAULTS['curves']).values()
                for point in points))


def curve_table(points, samples=4096):
    """Shape-preserving cubic Hermite slopes from the published PCHIP rule."""
    x = np.array([point['x'] for point in points], dtype=np.float64)
    y = np.array([point['y'] for point in points], dtype=np.float64)
    h, delta = np.diff(x), np.diff(y) / np.diff(x)
    slopes = np.zeros_like(y)
    if len(points) == 2:
        slopes[:] = delta[0]
    else:
        for index in range(1, len(points) - 1):
            left, right = delta[index - 1], delta[index]
            if left > 0 and right > 0:
                a, b = 2 * h[index] + h[index - 1], h[index] + 2 * h[index - 1]
                slopes[index] = (a + b) / (a / left + b / right)
        for index, first, second in ((0, 0, 1), (-1, -1, -2)):
            slope = ((2 * h[first] + h[second]) * delta[first] - h[first] * delta[second]) / (h[first] + h[second])
            slopes[index] = min(3 * delta[first], max(0, slope))
    coordinates = np.linspace(0, 1, samples)
    intervals = np.clip(np.searchsorted(x, coordinates, side='right') - 1, 0, len(x) - 2)
    t = (coordinates - x[intervals]) / h[intervals]
    table = ((2*t**3 - 3*t**2 + 1) * y[intervals] + (t**3 - 2*t**2 + t) * h[intervals] * slopes[intervals] +
             (-2*t**3 + 3*t**2) * y[intervals + 1] + (t**3 - t**2) * h[intervals] * slopes[intervals + 1])
    return table.astype(np.float32)


def apply_curves(rgb, tables):
    if not tables:
        return rgb
    rgb=rgb.copy()
    coordinates = np.linspace(0, 1, 4096, dtype=np.float32)
    if 'master' in tables:
        rgb = np.interp(rgb, coordinates, tables['master']).astype(np.float32)
    for index, name in enumerate(CURVES[1:]):
        if name in tables:
            rgb[..., index] = np.interp(rgb[..., index], coordinates, tables[name])
    return rgb


def selective_hsl(rgb, adjustments):
    if not np.any(adjustments):
        return rgb
    source = np.clip(rgb, 0, 1)
    maximum, minimum = source.max(axis=2), source.min(axis=2)
    chroma = maximum - minimum
    lightness = (maximum + minimum) / 2
    denominator = np.maximum(chroma, np.float32(1e-8))
    red, green, blue = np.moveaxis(source, -1, 0)
    hue = np.select([maximum == red, maximum == green],
                    [((green-blue)/denominator) % 6, (blue-red)/denominator + 2],
                    default=(red-green)/denominator + 4) * 60
    hue = np.where(chroma > 0, hue % 360, 0)
    interval = np.clip(np.searchsorted(CENTERS, hue, side='right') - 1, 0, 7)
    fraction = (hue - CENTERS[interval]) / (CENTERS[interval + 1] - CENTERS[interval])
    fraction = fraction*fraction*(3 - 2*fraction)
    values = adjustments[interval] * (1-fraction[..., None]) + adjustments[(interval + 1) % 8] * fraction[..., None]
    values *= np.minimum(chroma / .08, 1)[..., None]
    saturation = chroma / np.maximum(1 - np.abs(2*lightness - 1), np.float32(1e-8))
    hue = ((hue + values[..., 0]) % 360) / 60
    saturation = np.clip(saturation * (1 + values[..., 1]), 0, 1)
    change = values[..., 2]
    lightness += np.where(change >= 0, change*(1-lightness), change*lightness)
    c = (1 - np.abs(2*lightness - 1)) * saturation
    middle = c * (1 - np.abs(hue % 2 - 1))
    zero = np.zeros_like(c)
    sector = np.floor(hue).astype(np.int8)
    result = np.stack((np.select([sector == 0, sector == 1, sector == 4, sector == 5], [c, middle, middle, c], default=zero),
                       np.select([sector == 0, sector == 1, sector == 2, sector == 3], [middle, c, c, middle], default=zero),
                       np.select([sector == 2, sector == 3, sector == 4, sector == 5], [middle, c, c, middle], default=zero)), axis=2)
    result += (lightness - c/2)[..., None]
    # Powerless HSL hue must never tint or brighten exact neutrals.
    return np.where((chroma == 0)[..., None], rgb, result).astype(np.float32)


def parse_cube(data):
    if not 0 < len(data) <= 16*1024*1024:
        raise ValueError('Use a .cube file no larger than sixteen MiB.')
    text = data.decode('utf-8-sig', errors='strict')
    title, size, lower, upper = 'Imported LUT', None, [0., 0., 0.], [1., 1., 1.]
    seen, rows = set(), []
    number = re.compile(r'^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$',re.ASCII)
    for raw in re.split(r'\r\n|\n|\r',text):
        line = raw.strip()
        if not line or line.startswith('#'):
            continue
        if line.startswith('TITLE'):
            match = re.fullmatch(r'TITLE\s+"([^"\r\n]*)"\s*(?:#.*)?', line)
            if not match or 'TITLE' in seen or rows:
                raise ValueError('Use one quoted LUT title before its data.')
            label=match.group(1)
            if len(label.encode('utf-16-le'))//2>160 or any(ord(character)<32 or ord(character)==127 for character in label):
                raise ValueError('Use a quoted LUT title up to160 characters without control characters.')
            title = label.strip(' \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff') or 'Imported LUT'
            seen.add('TITLE')
            continue
        tokens = line.split('#', 1)[0].split()
        key = tokens[0]
        if key in ('LUT_3D_SIZE', 'DOMAIN_MIN', 'DOMAIN_MAX'):
            if key in seen or rows:
                raise ValueError('LUT headers cannot repeat or follow data.')
            seen.add(key)
            if key == 'LUT_3D_SIZE':
                if len(tokens) != 2 or not re.fullmatch('[0-9]+',tokens[1]) or not 2 <= int(tokens[1]) <= 64:
                    raise ValueError('Use a 3D LUT with edge size two to sixty-four.')
                size = int(tokens[1])
            else:
                if len(tokens) != 4 or not all(number.fullmatch(token) for token in tokens[1:]):
                    raise ValueError('LUT domains need three finite numbers.')
                values = [float(value) for value in tokens[1:]]
                if not all(math.isfinite(value) and abs(value) <= 1e30 for value in values):
                    raise ValueError('LUT domains exceed the finite supported range.')
                if key == 'DOMAIN_MIN': lower = values
                else: upper = values
            continue
        if size is None or len(tokens) != 3 or not all(number.fullmatch(token) for token in tokens):
            raise ValueError('Only TITLE, 3D size, input domains and RGB triples are supported.')
        values = [float(value) for value in tokens]
        if not all(math.isfinite(value) and abs(value) <= float(np.finfo(np.float32).max) for value in values):
            raise ValueError('LUT outputs must fit finite float32 values.')
        rows.append(values)
        if len(rows) > size**3:
            raise ValueError('The LUT contains extra RGB entries.')
    if size is None or len(rows) != size**3 or any(b <= a or not math.isfinite(b-a) for a,b in zip(lower,upper)):
        raise ValueError('The LUT needs exactly N cubed entries and positive finite input domains.')
    return dict(title=title, size=size, domainMin=lower, domainMax=upper,
                values=np.asarray(rows, dtype=np.float32).reshape(size, size, size, 3))


def prepare_grading_context(settings, lut_path=None):
    validate_grading(settings)
    context = {'selective': np.array([[settings['selectiveColor'][name][key]
                for key in ('hueDegrees', 'saturation', 'lightness')] for name in CHANNELS], dtype=np.float32),
               'curves': {name: curve_table(points) for name, points in settings['curves'].items()
                          if any(point['x'] != point['y'] for point in points)}, 'lut': None}
    if settings['lutStrength']:
        if lut_path is None:
            raise ValueError('Import the matching .cube asset before applying this LUT.')
        with Path(lut_path).open('rb') as handle:
            data = handle.read(16*1024*1024+1)
        descriptor = settings['lut']
        if sha256(data).hexdigest() != descriptor['sha256']:
            raise ValueError('The LUT companion file changed or does not match its hash.')
        cube = parse_cube(data)
        if any(cube[key] != descriptor[key] for key in ('title', 'size', 'domainMin', 'domainMax')):
            raise ValueError('The LUT companion does not match its portable descriptor.')
        context['lut'] = cube
    return context


def apply_lut(rgb, cube, strength, rows=64):
    if not strength:
        return rgb
    if cube is None:
        raise ValueError('The enabled LUT has no verified companion asset.')
    result = np.empty_like(rgb)
    size, values = cube['size'], cube['values']
    lower = np.asarray(cube['domainMin'], dtype=np.float64)
    span = np.asarray(cube['domainMax'], dtype=np.float64) - lower
    for start in range(0, len(rgb), rows):
        source = rgb[start:start+rows]
        with np.errstate(over='ignore'):
            coordinates = np.clip((source-lower)/span, 0, 1) * (size-1)
        first = np.floor(coordinates).astype(np.intp)
        second = np.minimum(first+1, size-1)
        fraction = coordinates-first
        output = np.zeros(source.shape, dtype=np.float64)
        for red in (0, 1):
            for green in (0, 1):
                for blue in (0, 1):
                    indices = [second[..., axis] if bit else first[..., axis]
                               for axis, bit in enumerate((red, green, blue))]
                    weight = np.prod(np.where(np.array([red, green, blue]), fraction, 1-fraction), axis=2)
                    output += values[indices[2], indices[1], indices[0]] * weight[..., None]
        result[start:start+rows] = source*(1-strength) + output*strength
    return result
