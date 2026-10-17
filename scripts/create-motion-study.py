"""Original articulated robot gesture, rendered from code. MIT / Aftertake."""
from fractions import Fraction
import argparse
import json
import math
from pathlib import Path

import av
from PIL import Image, ImageDraw

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1] / '.runtime/motion-study')
args = parser.parse_args()
folder = args.output.resolve(); folder.mkdir(parents=True, exist_ok=True)
width, height, fps, frames = 576, 768, 24, 97
sx, sy = 432 / 480, height / 832
offset = (width - 432) // 2

def point(p): return (round(p[0] * sx) + offset, round(p[1] * sy))
def ease(t): return max(0, min(1, t)) ** 2 * (3 - 2 * max(0, min(1, t)))
def circle(draw, p, r, color):
    x, y = point(p); rr = r * sx
    draw.ellipse((x - rr, y - rr, x + rr, y + rr), fill=color)
def capsule(draw, a, b, r):
    draw.line([point(a), point(b)], fill='#123354', width=round(r * 2 * sx + 6))
    for shrink, color in [(0, '#2678b1'), (5, '#439ed0'), (12, '#69b7dc')]:
        draw.line([point((a[0] - shrink / 5, a[1])), point((b[0] - shrink / 5, b[1]))], fill=color, width=max(2, round((r * 2 - shrink) * sx)))
    circle(draw, a, r, '#318bbf'); circle(draw, b, r, '#318bbf')

poses = []
def render(index):
    t = max(0, min(3, (index / fps - .45) * 3 / 3.1))
    lift = ease(t / .8) * (1 - ease((t - 2.15) / .85))
    bounce = 3 * math.sin(t * math.pi * 2) * lift
    sway = 5 * math.sin(t * math.pi) * lift
    image = Image.new('RGB', (width, height), '#e7e8e4')
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, round(height * .83), width, height), fill='#d8dbd5')
    draw.ellipse((offset + round(432 * .24), round(height * .85), offset + round(432 * .76), round(height * .91)), fill='#c2c8c2')
    shoulders = [(198 + sway, 342 + bounce), (282 + sway, 342 + bounce)]
    hips = [(216 + sway, 516 + bounce), (264 + sway, 516 + bounce)]
    feet = [(194, 738), (286, 738)]
    knees = [(202 + sway * .4, 628), (278 + sway * .4, 628)]
    for hip, knee, foot in zip(hips, knees, feet):
        capsule(draw, hip, knee, 22); capsule(draw, knee, foot, 19)
        x, y = point(foot); draw.rounded_rectangle((x - 29 * sx, y - 12 * sy, x + 30 * sx, y + 16 * sy), radius=12 * sx, fill='#193f5e')
        circle(draw, knee, 23, '#183e5b'); circle(draw, knee, 12, '#71b9db')
    left_elbow = (165 + sway, 426 + bounce)
    left_hand = (158 + sway - 8 * lift, 513 + bounce)
    theta = .18 + 1.25 * lift
    shoulder = shoulders[1]
    right_elbow = (shoulder[0] + math.sin(theta) * 88, shoulder[1] + math.cos(theta) * 88)
    forearm = .12 + lift * (2.1 + .34 * math.sin(t * math.pi * 3.3))
    right_hand = (right_elbow[0] + math.sin(forearm) * 91, right_elbow[1] + math.cos(forearm) * 91)
    for shoulder, elbow, hand in [(shoulders[0], left_elbow, left_hand), (shoulders[1], right_elbow, right_hand)]:
        capsule(draw, shoulder, elbow, 21); capsule(draw, elbow, hand, 18)
        circle(draw, elbow, 21, '#173a59'); circle(draw, elbow, 11, '#74bfdc')
        circle(draw, hand, 23, '#347fac'); circle(draw, (hand[0] - 6, hand[1] - 6), 8, '#87c8e0')
    x0, y0 = point((181 + sway, 318 + bounce)); x1, y1 = point((299 + sway, 544 + bounce))
    draw.rounded_rectangle((x0, y0, x1, y1), radius=27 * sx, fill='#143b5a')
    draw.rounded_rectangle((x0 + 7, y0 + 5, x1 - 7, y1 - 15), radius=23 * sx, fill='#358cbd')
    draw.rounded_rectangle((x0 + 18, y0 + 21, x1 - 18, y0 + 127), radius=15 * sx, fill='#69b4d6')
    circle(draw, (240 + sway, 457 + bounce), 15, '#193f5f'); circle(draw, (240 + sway, 457 + bounce), 7, '#a9e4ed')
    capsule(draw, (240 + sway, 314 + bounce), (240 + sway, 292 + bounce), 18)
    x0, y0 = point((178 + sway, 193 + bounce)); x1, y1 = point((302 + sway, 305 + bounce))
    draw.rounded_rectangle((x0 - 5, y0 - 3, x1 + 5, y1 + 3), radius=25 * sx, fill='#173c58')
    draw.rounded_rectangle((x0, y0, x1, y1), radius=23 * sx, fill='#5bb0d5')
    for eye_x in [213 + sway, 267 + sway]:
        circle(draw, (eye_x, 239 + bounce), 15, '#e6f5f4'); circle(draw, (eye_x + 2, 240 + bounce), 7, '#183d52')
    draw.arc((*point((218 + sway, 256 + bounce)), *point((262 + sway, 282 + bounce))), 5, 175, fill='#1a4864', width=3)
    draw.line([point((240 + sway, 193 + bounce)), point((240 + sway, 166 + bounce))], fill='#214b68', width=6)
    circle(draw, (240 + sway, 159 + bounce), 11, '#f4bc54')
    assert 0 < point(right_hand)[0] - 24 * sx and point(right_hand)[0] + 24 * sx < width, 'Keep the entire gesture in frame'
    poses.append({'frame': index, 'seconds': index / fps, 'rightShoulder': point(shoulders[1]), 'rightElbow': point(right_elbow), 'rightHand': point(right_hand)})
    return image

with av.open(str(folder / 'robot-wave.mp4'), 'w') as container:
    stream = container.add_stream('libx264', rate=fps)
    stream.width, stream.height, stream.pix_fmt = width, height, 'yuv420p'
    stream.options = {'crf': '16', 'preset': 'fast'}
    container.metadata['comment'] = json.dumps({'creator': 'Aftertake contributors', 'license': 'MIT', 'kind': 'original procedural gesture study'})
    for i in range(frames):
        image = render(i)
        if i == 0: image.save(folder / 'robot-start.png')
        if i == frames // 2: image.save(folder / 'robot-wave-middle.png')
        frame = av.VideoFrame.from_image(image); frame.pts = i; frame.time_base = Fraction(1, fps)
        for packet in stream.encode(frame): container.mux(packet)
    for packet in stream.encode(): container.mux(packet)
(folder / 'robot-poses.json').write_text(json.dumps({'width': width, 'height': height, 'fps': fps, 'frames': poses}, indent=2) + '\n')
print(json.dumps({'source': str(folder / 'robot-wave.mp4'), 'width': width, 'height': height, 'frames': frames, 'fps': fps}))
