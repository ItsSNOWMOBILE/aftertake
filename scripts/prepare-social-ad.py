"""Prepare two editable vertical coffee ads for native Aftertake export.

Download the three credited Pexels clips first. This script imports footage and
generates generic local narration; export each project in the Film editor.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import urllib.request
from urllib.parse import quote, urlsplit
import uuid

import imageio_ffmpeg
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--url', default='http://127.0.0.1:4322')
parser.add_argument('--downloads', type=Path, default=Path.home() / 'Downloads')
args = parser.parse_args()
base = urlsplit(args.url)
if base.scheme != 'http' or base.hostname not in ['localhost', '127.0.0.1'] or base.username or base.password or base.path not in ['', '/'] or base.query or base.fragment:
    parser.error('Choose a local Aftertake studio URL.')
BASE = args.url.rstrip('/')
OUT = ROOT / 'examples/social-ad'
MEDIA = OUT / 'media'
MEDIA.mkdir(parents=True, exist_ok=True)


def api(path, payload=None, name=None):
    headers = {'Content-Type': 'application/octet-stream' if name else 'application/json'}
    body = payload if name else json.dumps(payload).encode() if payload is not None else None
    if name:
        path += '?name=' + quote(name)
    with urllib.request.urlopen(urllib.request.Request(BASE + path, data=body, headers=headers), timeout=250) as response:
        return json.load(response)


assets = api('/api/films/assets')
files = {}


def register(path, asset=None):
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    asset = asset or next((a for a in assets if a['sha256'] == digest), None)
    if not asset:
        asset = api('/api/films/assets', path.read_bytes(), path.name)
        assets.append(asset)
    assert asset['sha256'] == digest
    files[asset['id']] = {'path': path.relative_to(ROOT).as_posix(), 'sha256': digest}
    return asset


sources = []
footage = {}
for name, media_id, slug in [
    ('pour', '7118100', 'pouring-black-coffee-into-a-cup'),
    ('grounds', '7118095', 'putting-coffee-powder-into-a-paper-filter'),
    ('brew', '7118104', 'pouring-hot-water-into-a-coffee-dripper'),
]:
    original = args.downloads / f'{media_id}-uhd_1440_2560_25fps.mp4'
    target = MEDIA / f'{name}.mp4'
    if not target.exists():
        if not original.exists():
            parser.error(f'Download https://www.pexels.com/video/{slug}-{media_id}/ first.')
        subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-v', 'error', '-y', '-i', str(original),
            '-t', '10', '-an', '-vf', 'scale=720:1280,setsar=1,fps=24', '-frames:v', '240',
            '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p', str(target)], check=True)
    footage[name] = register(target)
    sources.append({'file': target.relative_to(ROOT).as_posix(), 'sha256': footage[name]['sha256'],
        'originalSHA256': hashlib.sha256(original.read_bytes()).hexdigest() if original.exists() else None,
        'author': 'Michael Burrows', 'sourceUrl': f'https://www.pexels.com/video/{slug}-{media_id}/',
        'license': 'Pexels License', 'licenseUrl': 'https://www.pexels.com/license/',
        'preparation': 'Silent first ten seconds, scaled to 720x1280 at 24 fps. No generated motion or stabilization.'})
Image.new('RGB', (720, 1280), '#1b1410').save(MEDIA / 'brand-canvas.png')
canvas = register(MEDIA / 'brand-canvas.png')


def voice(name, text):
    path = MEDIA / f'voice-{name}.wav'
    if path.exists():
        return register(path)
    asset = next((a for a in assets if a.get('narration', {}).get('text') == text and
        a['narration'].get('voice') == 'af_heart' and a['narration'].get('speed') == 1), None)
    if not asset:
        asset = api('/api/films/narration', {'text': text, 'voice': 'af_heart', 'speed': 1})
        assets.append(asset)
    with urllib.request.urlopen(BASE + asset['url']) as response:
        path.write_bytes(response.read())
    return register(path, asset)


voices = {name: voice(name, text) for name, text in [
    ('hook-a', 'Your morning called.'), ('hook-b', 'Make your morning a little slower.'),
    ('ground', 'Ground.'), ('pour', 'Pour.'), ('pause', 'Pause.'),
    ('cta', 'Slow mornings. Find your next cup.'),
]}


def title(text, start, end, size, position='center', animation='build', color='#fff2db', style='headline', entrance=.5):
    return {'id': str(uuid.uuid5(uuid.NAMESPACE_URL, f'aftertake-social:{text}:{start}')),
        'text': text, 'start': start, 'end': end, 'fontSize': size, 'style': style,
        'position': position, 'animation': animation, 'motionDuration': entrance, 'color': color}


for variant, hook_text in [('a', 'YOUR MORNING\nCALLED.'), ('b', 'MAKE YOUR MORNING\nA LITTLE SLOWER.')]:
    shots = []
    for key, start, end in [('pour', 1, 4), ('grounds', 3, 4.25), ('brew', 4, 5.25), ('pour', 7, 8.25)]:
        asset = footage[key]
        shots.append({'assetId': asset['id'], 'start': start, 'end': end, 'sha256': asset['sha256']})
    shots.append({'assetId': canvas['id'], 'start': 0, 'end': 3.75, 'sha256': canvas['sha256']})
    titles = [title(hook_text, .12, 2.9, 125 if variant == 'a' else 108, entrance=.65),
        title('GROUND.', 3.08, 4.2, 142, animation='impact', entrance=.25),
        title('POUR.', 4.33, 5.45, 142, animation='impact', entrance=.25),
        title('PAUSE.', 5.58, 6.7, 142, animation='impact', entrance=.25),
        title('SLOW\nMORNINGS', 6.87, 10.4, 150, entrance=.55),
        title('FIND YOUR NEXT CUP', 8.05, 10.4, 66, position='bottom', animation='wipe', entrance=.4),
        title('COFFEE, AT YOUR PACE', 6.87, 10.4, 35, position='top', animation='fade', style='kicker'),
    ]
    audio = []
    for name, at, until in [(f'hook-{variant}', .16, 3), ('ground', 3.12, 4.25), ('pour', 4.37, 5.5), ('pause', 5.62, 6.75), ('cta', 6.93, 10.5)]:
        asset = voices[name]
        if at + asset['duration'] > until - .07:
            raise ValueError(f'{name} needs more time: {asset["duration"]}')
        audio.append({'assetId': asset['id'], 'start': at, 'sourceStart': 0, 'sourceEnd': asset['duration'],
            'volume': 1, 'sha256': asset['sha256']})
    project = {'format': 'aftertake-film/2', 'name': f'Slow Mornings — vertical ad / hook {variant.upper()}',
        'aspect': 'portrait', 'shots': shots, 'titles': titles, 'audio': audio,
        'sourceVolume': 0, 'normalizeAudio': True, 'sourceFiles': files,
        'notes': 'Fictional coffee concept ad. Actual licensed footage with editable timed lettering and generic local Kokoro narration. Two manually prepared hooks; no performance testing or automatic ad optimization claimed.'}
    (OUT / f'project-{variant}.json').write_text(json.dumps(project, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    api('/api/films/resolve', project)
    print(json.dumps({'variant': variant, 'duration': 10.5, 'voiceDurations': {name: v['duration'] for name, v in voices.items()}}), flush=True)
(OUT / 'sources.json').write_text(json.dumps({'downloadedAt': '2026-10-18', 'clips': sources,
    'concept': 'Slow Mornings is a fictional concept for this editing demonstration; no endorsement or real offer.'}, indent=2) + '\n', encoding='utf-8')
(OUT / 'ATTRIBUTION.txt').write_text('Footage: Michael Burrows / Pexels. Pexels License: https://www.pexels.com/license/\nOriginal clip links and checksums: sources.json\nNarration: local Kokoro, generic af_heart voice. Fonts: Manrope and DM Sans (OFL).\nSlow Mornings is a fictional coffee concept. No affiliation or endorsement.\n', encoding='utf-8')
print('Prepared both projects. Import each project in Aftertake Film assembly and export there.')
