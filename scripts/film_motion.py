"""Bounded CPU motion graphics on Film's absolute 24 fps frame clock."""
import math
import re
import hashlib
import warnings
from pathlib import Path

from PIL import Image, ImageDraw, ImageOps

EASINGS = {'linear', 'ease-in', 'ease-out', 'ease-in-out', 'hold', 'custom'}
CURVE_FIELDS = ('x1', 'y1', 'x2', 'y2')
POSE_FIELDS = ('x', 'y', 'scale', 'scaleX', 'scaleY', 'rotation', 'opacity')
IDENTITY = {'x': 0.0, 'y': 0.0, 'scale': 1.0, 'scaleX': 1.0, 'scaleY': 1.0,
            'rotation': 0.0, 'opacity': 1.0}


def number(value, low, high, name):
    if type(value) not in (int, float) or not math.isfinite(value) or not low <= value <= high:
        raise ValueError(f'Motion graphic {name} must be finite and between {low} and {high}.')
    return float(value)


def canvas_size(width, height):
    if (type(width) is not int or type(height) is not int or min(width, height) < 2
            or max(width, height) > 3840 or width * height > 3840 * 2160):
        raise ValueError('Motion graphics need a bounded Film canvas of at most 3840 x 2160 pixels.')
    return width, height


def validate_easing(value):
    """Destination easing and its curve; a curve exists exactly for custom easing."""
    easing = value.get('easing', 'linear')
    if not isinstance(easing, str) or easing not in EASINGS:
        raise ValueError('Choose a supported motion easing.')
    if (easing == 'custom') != ('bezier' in value):
        raise ValueError('Custom easing needs its bezier curve; other easings cannot carry one.')
    if easing != 'custom':
        return easing, None
    curve = value['bezier']
    if not isinstance(curve, dict) or set(curve) != set(CURVE_FIELDS):
        raise ValueError('A motion curve needs only x1, y1, x2 and y2.')
    # Bounded handles keep x(u) monotonic and every eased pose between its keys.
    return easing, {name: number(curve[name], 0, 1, 'curve ' + name) for name in CURVE_FIELDS}


def validate_motion(value):
    if not isinstance(value, dict) or set(value) != {'keys'}:
        raise ValueError('Motion needs only a keys array.')
    values = value['keys']
    if not isinstance(values, list) or not 2 <= len(values) <= 12:
        raise ValueError('Motion needs between two and twelve keyframes.')
    keys = []
    limits = {'at': (0, 1), 'x': (-2, 2), 'y': (-2, 2), 'scale': (.02, 4),
              'rotation': (-360, 360), 'opacity': (0, 1)}
    for value in values:
        if (not isinstance(value, dict) or set(value) - {*limits, 'easing', 'bezier', 'scaleX', 'scaleY'}
                or set(limits) - set(value)):
            raise ValueError('Each motion key needs its time and complete transform.')
        key = {name: number(value[name], *bounds, name) for name, bounds in limits.items()}
        for name in ('scaleX', 'scaleY'):
            key[name] = number(value.get(name, 1), .02, 4, name)
        key['easing'], curve = validate_easing(value)
        if curve is not None:
            key['bezier'] = curve
        if keys and key['at'] <= keys[-1]['at']:
            raise ValueError('Motion key times must increase strictly.')
        keys.append(key)
    if keys[0]['at'] != 0 or keys[-1]['at'] != 1:
        raise ValueError('Motion keys must start at zero and end at one.')
    return {'keys': keys}


def motion_progress(start, end, frame):
    number(start, 0, 600, 'start')
    number(end, 0, 600, 'end')
    if end <= start:
        raise ValueError('A motion graphic must end after it starts.')
    if type(frame) is not int:
        raise ValueError('Motion needs an integer absolute frame.')
    first = math.ceil(start * 24 - 1e-7)
    last = math.ceil(end * 24 - 1e-7)
    span = max(0, last - first - 1)
    return max(0, min(span, frame - first)) / max(1, span)


def curve_amount(progress, curve):
    """Solve x(u) = progress by fixed bisection, then return y(u).

    Mirrors motionCurveAmount in src/film-motion.ts operation for operation, so
    the browser preview and native export compute identical IEEE doubles.
    """
    if not progress > 0:
        return 0.0
    if progress >= 1:
        return 1.0
    x1, y1, x2, y2 = (float(curve[name]) for name in CURVE_FIELDS)
    cx = 3 * x1
    bx = 3 * (x2 - x1) - cx
    ax = 1 - cx - bx
    low, high = 0.0, 1.0
    for _ in range(52):
        middle = (low + high) / 2
        if ((ax * middle + bx) * middle + cx) * middle < progress:
            low = middle
        else:
            high = middle
    u = (low + high) / 2
    cy = 3 * y1
    by = 3 * (y2 - y1) - cy
    ay = 1 - cy - by
    return min(1.0, max(0.0, ((ay * u + by) * u + cy) * u))


def eased(progress, easing, curve=None):
    if easing == 'ease-in':
        return progress ** 3
    if easing == 'ease-out':
        return 1 - (1 - progress) ** 3
    if easing == 'ease-in-out':
        return progress * progress * (3 - 2 * progress)
    if easing == 'hold':
        return 0 if progress < 1 else 1
    if easing == 'custom':
        if curve is None:
            raise ValueError('Custom easing needs its bezier curve.')
        return curve_amount(progress, curve)
    return progress


def motion_at(motion, progress):
    if motion is None:
        return dict(IDENTITY)
    progress = number(progress, 0, 1, 'progress')
    keys = motion['keys']
    if progress <= 0:
        return {field: keys[0][field] for field in POSE_FIELDS}
    for left, right in zip(keys, keys[1:]):
        if progress <= right['at']:
            amount = eased((progress - left['at']) / (right['at'] - left['at']), right['easing'], right.get('bezier'))
            return {field: left[field] + (right[field] - left[field]) * amount for field in POSE_FIELDS}
    return {field: keys[-1][field] for field in POSE_FIELDS}


def opacity(image, amount):
    if amount == 1:
        return image
    image = image.copy()
    image.putalpha(image.getchannel('A').point([round(i * amount) for i in range(256)]))
    return image


def affine_rgba(image, size, coefficients):
    # Interpolate associated color, then unassociate. Transparent RGB cannot
    # bleed a dark/light fringe into a rotated or resized semitransparent edge.
    return image.convert('RGBa').transform(size, Image.Transform.AFFINE, coefficients,
        Image.Resampling.BILINEAR, fillcolor=(0, 0, 0, 0)).convert('RGBA')


def transform_title(image, pose):
    width, height = canvas_size(*image.size)
    cx, cy = width / 2, height / 2
    angle = math.radians(pose['rotation'])
    sx, sy = pose['scale'] * pose.get('scaleX', 1), pose['scale'] * pose.get('scaleY', 1)
    cosine, sine = math.cos(angle), math.sin(angle)
    tx, ty = cx + pose['x'] * width, cy + pose['y'] * height
    a, b, d, e = cosine / sx, sine / sx, -sine / sy, cosine / sy
    coefficients = (a, b, cx - a * tx - b * ty, d, e, cy - d * tx - e * ty)
    return opacity(affine_rgba(image, (width, height), coefficients), pose['opacity'])


def _color(value, name):
    if not isinstance(value, str) or len(value) != 7 or value[0] != '#':
        raise ValueError(f'Graphic {name} must be a six-digit hex color.')
    try:
        return tuple(int(value[i:i + 2], 16) for i in (1, 3, 5)) + (255,)
    except ValueError as error:
        raise ValueError(f'Graphic {name} must be a six-digit hex color.') from error


def validate_graphic(value):
    fields = {'id', 'name', 'kind', 'start', 'end', 'x', 'y', 'width', 'height', 'color',
              'opacity', 'fillOpacity', 'radius', 'strokeColor', 'strokeWidth', 'fit', 'source', 'assetId', 'sha256', 'motion'}
    if not isinstance(value, dict) or set(value) - fields:
        raise ValueError('Graphic contains unsupported fields.')
    result = dict(value)
    if not isinstance(value.get('id'), str) or not re.fullmatch(r'[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}', value['id']):
        raise ValueError('A graphic needs a valid identifier.')
    if not isinstance(value.get('name'), str) or not 1 <= len(value['name'].strip()) <= 80:
        raise ValueError('A graphic needs a name of at most eighty characters.')
    if value.get('kind') not in ('rect', 'ellipse', 'image'):
        raise ValueError('Choose a rectangle, ellipse or PNG, JPEG or WebP image graphic.')
    for name, low, high in [('start', 0, 600), ('end', 0, 600), ('x', -2, 3), ('y', -2, 3),
                          ('width', .005, 3), ('height', .005, 3), ('opacity', 0, 1)]:
        result[name] = number(value.get(name), low, high, name)
    if result['end'] < result['start'] + .25:
        raise ValueError('A graphic must last at least a quarter second.')
    _color(value.get('color'), 'fill')
    for name, low, high in [('radius', 0, .5), ('strokeWidth', 0, 32), ('fillOpacity', 0, 1)]:
        if name in value:
            result[name] = number(value[name], low, high, name)
    if 'strokeColor' in value:
        _color(value['strokeColor'], 'stroke')
    if value.get('fit', 'contain') not in ('contain', 'cover'):
        raise ValueError('Graphic image fit must be contain or cover.')
    if 'motion' in value:
        result['motion'] = validate_motion(value['motion'])
    if value['kind'] == 'image':
        if not isinstance(value.get('assetId'), str) or not re.fullmatch(r'[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}', value['assetId']):
            raise ValueError('An image graphic needs its imported asset identifier.')
        if not isinstance(value.get('source'), str) or not value['source'] or not Path(value['source']).is_file():
            raise ValueError('An image graphic needs its resolved local image source.')
        if 'sha256' in value and (not isinstance(value['sha256'], str) or not re.fullmatch(r'[a-f0-9]{64}', value['sha256'])):
            raise ValueError('An image graphic needs a valid content hash.')
    elif set(value) & {'source', 'assetId', 'sha256'}:
        raise ValueError('Only image graphics can have a media source or asset metadata.')
    return result


def graphic_image(graphic):
    """Verify and decode the same bounded local source without retaining its bytes."""
    limit = 100 * 1024 * 1024
    with Path(graphic['source']).open('rb') as source:
        if source.seek(0, 2) > limit:
            raise ValueError('Graphic image sources must be at most 100 MiB.')
        source.seek(0)
        if 'sha256' in graphic:
            digest = hashlib.sha256()
            count = 0
            while chunk := source.read(1024 * 1024):
                count += len(chunk)
                if count > limit:
                    raise ValueError('Graphic image sources must be at most 100 MiB.')
                digest.update(chunk)
            if digest.hexdigest() != graphic['sha256']:
                raise ValueError('A graphic image differs from its saved content hash.')
            source.seek(0)
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(source) as opened:
                if (opened.format not in {'PNG', 'JPEG', 'WEBP'}
                        or opened.width * opened.height > 4096 * 4096):
                    raise ValueError('Graphic sources must be PNG, JPEG or WebP images of at most 4096 squared pixels.')
                # Browser image elements honor EXIF orientation. Apply it before
                # measuring fit so native contain/cover uses the same geometry.
                return ImageOps.exif_transpose(opened).convert('RGBa')


def graphic_layout(graphic, width, height):
    canvas_size(width, height)
    graphic = validate_graphic(graphic)
    base_width, base_height = graphic['width'] * width, graphic['height'] * height
    stroke = graphic.get('strokeWidth', 0) * width / 1280
    # One local raster, no larger than the output canvas, even when a shape is
    # three canvases wide and its motion scales it by four.
    pad = stroke / 2 + 2
    factor = min(1, width / (base_width + 2 * pad), height / (base_height + 2 * pad))
    tile_width = max(1, min(width, math.ceil((base_width + 2 * pad) * factor)))
    tile_height = max(1, min(height, math.ceil((base_height + 2 * pad) * factor)))
    tile = Image.new('RGBA', (tile_width, tile_height))
    cx, cy = tile_width / 2, tile_height / 2
    half_width, half_height = base_width * factor / 2, base_height * factor / 2
    bounds = (cx - half_width, cy - half_height, cx + half_width, cy + half_height)
    radius = graphic.get('radius', 0) * min(base_width, base_height) * factor
    draw = ImageDraw.Draw(tile)
    shape = draw.ellipse if graphic['kind'] == 'ellipse' else draw.rounded_rectangle
    kwargs = {} if graphic['kind'] == 'ellipse' else {'radius': radius}
    if graphic['kind'] == 'image':
        picture = graphic_image(graphic)
        box = (max(1, round(base_width * factor)), max(1, round(base_height * factor)))
        if graphic.get('fit', 'contain') == 'cover':
            picture = ImageOps.fit(picture, box, method=Image.Resampling.BILINEAR)
        else:
            picture = ImageOps.contain(picture, box, method=Image.Resampling.BILINEAR)
        tile.alpha_composite(opacity(picture.convert('RGBA'), graphic.get('fillOpacity', 1)),
            (round(cx - picture.width / 2), round(cy - picture.height / 2)))
        if radius:
            mask = Image.new('L', tile.size)
            ImageDraw.Draw(mask).rounded_rectangle(bounds, radius=radius, fill=255)
            from PIL import ImageChops
            tile.putalpha(ImageChops.multiply(tile.getchannel('A'), mask))
    else:
        color = _color(graphic['color'], 'fill')
        shape(bounds, fill=(*color[:3], round(255 * graphic.get('fillOpacity', 1))), **kwargs)
    if stroke:
        amount = stroke * factor
        expanded = (bounds[0] - amount / 2, bounds[1] - amount / 2,
                    bounds[2] + amount / 2, bounds[3] + amount / 2)
        kwargs = {} if graphic['kind'] == 'ellipse' else {'radius': radius + amount / 2 if radius else 0}
        shape(expanded, outline=_color(graphic.get('strokeColor', '#ffffff'), 'stroke'), width=max(1, round(amount)), **kwargs)
    return {'graphic': graphic, 'tile': tile, 'factor': factor, 'canvas': (width, height)}


def graphic_frame(layout, frame):
    graphic, tile = layout['graphic'], layout['tile']
    width, height = layout['canvas']
    if frame < math.ceil(graphic['start'] * 24 - 1e-7) or frame >= math.ceil(graphic['end'] * 24 - 1e-7):
        return Image.new('RGBA', (width, height))
    pose = motion_at(graphic.get('motion'), motion_progress(graphic['start'], graphic['end'], frame))
    angle = math.radians(pose['rotation'])
    sx, sy = pose['scale'] * pose.get('scaleX', 1), pose['scale'] * pose.get('scaleY', 1)
    cosine, sine = math.cos(angle) * layout['factor'], math.sin(angle) * layout['factor']
    cx, cy = (graphic['x'] + pose['x']) * width, (graphic['y'] + pose['y']) * height
    a, b, d, e = cosine / sx, sine / sx, -sine / sy, cosine / sy
    coefficients = (a, b, tile.width / 2 - a * cx - b * cy,
                    d, e, tile.height / 2 - d * cx - e * cy)
    return opacity(affine_rgba(tile, (width, height), coefficients), graphic['opacity'] * pose['opacity'])
