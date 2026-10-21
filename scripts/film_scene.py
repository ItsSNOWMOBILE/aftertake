"""Bounded, isolated overlay groups on Film's absolute 24 fps clock.

Children are clipped to one full-canvas surface before the parent transform.
Depth is a planar projection in painter order, not a 3D scene/depth buffer.
Shutter samples average associated sRGB color and alpha, never straight RGBA.
"""
import math
import re
from collections import OrderedDict

import numpy as np
from PIL import Image

UUID = re.compile(r'[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}')


def frame_bounds(layer):
    return math.ceil(layer['start'] * 24 - 1e-7), math.ceil(layer['end'] * 24 - 1e-7)


def active(layer, frame):
    first, end = frame_bounds(layer)
    return first <= frame < end


def phase(layer, frame):
    """Fractional counterpart of legacy motion_progress; legacy is unchanged."""
    first, end = frame_bounds(layer)
    return max(0, min(1, (frame - first) / max(1, end - first - 1)))


def reference(value, kinds):
    if (not isinstance(value, dict) or set(value) != {'kind', 'id'}
            or value['kind'] not in kinds or not isinstance(value['id'], str)
            or not UUID.fullmatch(value['id'])):
        raise ValueError('A scene reference needs only a supported kind and UUID.')
    return value['kind'], value['id']


def validate_scene(value, graphics, titles, width, height, motion):
    motion.canvas_size(width, height)
    if not isinstance(graphics, list) or len(graphics) > 24 or not isinstance(titles, list) or len(titles) > 80:
        raise ValueError('A motion scene supports at most 24 graphics and eighty titles.')
    if not isinstance(value, dict) or set(value) != {'groups', 'order'}:
        raise ValueError('A motion scene needs only groups and root order.')
    if not isinstance(value['groups'], list) or len(value['groups']) > 8:
        raise ValueError('A motion scene supports at most eight groups.')
    if not isinstance(value['order'], list) or len(value['order']) > 112:
        raise ValueError('A motion scene supports at most 112 root layers.')
    layers, identifiers = {}, set()
    for kind, collection in [('graphic', graphics), ('title', titles)]:
        for layer in collection:
            identifier = layer.get('id')
            if not isinstance(identifier, str) or not UUID.fullmatch(identifier):
                raise ValueError('Scene layers need valid identifiers.')
            key = kind, identifier
            if identifier in identifiers:
                raise ValueError('Scene layer and group identifiers must be globally unique.')
            identifiers.add(identifier)
            for field in ('start', 'end'):
                motion.number(layer.get(field), 0, 600, 'scene child ' + field)
            if layer['end'] < layer['start'] + .25:
                raise ValueError('Scene children need at least a quarter second.')
            if kind == 'title':
                validate_title(layer, motion)
            layers[key] = layer
    groups, children = {}, set()
    for raw in value['groups']:
        required = {'id', 'name', 'start', 'end', 'pivot', 'children'}
        if not isinstance(raw, dict) or set(raw) - (required | {'motion', 'depth', 'shutter'}) or required - set(raw):
            raise ValueError('A motion group contains unsupported or missing fields.')
        group = dict(raw)
        if not isinstance(group['id'], str) or not UUID.fullmatch(group['id']) or group['id'] in identifiers:
            raise ValueError('Motion groups need globally unique UUIDs.')
        identifiers.add(group['id'])
        if not isinstance(group['name'], str) or not 1 <= len(group['name'].strip()) <= 80:
            raise ValueError('A motion group needs a name of at most eighty characters.')
        for field in ('start', 'end'):
            motion.number(group[field], 0, 600, 'group ' + field)
        if group['end'] < group['start'] + .25:
            raise ValueError('A motion group must last at least a quarter second.')
        pivot = group['pivot']
        if not isinstance(pivot, dict) or set(pivot) != {'x', 'y'}:
            raise ValueError('A group pivot needs only x and y.')
        for field in ('x', 'y'):
            motion.number(pivot[field], 0, 1, 'pivot ' + field)
        if 'motion' in group:
            group['motion'] = motion.validate_motion(group['motion'])
        members = group['children']
        if not isinstance(members, list) or not 1 <= len(members) <= 104:
            raise ValueError('A group needs between one and 104 overlay children.')
        for member in members:
            key = reference(member, {'graphic', 'title'})
            if key not in layers or key in children:
                raise ValueError('Each group child must identify one existing, unshared overlay.')
            child = layers[key]
            if child['start'] < group['start'] - 1e-7 or child['end'] > group['end'] + 1e-7:
                raise ValueError('Group children must fit within their parent interval.')
            children.add(key)
        if 'depth' in group:
            group['depth'] = validate_depth(group['depth'], motion)
            # The conservative bound includes every interpolated pose, not just
            # authored endpoints. No near-plane-crossing frame is allocated.
            depth = group['depth']
            extent_x = max(pivot['x'], 1 - pivot['x']) * width
            extent_y = max(pivot['y'], 1 - pivot['y']) * height
            yaw = max(abs(key['yaw']) for key in depth['keys'])
            pitch = max(abs(key['pitch']) for key in depth['keys'])
            nearest = max(key['z'] for key in depth['keys']) * width
            clearance = (depth['perspective'] * width - nearest
                         - math.sin(math.radians(yaw)) * extent_x
                         - math.sin(math.radians(pitch)) * extent_y)
            if clearance <= .05 * width:
                raise ValueError('Group depth approaches the camera plane; increase perspective distance.')
        if 'shutter' in group:
            shutter = group['shutter']
            if (not isinstance(shutter, dict) or set(shutter) != {'samples', 'exposure'}
                    or type(shutter['samples']) is not int or shutter['samples'] not in (3, 5)):
                raise ValueError('Group shutter needs three or five samples and an exposure.')
            motion.number(shutter['exposure'], 0, 1, 'shutter exposure')
        groups[group['id']] = group
    expected = (set(layers) - children) | {('group', identifier) for identifier in groups}
    ordered = [reference(item, {'graphic', 'title', 'group'}) for item in value['order']]
    if len(ordered) != len(set(ordered)) or set(ordered) != expected:
        raise ValueError('Scene root order must cover each ungrouped overlay and group exactly once.')
    return {'groups': list(groups.values()), 'order': list(value['order'])}


def validate_title(title, motion):
    if not isinstance(title.get('text'), str) or not 1 <= len(title['text'].strip()) <= 240:
        raise ValueError('A scene title needs at most 240 characters.')
    if (title.get('style') not in {'headline', 'caption', 'kicker'}
            or title.get('position') not in {'top', 'center', 'bottom'}
            or title.get('animation') not in {'fade', 'rise', 'none', 'build', 'typewriter', 'impact', 'wipe', 'spoken'}):
        raise ValueError('A scene title needs a supported style, position and animation.')
    if not isinstance(title.get('color'), str) or not re.fullmatch(r'#[a-fA-F0-9]{6}', title['color']):
        raise ValueError('A scene title needs a six-digit hex color.')
    if 'fontSize' in title:
        motion.number(title['fontSize'], 16, 180, 'title font size')
    if 'motionDuration' in title:
        motion.number(title['motionDuration'], .15, 4, 'title motion duration')
    if 'words' in title:
        words = title['words']
        if not isinstance(words, list) or not 1 <= len(words) <= 120:
            raise ValueError('A scene title supports at most 120 measured words.')
        previous_end, previous_phrase = 0, 0
        for index, word in enumerate(words):
            if not isinstance(word, dict) or set(word) != {'text', 'start', 'end', 'phrase'}:
                raise ValueError('A scene word needs only text, start, end and phrase.')
            if not isinstance(word['text'], str) or not re.fullmatch(r'\S{1,240}', word['text']):
                raise ValueError('A scene word needs bounded text without spaces.')
            for field in ('start', 'end'):
                motion.number(word[field], 0, 600, 'word ' + field)
            phrase = word['phrase']
            if (word['end'] <= word['start'] or word['start'] < previous_end - 1e-6
                    or word['end'] > title['end'] - title['start'] + .001
                    or type(phrase) is not int or not 0 <= phrase <= 239
                    or (phrase != 0 if not index else not previous_phrase <= phrase <= previous_phrase + 1)):
                raise ValueError('Scene word timings must fit the title in phrase order.')
            previous_end, previous_phrase = word['end'], phrase
        if ' '.join(word['text'] for word in words) != ' '.join(title['text'].split()):
            raise ValueError('Scene words must match their saved title text.')
    elif title['animation'] == 'spoken':
        raise ValueError('Follow voice needs measured word timings.')


def validate_depth(value, motion):
    if not isinstance(value, dict) or set(value) != {'keys', 'perspective'}:
        raise ValueError('Group depth needs only keys and perspective distance.')
    motion.number(value['perspective'], 1.5, 6, 'perspective distance')
    keys = value['keys']
    if not isinstance(keys, list) or not 2 <= len(keys) <= 12:
        raise ValueError('Group depth needs between two and twelve keys.')
    previous = -1
    for key in keys:
        if (not isinstance(key, dict) or set(key) - {'at', 'yaw', 'pitch', 'z', 'easing', 'bezier'}
                or {'at', 'yaw', 'pitch', 'z'} - set(key)):
            raise ValueError('Each depth key needs its time, yaw, pitch and z.')
        for name, low, high in [('at', 0, 1), ('yaw', -35, 35), ('pitch', -35, 35), ('z', -.2, .2)]:
            motion.number(key[name], low, high, 'depth ' + name)
        # The shared validator bounds custom curves, so the clearance below
        # still covers every interpolated pose.
        motion.validate_easing(key)
        if key['at'] <= previous:
            raise ValueError('Depth keys need ordered times and supported destination easing.')
        previous = key['at']
    if keys[0]['at'] != 0 or keys[-1]['at'] != 1:
        raise ValueError('Depth keys must start at zero and end at one.')
    return value


def depth_at(depth, progress, motion):
    if depth is None:
        return {'yaw': 0, 'pitch': 0, 'z': 0, 'perspective': 3}
    keys = depth['keys']
    left = right = keys[-1]
    amount = 0
    for before, after in zip(keys, keys[1:]):
        if progress <= after['at']:
            left, right = before, after
            amount = motion.eased(max(0, (progress - left['at']) / (right['at'] - left['at'])),
                                  right.get('easing', 'linear'), right.get('bezier'))
            break
    return {**{field: left[field] + (right[field] - left[field]) * amount for field in ('yaw', 'pitch', 'z')},
            'perspective': depth['perspective']}


def group_matrix(group, frame, width, height, motion):
    progress = phase(group, frame)
    pose = motion.motion_at(group.get('motion'), progress)
    depth = depth_at(group.get('depth'), progress, motion)
    cx, cy = group['pivot']['x'] * width, group['pivot']['y'] * height
    yaw, pitch, roll = (math.radians(depth['yaw']), math.radians(depth['pitch']), math.radians(pose['rotation']))
    sy, cyaw, sp, cp = math.sin(yaw), math.cos(yaw), math.sin(pitch), math.cos(pitch)
    distance = depth['perspective'] * width
    projection = np.array([[distance * cyaw, distance * sy * sp, 0],
                           [0, distance * cp, 0],
                           [sy, -cyaw * sp, distance - depth['z'] * width]], dtype=np.float64)
    sx, scale_y = pose['scale'] * pose.get('scaleX', 1), pose['scale'] * pose.get('scaleY', 1)
    cosine, sine = math.cos(roll), math.sin(roll)
    affine = np.array([[cosine * sx, -sine * scale_y, cx + pose['x'] * width],
                       [sine * sx, cosine * scale_y, cy + pose['y'] * height],
                       [0, 0, 1]], dtype=np.float64)
    origin = np.array([[1, 0, -cx], [0, 1, -cy], [0, 0, 1]], dtype=np.float64)
    matrix = affine @ projection @ origin
    corners = np.array([[0, 0, 1], [width, 0, 1], [width, height, 1], [0, height, 1]], dtype=np.float64).T
    projected = matrix @ corners
    if not np.isfinite(projected).all() or np.min(projected[2]) <= .05 * width:
        raise ValueError('Group projection crosses the camera plane.')
    if not np.isfinite(matrix).all() or abs(np.linalg.det(matrix)) < 1e-12:
        raise ValueError('Group projection must stay invertible.')
    return matrix / matrix[2, 2], pose['opacity']


def transform_group(picture, group, frame, motion):
    width, height = picture.size
    matrix, opacity = group_matrix(group, frame, width, height, motion)
    inverse = np.linalg.inv(matrix)
    inverse /= inverse[2, 2]
    coefficients = tuple(float(value) for value in inverse.flat)[:8]
    transformed = picture.convert('RGBa').transform((width, height), Image.Transform.PERSPECTIVE,
        coefficients, Image.Resampling.BILINEAR, fillcolor=(0, 0, 0, 0)).convert('RGBA')
    return motion.opacity(transformed, opacity)


def sample_frames(group, frame):
    shutter = group.get('shutter')
    if not shutter or shutter['exposure'] == 0:
        return [float(frame)]
    first, end = frame_bounds(group)
    return [max(first, min(end - 1, frame + ((index + .5) / shutter['samples'] - .5) * shutter['exposure']))
            for index in range(shutter['samples'])]


def graphic_sample(layout, frame, motion):
    """Continuous graphic sampling only for explicitly authored motion scenes."""
    graphic, tile = layout['graphic'], layout['tile']
    width, height = layout['canvas']
    if not active(graphic, frame):
        return Image.new('RGBA', (width, height))
    pose = motion.motion_at(graphic.get('motion'), phase(graphic, frame))
    angle = math.radians(pose['rotation'])
    sx, sy = pose['scale'] * pose.get('scaleX', 1), pose['scale'] * pose.get('scaleY', 1)
    cosine, sine = math.cos(angle) * layout['factor'], math.sin(angle) * layout['factor']
    cx, cy = (graphic['x'] + pose['x']) * width, (graphic['y'] + pose['y']) * height
    a, b, d, e = cosine / sx, sine / sx, -sine / sy, cosine / sy
    coefficients = (a, b, tile.width / 2 - a * cx - b * cy,
                    d, e, tile.height / 2 - d * cx - e * cy)
    return motion.opacity(motion.affine_rgba(tile, (width, height), coefficients), graphic['opacity'] * pose['opacity'])


class SceneRenderer:
    """Render one bounded scene frame; cache layouts, never whole animations."""
    def __init__(self, scene, graphics, titles, width, height, motion, render_child):
        self.scene = validate_scene(scene, graphics, titles, width, height, motion)
        self.size, self.motion, self.render_child = (width, height), motion, render_child
        self.layers = {(kind, layer['id']): layer for kind, collection in [('graphic', graphics), ('title', titles)] for layer in collection}
        self.groups = {group['id']: group for group in self.scene['groups']}
        self.memo = OrderedDict()
        self.memo_bytes = 0

    def child(self, kind, identifier, frame):
        layer = self.layers[kind, identifier]
        return self.render_child(kind, layer, frame) if active(layer, frame) else Image.new('RGBA', self.size)

    def group(self, group, frame):
        if not active(group, frame):
            return Image.new('RGBA', self.size)
        samples = sample_frames(group, frame)
        signatures = [self.signature(group, sample) for sample in samples]
        if signatures[0] is not None and all(key == signatures[0] for key in signatures):
            return self.group_sample(group, frame, signatures[0])
        accumulator = plane = None
        for sample, signature in zip(samples, signatures):
            picture = self.group_sample(group, sample, signature)
            if len(samples) == 1:
                return picture
            values = np.asarray(picture)
            if accumulator is None:
                accumulator = np.zeros((*values.shape[:2], 4), dtype=np.float32)
                plane = np.empty(values.shape[:2], dtype=np.float32)
            # Associate in floating point once. Repeated 8-bit RGBa round-trips
            # can darken even a stationary semitransparent colored edge.
            for channel in range(3):
                np.multiply(values[:, :, channel], values[:, :, 3], out=plane, dtype=np.float32)
                plane *= 1 / 255
                accumulator[:, :, channel] += plane
            accumulator[:, :, 3] += values[:, :, 3]
        accumulator *= 1 / len(samples)
        visible = accumulator[:, :, 3] > 0
        for channel in range(3):
            np.multiply(accumulator[:, :, channel], 255, out=plane)
            np.divide(plane, accumulator[:, :, 3], out=accumulator[:, :, channel], where=visible)
        np.rint(accumulator, out=accumulator)
        np.clip(accumulator, 0, 255, out=accumulator)
        averaged = accumulator.astype(np.uint8)
        return Image.fromarray(averaged)

    def signature(self, group, frame):
        children = []
        for child in group['children']:
            kind, identifier = child['kind'], child['id']
            layer = self.layers[kind, identifier]
            visible = active(layer, frame)
            if visible and kind == 'title' and layer['animation'] != 'none':
                return None
            pose = (self.motion.motion_at(layer.get('motion'), phase(layer, frame)) if visible else None)
            children.append((kind, identifier, visible,
                             tuple(pose[field] for field in self.motion.POSE_FIELDS) if pose else ()))
        matrix, opacity = group_matrix(group, frame, *self.size, self.motion)
        return group['id'], tuple(float(value) for value in matrix.flat), opacity, tuple(children)

    def group_sample(self, group, frame, signature):
        if signature is not None and signature in self.memo:
            self.memo.move_to_end(signature)
            return self.memo[signature]
        picture = Image.new('RGBA', self.size)
        for child in group['children']:
            picture.alpha_composite(self.child(child['kind'], child['id'], frame))
        picture = transform_group(picture, group, frame, self.motion)
        if signature is not None:
            size = self.size[0] * self.size[1] * 4
            while self.memo and self.memo_bytes + size > 64 * 1024 * 1024:
                self.memo.popitem(last=False)
                self.memo_bytes -= size
            self.memo[signature] = picture
            self.memo_bytes += size
        return picture

    def frame(self, frame):
        if type(frame) is not int or frame < 0:
            raise ValueError('Scene output needs a nonnegative absolute integer frame.')
        picture = Image.new('RGBA', self.size)
        for root in self.scene['order']:
            source = (self.groups[root['id']] if root['kind'] == 'group'
                      else self.layers[root['kind'], root['id']])
            if not active(source, frame):
                continue
            layer = (self.group(self.groups[root['id']], frame) if root['kind'] == 'group'
                     else self.child(root['kind'], root['id'], frame))
            picture.alpha_composite(layer)
        return picture
