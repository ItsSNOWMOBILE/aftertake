"""Cut the start screen's and starter gallery's previews from real outputs.

Each preview is a silent three-second loop at 640x360 with a poster frame, small
enough to autoplay on the start screen. Before/after cards cut from the source to
the Aftertake result at the same moment. The finish card's two looks are graded
with the actual Color & finish processor. Run from the repository root:

    python scripts/build-start-previews.py
"""
import hashlib
import json
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/start'
STARTER_OUT = ROOT / 'public/starters'
EX = ROOT / 'examples'
SECONDS, WIDTH, HEIGHT = 3, 640, 360
# The finished film is a release download, not part of the repository.
FILM = EX / 'then-comes-the-aftertake/film.mp4'
FILM_URL = ('https://github.com/ItsSNOWMOBILE/aftertake/releases/download/'
            'then-comes-the-aftertake-2026-10-22/then-comes-the-aftertake.mp4')
FILM_SHA256 = 'f80e3b10c57755e3f7833e66adc96a3011fb97b60c13dc4d460e2f7f789f617d'

# card id -> segments of (file, start seconds, length seconds); stills get a slow push.
CARDS = {
    'video': [(EX / 'then-comes-the-aftertake/proof/product-showcase.generated.mp4', 0.5, 3)],
    'image': [(EX / 'then-comes-the-aftertake/proof/hero-banner.generated.png', 0, 3)],
    'region': [(EX / 'portal-v2/source.mp4', 0.4, 1.4), (EX / 'portal-v2/result.mp4', 1.8, 1.6)],
    'person': [(EX / 'character-h3-high-v2/before-720p.mp4', 0.2, 1.3), (EX / 'character-h3-high-v2/result.mp4', 1.5, 1.5)],
    'camera': [(EX / 'castle-pullback-v2/result.mp4', 0.6, 3)],
    'motion': [(EX / 'signal-v2/source.mp4', 0.6, 1.4), (EX / 'signal-v2/result.mp4', 2.0, 1.6)],
    'film': [(FILM, 59.6, 3)],
}
# Starters with a real output made from them (both from the recorded proof run).
STARTERS = {
    'hero-banner': [(EX / 'then-comes-the-aftertake/proof/hero-banner.generated.png', 0, 3)],
    'product-showcase': [(EX / 'then-comes-the-aftertake/proof/product-showcase.generated.mp4', 0.5, 3)],
}
LOOKS = {
    'warm-film': dict(preset='warm-film', lookStrength=1, halationStrength=.6, halationRadius=10, vignette=.35, contrast=.15),
    'noir': dict(preset='noir', lookStrength=1, contrast=.35, grain=.35, vignette=.45),
}
NEUTRAL = dict(exposureEV=0, contrast=0, saturation=0, temperature=0, tint=0, sharpen=0, vignette=0, grain=0,
               preset='clean', lookStrength=0, seed=42)
FRAME = f'scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=increase,crop={WIDTH}:{HEIGHT},fps=24,setsar=1'


def ffmpeg(*args):
    subprocess.run(['ffmpeg', '-v', 'error', '-y', *map(str, args)], check=True)


def fetch_film():
    """Download the finished film from its release once, checking its SHA-256."""
    if FILM.exists():
        return
    print(f'Downloading the film from {FILM_URL}')
    partial = FILM.with_suffix('.part')
    with urllib.request.urlopen(FILM_URL) as response, partial.open('wb') as file:
        while chunk := response.read(1 << 20):
            file.write(chunk)
    if hashlib.sha256(partial.read_bytes()).hexdigest() != FILM_SHA256:
        partial.unlink()
        raise SystemExit('The downloaded film does not match its published SHA-256.')
    partial.rename(FILM)


def encode(segments, output):
    inputs, chains = [], []
    for index, (path, start, length) in enumerate(segments):
        if path.suffix == '.png':
            inputs += ['-loop', '1', '-t', length, '-i', path]
            frames = round(length * 24)
            chains.append(f'[{index}:v]{FRAME},zoompan=z=\'1+0.06*on/{frames}\':d={frames}:s={WIDTH}x{HEIGHT}:fps=24,'
                          f'trim=duration={length},setpts=PTS-STARTPTS[v{index}]')
        else:
            inputs += ['-ss', start, '-t', length, '-i', path]
            chains.append(f'[{index}:v]{FRAME},setpts=PTS-STARTPTS[v{index}]')
    joined = ''.join(f'[v{index}]' for index in range(len(segments)))
    graph = ';'.join(chains) + f';{joined}concat=n={len(segments)}:v=1:a=0,format=yuv420p[out]'
    ffmpeg(*inputs, '-filter_complex', graph, '-map', '[out]', '-an', '-c:v', 'libx264', '-crf', 28,
           '-preset', 'slow', '-movflags', '+faststart', '-t', SECONDS, output)
    ffmpeg('-i', output, '-frames:v', 1, '-q:v', 4, output.with_suffix('.jpg'))


def graded(source, look, folder):
    """Grade a still with the real Color & finish processor; returns the output path."""
    probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries',
        'stream=width,height', '-of', 'json', str(source)]))
    clip = {'id': '3f0d2a8e-6b1c-4c55-9a7e-2d8b1e4f6a10', 'name': source.name, 'kind': 'image', 'url': '/media/x.png',
            'width': probe['streams'][0]['width'], 'height': probe['streams'][0]['height'], 'hasAudio': False,
            'duration': 1, 'sha256': hashlib.sha256(source.read_bytes()).hexdigest()}
    output = folder / f'{look}.png'
    work = folder / f'{look}.json'
    work.write_text(json.dumps({'source': str(source), 'output': str(output), 'receipt': str(folder / f'{look}.receipt.json'),
        'mode': 'finish', 'request': {'format': 'aftertake-finishing/1', 'name': look, 'clip': clip,
            'settings': {**NEUTRAL, **LOOKS[look]}}}))
    subprocess.run([sys.executable, str(ROOT / 'scripts/finish-media.py'), str(work)], check=True, capture_output=True)
    return output


def main():
    fetch_film()
    OUT.mkdir(parents=True, exist_ok=True)
    for card, segments in CARDS.items():
        encode(segments, OUT / f'{card}.mp4')
    with tempfile.TemporaryDirectory() as temporary:
        folder = Path(temporary)
        portrait = EX / 'depth-effects-v2/source.png'
        warm, noir = graded(portrait, 'warm-film', folder), graded(portrait, 'noir', folder)
        encode([(warm, 0, 1.5), (noir, 0, 1.5)], OUT / 'finish.mp4')
    STARTER_OUT.mkdir(parents=True, exist_ok=True)
    for starter, segments in STARTERS.items():
        encode(segments, STARTER_OUT / f'{starter}.mp4')
    for folder in (OUT, STARTER_OUT):
        total = sum(path.stat().st_size for path in folder.iterdir())
        print(f'Wrote previews to {folder.relative_to(ROOT)} ({total / 1e6:.1f} MB)')


if __name__ == '__main__':
    main()
