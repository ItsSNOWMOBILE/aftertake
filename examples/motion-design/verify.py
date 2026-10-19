"""Verify this extracted bundle; no network, import, inference or render."""
from hashlib import sha256
import json
from pathlib import Path, PurePosixPath

folder = Path(__file__).resolve().parent
root = folder.parents[1]
checksums = folder / 'SHA256SUMS'
checked = 0
for line in checksums.read_text(encoding='utf-8').splitlines():
    expected, name = line.split('  ', 1)
    relative = PurePosixPath(name)
    if relative.is_absolute() or '..' in relative.parts or not name.startswith('examples/motion-design/'):
        raise ValueError('Unsafe checksum path')
    path = root.joinpath(*relative.parts).resolve()
    if not path.is_relative_to(folder) or not path.is_file():
        raise ValueError('Missing or out-of-bundle file: ' + name)
    if sha256(path.read_bytes()).hexdigest() != expected:
        raise ValueError('Hash mismatch: ' + name)
    checked += 1
project = json.loads((folder / 'project.json').read_text(encoding='utf-8'))
manifest = json.loads((folder / 'media-manifest.json').read_text(encoding='utf-8'))
assert project['format'] == 'aftertake-film/3'
assert len(project['sourceFiles']) == manifest['sourceCount'] == 27
assert sha256((folder / 'project.json').read_bytes()).hexdigest() == manifest['projectSha256']
expected_media = {row['path']: row for row in manifest['files']}
for asset_id, source in project['sourceFiles'].items():
    name = source['path']
    assert name in expected_media and expected_media[name]['assetId'] == asset_id
    path = root.joinpath(*PurePosixPath(name).parts).resolve()
    assert path.is_relative_to(folder / 'media') and path.is_file()
    data = path.read_bytes()
    assert sha256(data).hexdigest() == source['sha256'] == expected_media[name]['sha256']
    assert len(data) == expected_media[name]['bytes']
bindings = [*project['shots'], *project.get('audio', []),
            *(row for row in project.get('graphics', []) if row['kind'] == 'image')]
for binding in bindings:
    source = project['sourceFiles'][binding['assetId']]
    assert source['sha256'] == binding['sha256']
print(f'Verified {checked} bundled files and all 27 source bindings. No import or render started.')
