"""Render an original procedural camera study. No external media or model needed."""
from pathlib import Path
from fractions import Fraction
import hashlib
import json
import uuid
import av
import numpy as np

root = Path(__file__).resolve().parents[1]
out = root / '.data' / 'clips'
out.mkdir(parents=True, exist_ok=True)
id = 'a7e24e70-2168-4e9c-b97f-06ae1401f558'
target = out / f'{id}.mp4'
w, h, fps, count = 768, 448, 24, 120
y, x = np.mgrid[0:h, 0:w].astype(np.float32)
base = np.stack([(x - w / 2) / (h * .9), -(y - h / 2) / (h * .9), np.ones_like(x)], -1)
base /= np.linalg.norm(base, axis=-1, keepdims=True)
rng = np.random.default_rng(27)
grain = rng.normal(0, 0.012, (h, w, 1))

with av.open(str(target), 'w') as container:
    stream = container.add_stream('libx264', rate=Fraction(fps))
    stream.width, stream.height, stream.pix_fmt = w, h, 'yuv420p'
    stream.options = {'crf': '17', 'preset': 'fast'}
    for frame_idx in range(count):
        t = frame_idx / (count - 1)
        origin = np.array([0.10 * np.sin(t * 1.4), 1.65, -3.6 + t * .45])
        rays = base.copy()
        # Box-room ray intersections: left, right, floor, ceiling, back wall.
        candidates = []
        with np.errstate(divide='ignore', invalid='ignore'):
            for axis, value in [(0, -3.2), (0, 3.2), (1, 0), (1, 4), (2, 7)]:
                distance = (value - origin[axis]) / rays[..., axis]
                candidates.append(np.where(distance > 0, distance, np.inf))
        distances = np.stack(candidates, -1)
        face = distances.argmin(-1)
        hit = origin + rays * distances.min(-1)[..., None]
        hx, hy, hz = hit[..., 0], hit[..., 1], hit[..., 2]
        colors = np.array([[.58, .57, .52], [.53, .52, .47], [.48, .46, .40], [.66, .65, .59], [.70, .69, .62]])
        rgb = colors[face].copy()
        # Stone panel joints, subtle concrete grain, and indirect warm lighting.
        joints = np.minimum(np.abs((hz + .02) % 2 - .02), np.abs((hx + .02) % 1.6 - .02)) < .015
        rgb *= np.where((face == 2) & joints, .84, 1)[..., None]
        shade = .7 + .3 * np.clip((hz + 4) / 11, 0, 1)
        rgb *= shade[..., None]
        window = (face == 4) & (np.abs(hx) < 1.12) & (hy > .25) & (hy < 3.4)
        sky = np.stack([.65 + hy * .035, .75 + hy * .02, .72 + hy * .045], -1)
        distant = (np.sin(hx * 9) * .22 + .75 > hy) & window
        sky[distant] = [.35, .43, .31]
        rgb[window] = sky[window]
        trim = (face == 4) & (np.abs(hx) < 1.35) & (hy < 3.62) & (hy > .05) & ~window
        rgb[trim] *= .62
        # A shaft of light projected onto the floor.
        sunlight = (face == 2) & (hx > -.9 + (7 - hz) * .23) & (hx < 1.05 + (7 - hz) * .23) & (hz > -.2)
        rgb[sunlight] = np.minimum(1, rgb[sunlight] * 1.37 + [.12, .08, .025])
        edge = np.clip((1 - ((x - w / 2) / w) ** 2 * .3 - ((y - h / 2) / h) ** 2 * .2), .6, 1)
        rgb = np.clip((rgb + grain) * edge[..., None], 0, 1)
        pixels = (rgb * 255).astype(np.uint8)
        for packet in stream.encode(av.VideoFrame.from_ndarray(pixels, format='rgb24')):
            container.mux(packet)
    for packet in stream.encode(): container.mux(packet)

clip = {'id': id, 'name': 'The light room · camera study.mp4', 'sha256': hashlib.sha256(target.read_bytes()).hexdigest(),
        'width': w, 'height': h, 'duration': count / fps, 'url': f'/media/{target.name}'}
(out / f'{id}.json').write_text(json.dumps(clip, indent=2), encoding='utf-8')
print(f'Created original camera study: {target}')
