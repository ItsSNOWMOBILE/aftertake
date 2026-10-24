"""Cut the one-tap gallery's preview loops from each preset's recorded result.

Every preset in presets/one-tap has a real result in examples/one-tap/<id>/result.mp4,
made by Aftertake. This writes a small silent loop and poster per preset to
public/one-tap, and the start screen's One-tap effects card (three results side by
side) to public/start/effects. Run from the repository root:

    python scripts/build-one-tap-previews.py
"""
import json
from pathlib import Path
import av
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
EXAMPLES = ROOT / 'examples/one-tap'
OUT = ROOT / 'public/one-tap'
START = ROOT / 'public/start'
CARD_WIDTH, CARD_HEIGHT = 270, 480
START_WIDTH, START_HEIGHT, START_SECONDS = 640, 360, 3
# The start card shows three different looks: a camera move, a wipe and a light change.
START_PRESETS = ['punch-in', 'before-after', 'neon-night']


def frames(path):
    with av.open(str(path)) as container:
        return [frame.to_image().convert('RGB') for frame in container.decode(video=0)]


def write(pictures, output, crf=28):
    with av.open(str(output), 'w', options={'movflags': '+faststart'}) as container:
        stream = container.add_stream('libx264', rate=24)
        stream.width, stream.height = pictures[0].size
        stream.pix_fmt = 'yuv420p'
        stream.options = {'crf': str(crf), 'preset': 'slow'}
        for picture in pictures:
            for packet in stream.encode(av.VideoFrame.from_image(picture)):
                container.mux(packet)
        for packet in stream.encode():
            container.mux(packet)


def poster(pictures, output):
    # A moment after the title lands reads better than the first frame.
    pictures[round(len(pictures) * 0.7)].save(output, quality=82)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    presets = sorted(json.loads(path.read_text(encoding='utf8'))['id'] for path in (ROOT / 'presets/one-tap').glob('*.json'))
    results = {}
    for preset in presets:
        source = EXAMPLES / preset / 'result.mp4'
        if not source.exists():
            raise SystemExit(f'{preset} has no recorded result at {source.relative_to(ROOT)}.')
        pictures = [picture.resize((CARD_WIDTH, CARD_HEIGHT), Image.Resampling.LANCZOS) for picture in frames(source)]
        results[preset] = pictures
        write(pictures, OUT / f'{preset}.mp4')
        poster(pictures, OUT / f'{preset}.jpg')
    gap, count = 16, START_SECONDS * 24
    width = (START_WIDTH - gap * (len(START_PRESETS) + 1)) // len(START_PRESETS)
    height = round(width * 16 / 9)
    tiles = [[picture.resize((width, height), Image.Resampling.LANCZOS) for picture in frames(EXAMPLES / preset / 'result.mp4')]
             for preset in START_PRESETS]
    cards = []
    for index in range(count):
        card = Image.new('RGB', (START_WIDTH, START_HEIGHT), (20, 22, 21))
        for column, pictures in enumerate(tiles):
            # Each column starts later in its clip so the three moves peak at different times.
            picture = pictures[min(len(pictures) - 1, index + column * 12)]
            card.paste(picture, (gap + column * (width + gap), (START_HEIGHT - height) // 2))
        cards.append(card)
    write(cards, START / 'effects.mp4', crf=30)
    cards[round(count * 0.6)].save(START / 'effects.jpg', quality=82)
    total = sum(path.stat().st_size for path in OUT.iterdir())
    print(f'Wrote {len(presets)} previews to {OUT.relative_to(ROOT)} ({total / 1e6:.1f} MB) and the start card.')


if __name__ == '__main__':
    main()
