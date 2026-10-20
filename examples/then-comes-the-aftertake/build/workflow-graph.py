"""Draw a saved ComfyUI API graph as a 1920x1080 still for the film.

Every node and link comes from the workflow-api.json Aftertake submitted
through the Comfy SDK; nothing is added. Nodes sit in columns by dependency
depth, and Aftertake's own custom nodes are drawn in lime.

    python workflow-graph.py examples/portal/workflow-api.json out.png
"""
import json
import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[3]
W, H = 1920, 1080
BG, GRID = (14, 18, 15), (30, 37, 31)
NODE, TEXT, DIM = (27, 33, 28), (226, 230, 220), (128, 140, 124)
LIME, HOT, BLUE = (213, 235, 148), (255, 107, 61), (124, 199, 255)


def accent(kind):
    if kind.startswith('Aftertake'):
        return LIME
    if 'Sampler' in kind or 'Guider' in kind or kind in ('RandomNoise', 'ManualSigmas'):
        return HOT
    if 'Loader' in kind:
        return BLUE
    return DIM


def layout(graph):
    links = {key: [value[0] for value in node['inputs'].values() if isinstance(value, list)] for key, node in graph.items()}
    depth = {}
    def walk(key):
        if key not in depth:
            depth[key] = 1 + max((walk(parent) for parent in links[key]), default=-1)
        return depth[key]
    for key in graph:
        walk(key)
    columns = {}
    for key in sorted(graph, key=int):
        columns.setdefault(depth[key], []).append(key)
    return links, columns


def main(source, output):
    graph = json.loads(Path(source).read_text(encoding='utf-8'))
    links, columns = layout(graph)
    font = ImageFont.truetype(str(ROOT / 'public/fonts/jetbrains-mono.ttf'), 14)
    small = ImageFont.truetype(str(ROOT / 'public/fonts/jetbrains-mono.ttf'), 12)
    image = Image.new('RGB', (W, H), BG)
    draw = ImageDraw.Draw(image, 'RGBA')
    for x in range(0, W, 32):
        for y in range(0, H, 32):
            draw.point((x, y), fill=GRID)
    # The graph is long, so it folds into two rows that read left to right,
    # leaving the top and bottom of the frame free for the film's titles.
    count = len(columns)
    half = -(-count // 2)
    left, right = 60, W - 60
    bands = [(190, 575), (610, 935)]
    box_w = (right - left) / half - 16
    places = {}
    for column, keys in columns.items():
        top, bottom = bands[column // half]
        x = left + (column % half) * (right - left - box_w) / max(1, half - 1)
        step = min(62, (bottom - top) / len(keys))
        y0 = (top + bottom) / 2 - step * len(keys) / 2
        for row, key in enumerate(keys):
            places[key] = (x, y0 + row * step, x + box_w, y0 + row * step + step - 10)
    for key, parents in links.items():
        x1, y1, _, y2 = places[key]
        for parent in parents:
            _, py1, px2, py2 = places[parent]
            start, end = (px2, (py1 + py2) / 2), (x1, (y1 + y2) / 2)
            span = (end[0] - start[0]) * 0.5
            points = []
            for index in range(25):
                t = index / 24
                points.append((
                    (1 - t) ** 3 * start[0] + 3 * (1 - t) ** 2 * t * (start[0] + span) + 3 * (1 - t) * t ** 2 * (end[0] - span) + t ** 3 * end[0],
                    (1 - t) ** 3 * start[1] + 3 * (1 - t) ** 2 * t * start[1] + 3 * (1 - t) * t ** 2 * end[1] + t ** 3 * end[1]))
            colour = accent(graph[parent]['class_type'])
            draw.line(points, fill=(*colour, 120), width=2)
    for key, (x1, y1, x2, y2) in places.items():
        kind = graph[key]['class_type']
        colour = accent(kind)
        custom = kind.startswith('Aftertake')
        draw.rounded_rectangle((x1, y1, x2, y2), radius=7, fill=(48, 58, 36) if custom else NODE,
            outline=colour, width=3 if custom else 1)
        draw.rectangle((x1 + 1, y1 + 1, x1 + 6, y2 - 1), fill=colour)
        # Crowded columns get one line per node.
        tight = y2 - y1 < 40
        room = x2 - x1 - 20 - draw.textlength(f' #{key}', font=small)
        words = re.findall(r'[A-Z]+(?![a-z])|[A-Z][a-z0-9]*|[a-z0-9]+', kind)
        lines, line = [], ''
        for word in words:
            if line and not tight and draw.textlength(line + word, font=font) > room:
                lines.append(line)
                line = word
            else:
                line += word
        lines.append(line)
        if len(lines) > 2:
            lines = [lines[0], ''.join(lines[1:])]
        for index, text in enumerate(lines):
            while draw.textlength(text, font=font) > room:
                text = text[:-2] + '…'
            draw.text((x1 + 13, y1 + (y2 - y1 - 16) / 2 if tight else y1 + 4 + index * 16), text, font=font, fill=TEXT)
        draw.text((x2 - 8, y1 + (y2 - y1 - 13) / 2 if tight else y1 + 5), f'#{key}', font=small, fill=colour if custom else DIM, anchor='ra')
    image.save(output)


if __name__ == '__main__':
    main(*sys.argv[1:3])
