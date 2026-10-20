"""Prepare the film's work folder: beats, plates and the new CPU effect renders.

Run from the repository root with the Film media runtime:
    python examples/then-comes-the-aftertake/build/prepare.py path/to/big-boi-pants.mp3
Nothing here runs a generation model; every input is an existing example output.
"""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys

from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
WORK = HERE.parent / 'work'
MUSIC_SHA256 = 'f8f00834dc7ac244595220f69f4c69d726dddea5b4c2719f25ca14b8553f7763'


def run(*args):
    return subprocess.run([sys.executable, *map(str, args)], check=True, capture_output=True, text=True).stdout


def main(music):
    WORK.mkdir(exist_ok=True)
    if hashlib.sha256(Path(music).read_bytes()).hexdigest() != MUSIC_SHA256:
        raise SystemExit('Use the original big-boi-pants.mp3 from silvermansound.com.')
    shutil.copyfile(music, WORK / 'big-boi-pants.mp3')
    (WORK / 'big-boi-pants.beats.json').write_text(run(ROOT / 'scripts/detect-beats.py', WORK / 'big-boi-pants.mp3'))
    for name, colour in [('plate-black', (8, 10, 9)), ('plate-dark', (18, 23, 19))]:
        Image.new('RGB', (1920, 1080), colour).save(WORK / f'{name}.png')
    shutil.copyfile(HERE.parent / 'assets/logo-dark.png', WORK / 'logo-dark.png')

    # Subject copies and colour echoes from the example's saved SAM 3 tracking.
    example = ROOT / 'examples/subject-duplicates'
    inspect = lambda path, role: json.loads(run(ROOT / 'scripts/subject-effects.py', '--inspect', path, '--role', role))
    source, prepared, mask = (inspect(example / name, role) for name, role in
        [('source-original.mp4', 'source'), ('prepared-source.mp4', 'prepared'), ('person-mask.mkv', 'mask')])
    base = {'y': 0, 'scale': 1, 'opacity': 1, 'flipX': False, 'rotation': 0}
    copies = {
        'echoes': [{**base, 'x': x, 'color': colour, 'behindSubject': True}
                   for x, colour in [(.12, '#ff783e'), (.08, '#ff9189'), (.04, '#ff2a96')]],
        'ensemble': [{**base, 'x': -.3}, {**base, 'x': -.15}, {**base, 'x': .15, 'flipX': True}, {**base, 'x': .3, 'flipX': True}],
    }
    for name, effect in copies.items():
        settings = {'request': {'copies': effect, 'feather': 1, 'grow': 0, 'backgroundBlur': 0, 'backgroundExposureEV': 0},
            'source': str(example / 'source-original.mp4'), 'prepared': str(example / 'prepared-source.mp4'),
            'mask': str(example / 'person-mask.mkv'), 'selection': mask, 'trimStart': 0, 'recipe': {'preset': name},
            'hashes': {'source': source['sha256'], 'prepared': prepared['sha256'], 'mask': mask['sha256']},
            'output': str(WORK / f'{name}.mp4')}
        (WORK / f'{name}.json').write_text(json.dumps(settings))
        run(ROOT / 'scripts/subject-effects.py', WORK / f'{name}.json')

    # Four looks from Color & finish on the castle pull-back take.
    castle = ROOT / 'examples/castle-pullback/result.mp4'
    probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries',
        'stream=width,height:format=duration', '-of', 'json', str(castle)]))
    clip = {'width': probe['streams'][0]['width'], 'height': probe['streams'][0]['height'],
        'duration': float(probe['format']['duration']), 'sha256': hashlib.sha256(castle.read_bytes()).hexdigest()}
    neutral = dict(exposureEV=0, contrast=0, saturation=0, temperature=0, tint=0, sharpen=0, vignette=0, grain=0,
        preset='clean', lookStrength=0, seed=42)
    looks = {
        'castle-warm': dict(preset='warm-film', lookStrength=1, halationStrength=.6, halationRadius=10, vignette=.35, contrast=.15),
        'castle-cool': dict(preset='cool-film', lookStrength=1, contrast=.2, vignette=.3, glowStrength=.25),
        'castle-noir': dict(preset='noir', lookStrength=1, contrast=.35, grain=.35, vignette=.45),
        'castle-vintage': dict(preset='vintage', lookStrength=1, grain=.4, chromaticStrength=.5, chromaticOffset=3, vignette=.4),
    }
    for name, look in looks.items():
        work = {'source': str(castle), 'output': str(WORK / f'{name}.mp4'), 'receipt': str(WORK / f'{name}.receipt.json'),
            'mode': 'finish', 'request': {'format': 'aftertake-finishing/1', 'clip': clip, 'settings': {**neutral, **look}}}
        (WORK / f'{name}.work.json').write_text(json.dumps(work))
        run(ROOT / 'scripts/finish-media.py', WORK / f'{name}.work.json')
    print(f'Prepared {WORK}')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(sys.argv[1])
