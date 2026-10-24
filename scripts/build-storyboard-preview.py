"""Cut the start screen's Storyboard card from a recorded storyboard film.

A portrait film plays as three tiles, each starting on a later shot, so the card
shows the story moving; a landscape film fills the card. Run from the repository root:

    python scripts/build-storyboard-preview.py examples/storyboards/skate/film.mp4
"""
import sys
from pathlib import Path
import av
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/start'
WIDTH, HEIGHT, SECONDS = 640, 360, 3


def main(film):
    with av.open(str(film)) as container:
        pictures = [frame.to_image().convert('RGB') for frame in container.decode(video=0)]
    count = SECONDS * 24
    cards = []
    if pictures[0].width > pictures[0].height:
        start = min(len(pictures) - count, 24)
        cards = [picture.resize((WIDTH, HEIGHT), Image.Resampling.LANCZOS) for picture in pictures[start:start + count]]
    else:
        gap = 16
        width = (WIDTH - 4 * gap) // 3
        height = round(width * 16 / 9)
        # Three tiles spread across the film: an opening, the middle and the end.
        starts = [round(i * (len(pictures) - count) / 2) for i in range(3)]
        for index in range(count):
            card = Image.new('RGB', (WIDTH, HEIGHT), (20, 22, 21))
            for column, start in enumerate(starts):
                tile = pictures[min(len(pictures) - 1, start + index)].resize((width, height), Image.Resampling.LANCZOS)
                card.paste(tile, (gap + column * (width + gap), (HEIGHT - height) // 2))
            cards.append(card)
    with av.open(str(OUT / 'storyboard.mp4'), 'w', options={'movflags': '+faststart'}) as container:
        stream = container.add_stream('libx264', rate=24)
        stream.width, stream.height, stream.pix_fmt = WIDTH, HEIGHT, 'yuv420p'
        stream.options = {'crf': '30', 'preset': 'slow'}
        for card in cards:
            for packet in stream.encode(av.VideoFrame.from_image(card)):
                container.mux(packet)
        for packet in stream.encode():
            container.mux(packet)
    cards[round(len(cards) * 0.6)].save(OUT / 'storyboard.jpg', quality=82)
    print(f'Wrote the Storyboard card from {film}.')


if __name__ == '__main__':
    main(Path(sys.argv[1]))
