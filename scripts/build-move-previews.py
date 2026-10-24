"""Cut the moves gallery's preview loops from real Animate a frame takes.

Each camera move in src/cinema.ts has a take rendered by Aftertake from the same
still in examples/camera-moves/<move>/take.mp4. This writes a small silent loop and
a poster per move to public/moves. Run from the repository root:

    python scripts/build-move-previews.py
"""
import re
from pathlib import Path
import av
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
TAKES = ROOT / 'examples/camera-moves'
OUT = ROOT / 'public/moves'
WIDTH, HEIGHT = 320, 180


def moves():
    source = (ROOT / 'src/cinema.ts').read_text(encoding='utf8')
    listed = source[source.index('export const cameraMovements = ['):source.index('] as const;')]
    return re.findall(r"'([a-z0-9-]+)'", listed)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for move in moves():
        take = TAKES / move / 'take.mp4'
        if not take.exists():
            raise SystemExit(f'{move} has no recorded take at {take.relative_to(ROOT)}.')
        with av.open(str(take)) as container:
            pictures = [frame.to_image().convert('RGB').resize((WIDTH, HEIGHT), Image.Resampling.LANCZOS)
                        for frame in container.decode(video=0)]
        with av.open(str(OUT / f'{move}.mp4'), 'w', options={'movflags': '+faststart'}) as container:
            stream = container.add_stream('libx264', rate=24)
            stream.width, stream.height, stream.pix_fmt = WIDTH, HEIGHT, 'yuv420p'
            stream.options = {'crf': '30', 'preset': 'slow'}
            for picture in pictures:
                for packet in stream.encode(av.VideoFrame.from_image(picture)):
                    container.mux(packet)
            for packet in stream.encode():
                container.mux(packet)
        # The middle of the move shows what it does better than its first frame.
        pictures[len(pictures) // 2].save(OUT / f'{move}.jpg', quality=80)
    total = sum(path.stat().st_size for path in OUT.iterdir())
    print(f'Wrote {len(moves())} move previews to {OUT.relative_to(ROOT)} ({total / 1e6:.1f} MB).')


if __name__ == '__main__':
    main()
