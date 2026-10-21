"""Prepare the film's work folder: beats, plates and the new CPU effect renders.

Run from the repository root with the Film media runtime:
    python examples/then-comes-the-aftertake/build/prepare.py path/to/aftertake-song.mp3

The soundtrack is described by music.json (file name, checksum, drop and end-card
beats); render it from aftertake-song-ace-step.json first.
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


def run(*args):
    return subprocess.run([sys.executable, *map(str, args)], check=True, capture_output=True, text=True).stdout


def main(music):
    WORK.mkdir(exist_ok=True)
    track = json.loads((HERE / 'music.json').read_text(encoding='utf-8'))
    if hashlib.sha256(Path(music).read_bytes()).hexdigest() != track['sha256']:
        raise SystemExit('This audio differs from the soundtrack described in music.json.')
    shutil.copyfile(music, WORK / track['file'])
    (WORK / track['beats']).write_text(run(ROOT / 'scripts/detect-beats.py', WORK / track['file']))
    shutil.copyfile(HERE / 'music.json', WORK / 'music.json')
    for name, colour in [('plate-black', (8, 10, 9)), ('plate-dark', (18, 23, 19))]:
        Image.new('RGB', (1920, 1080), colour).save(WORK / f'{name}.png')
    shutil.copyfile(HERE.parent / 'assets/logo-dark.png', WORK / 'logo-dark.png')
    # The HD window repaint's executed ComfyUI graph, drawn for the How it's built scene.
    run(HERE / 'workflow-graph.py', ROOT / 'examples/portal-v2/executed-workflow.json', WORK / 'graph-portal.png')

    # Subject copies and colour echoes from the example's saved SAM 3 tracking.
    example = ROOT / 'examples/subject-duplicates-v2'
    inspect = lambda path, role: json.loads(run(ROOT / 'scripts/subject-effects.py', '--inspect', path, '--role', role))
    source, prepared, mask = (inspect(example / name, role) for name, role in
        [('source.mp4', 'source'), ('prepared-source.mp4', 'prepared'), ('person-mask.mkv', 'mask')])
    base = {'y': 0, 'scale': 1, 'opacity': 1, 'flipX': False, 'rotation': 0}
    copies = {
        'echoes': [{**base, 'x': x, 'color': colour, 'behindSubject': True}
                   for x, colour in [(.12, '#ff783e'), (.08, '#ff9189'), (.04, '#ff2a96')]],
        'ensemble': [{**base, 'x': -.3}, {**base, 'x': -.15}, {**base, 'x': .15, 'flipX': True}, {**base, 'x': .3, 'flipX': True}],
    }
    for name, effect in copies.items():
        settings = {'request': {'copies': effect, 'feather': 1, 'grow': 0, 'backgroundBlur': 0, 'backgroundExposureEV': 0},
            'source': str(example / 'source.mp4'), 'prepared': str(example / 'prepared-source.mp4'),
            'mask': str(example / 'person-mask.mkv'), 'selection': mask, 'trimStart': 0, 'recipe': {'preset': name},
            'hashes': {'source': source['sha256'], 'prepared': prepared['sha256'], 'mask': mask['sha256']},
            'output': str(WORK / f'{name}.mp4')}
        (WORK / f'{name}.json').write_text(json.dumps(settings))
        run(ROOT / 'scripts/subject-effects.py', WORK / f'{name}.json')

    # Four looks from Color & finish on the HD lighthouse pull-back take.
    castle = ROOT / 'examples/castle-pullback-v2/result.mp4'
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
    # Time-lapses of the real proof recordings (../proof). Each keeps its ending
    # in real time; the film labels the speed. The render recording loses the
    # browser chrome above the app and is letterboxed, so nothing is enlarged.
    proof = HERE.parent / 'proof'
    timelapses = {
        'proof-run.mp4': (proof / 'proof-render.mp4', 32, 120, 32, 1.6, 'crop=1920:900:0:180,pad=1920:1080:0:90:color=0x121713'),
        'proof-mcp-run.mp4': (proof / 'proof-mcp.mp4', 15, 51, 16, 2, 'null'),
    }
    for name, (source, start, end, speed, hold, frame) in timelapses.items():
        graph = (f'[0:v]trim={start}:{end},setpts=(PTS-STARTPTS)/{speed},fps=30[fast];'
                 f'[0:v]trim={end}:{end + hold},setpts=PTS-STARTPTS[real];'
                 f'[fast][real]concat=n=2:v=1:a=0,{frame}[out]')
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(source), '-filter_complex', graph, '-map', '[out]',
            '-c:v', 'libx264', '-crf', '16', '-pix_fmt', 'yuv420p', str(WORK / f'raw-{name}')], check=True)
    shutil.move(WORK / 'raw-proof-mcp-run.mp4', WORK / 'proof-mcp-run.mp4')

    # The engine console prints model paths under the capture machine's user
    # folder. Color & finish hides that username wherever it scrolls: the box is
    # the word as it appears 0.2 s into the time-lapse, matched on every frame.
    raw = WORK / 'raw-proof-run.mp4'
    probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries',
        'stream=width,height:format=duration', '-of', 'json', str(raw)]))
    width, height = probe['streams'][0]['width'], probe['streams'][0]['height']
    clip = {'id': '7d2b6c55-4f0e-4d8a-9a51-6d3f0c1b2e40', 'name': 'proof-run', 'kind': 'video', 'url': '/media/proof-run.mp4',
        'width': width, 'height': height, 'duration': float(probe['format']['duration']), 'hasAudio': False,
        'sha256': hashlib.sha256(raw.read_bytes()).hexdigest()}
    username = {'x': 1447 / width, 'y': 92 / height, 'width': 28 / width, 'height': 18 / height,
        'style': 'blur', 'match': {'at': 0.2, 'threshold': 0.9}}
    work = {'source': str(raw), 'output': str(WORK / 'proof-run.mp4'), 'receipt': str(WORK / 'proof-run.receipt.json'),
        'mode': 'finish', 'request': {'format': 'aftertake-finishing/1', 'name': 'Proof run, username hidden',
            'clip': clip, 'settings': neutral, 'redactions': [username]}}
    (WORK / 'proof-run.work.json').write_text(json.dumps(work))
    run(ROOT / 'scripts/finish-media.py', WORK / 'proof-run.work.json')
    hidden = json.loads((WORK / 'proof-run.receipt.json').read_text())['redactions'][0]
    print(f"Hid the username {hidden['boxes']} times in {hidden['frames']} frames of the run time-lapse.")
    print(f'Prepared {WORK}')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(sys.argv[1])
