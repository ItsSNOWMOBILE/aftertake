"""Sharpen the film: upscale its sub-1080p plates x2 through a running studio's Upscale studio.

Run from the repository root after build/prepare.py, with the studio running and,
to render on Comfy Cloud, Upscale switched to Comfy Cloud in Render setup:

    python examples/then-comes-the-aftertake/build/sharpen.py

It finds every video plate the scene projects use below 1920 pixels wide (and
within the Upscale studio's 1280-pixel limit), uploads each one, waits for its
upscale and downloads it to work/upscaled/. work/plates.json maps each
project asset's SHA-256 to its file and work/replace.json maps upscaled plates
to their new files; build/rerender.mjs uses both. Re-running skips finished
plates, and adopts a plate's existing job after a restart instead of
submitting it again.
"""
import hashlib, importlib.util, json, os, subprocess, time, urllib.error, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
FILM = Path(__file__).resolve().parents[1]
WORK = Path(os.environ.get('AFTERTAKE_FILM_WORK', FILM / 'work'))
BASE = os.environ.get('AFTERTAKE_URL', 'http://127.0.0.1:4312')
sha = lambda path: hashlib.sha256(Path(path).read_bytes()).hexdigest()
spec = importlib.util.spec_from_file_location('film_prepare', Path(__file__).with_name('prepare.py'))
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)
prepare.WORK = WORK


def call(route, body=None, raw=None):
    data = raw if raw is not None else (None if body is None else json.dumps(body).encode())
    request = urllib.request.Request(BASE + route, data=data, method='GET' if data is None else 'POST', headers={
        'Origin': BASE, 'Content-Type': 'application/octet-stream' if raw is not None else 'application/json'})
    try:
        with urllib.request.urlopen(request, timeout=600) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        return error.code, json.load(error)


def size(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height',
                          '-of', 'csv=p=0', str(path)], capture_output=True, text=True, check=True).stdout
    return tuple(map(int, out.strip().split(',')))


def plates():
    """Each project asset's file, found by content hash among the examples and the work folder."""
    candidates = [*ROOT.glob('examples/**/*.mp4'), *ROOT.glob('examples/**/*.png'), *WORK.glob('*.mp4'), *WORK.glob('*.png')]
    by_hash = {}
    for path in candidates:
        if 'upscaled' not in path.parts:
            by_hash.setdefault(sha(path), str(path))
    needed = {}
    for scene in sorted((FILM / 'project').glob('scene-*.json')):
        project = json.loads(scene.read_text())
        for item in [*project['shots'], *[g for g in project.get('graphics', []) if g.get('assetId')]]:
            needed[item.get('sha256') or item['asset']['sha256']] = None
    missing = [digest for digest in needed if digest not in by_hash]
    if missing:
        raise SystemExit(f'{len(missing)} project assets were not found; run build/prepare.py first.')
    return {digest: by_hash[digest] for digest in needed}


def upscale(path, folder):
    name = f'{Path(path).stem} · upscaled ×2'
    existing = [job for job in call('/api/enhancements')[1]
                if job['request'].get('name') == name and job['request'].get('clip', {}).get('sha256') == sha(path)
                and job['state'] not in ('failed', 'canceled', 'expired')]
    if existing:
        job = existing[0]
        if job['state'] in ('submission_unknown', 'connection_lost', 'output_error'):
            call(f"/api/enhancements/{job['id']}/reconcile", {})
    else:
        status, clip = call(f'/api/clips?name={Path(path).name}', raw=Path(path).read_bytes())
        if status != 201:
            raise SystemExit(f'{path}: {clip}')
        fields = ('id', 'name', 'sha256', 'width', 'height', 'duration', 'hasAudio', 'url')
        status, result = call('/api/enhancements', {'format': 'aftertake-enhance/1', 'operation': 'upscale', 'name': name,
                              'clip': {**{key: clip[key] for key in fields}, 'kind': 'video'}, 'seed': 42})
        if status not in (200, 201, 202):
            raise SystemExit(f'{path}: {result}')
        job = result.get('enhancement', result)
    started = time.time()
    while True:
        job = next(item for item in call('/api/enhancements')[1] if item['id'] == job['id'])
        if job['state'] in ('succeeded', 'failed', 'output_error', 'canceled', 'expired'):
            break
        # A restart briefly marks a running Cloud job lost; listing rejoins it.
        if job['state'] == 'connection_lost' and time.time() - started > 900:
            break
        time.sleep(4)
    if job['state'] != 'succeeded':
        raise SystemExit(f"{path}: {job['state']} {job.get('error', '')}")
    target = folder / f"{Path(path).parent.name}-{Path(path).stem}.mp4"
    urllib.request.urlretrieve(BASE + job['clip']['url'], target)
    return str(target)


def main():
    mapping = plates()
    (WORK / 'plates.json').write_text(json.dumps(mapping, indent=1))
    folder = WORK / 'upscaled'
    folder.mkdir(exist_ok=True)
    replace_file = WORK / 'replace.json'
    replace = json.loads(replace_file.read_text()) if replace_file.exists() else {}
    looks = {sha(WORK / f'{name}.mp4'): name for name in prepare.LOOKS}
    for digest, path in mapping.items():
        # The castle looks are rebuilt from the upscaled castle below, not upscaled.
        if not path.endswith('.mp4') or digest in replace or digest in looks:
            continue
        width, height = size(path)
        if width >= 1920 or max(width, height) > 1280:
            continue
        print(f'Upscaling {Path(path).relative_to(ROOT) if Path(path).is_relative_to(ROOT) else path} ({width}x{height})')
        replace[digest] = upscale(path, folder)
        replace_file.write_text(json.dumps(replace, indent=1))
    castle = sha(ROOT / 'examples/castle-pullback-v2/result.mp4')
    if castle in replace and not all(digest in replace for digest in looks):
        print('Rebuilding the castle looks from the upscaled castle with Color & finish')
        rebuilt = prepare.castle_looks(Path(replace[castle]), '-sharp')
        for digest, name in looks.items():
            replace[digest] = str(rebuilt[name])
        replace_file.write_text(json.dumps(replace, indent=1))
    print(f'{len(replace)} plates replaced; now run build/rerender.mjs')


if __name__ == '__main__':
    main()
