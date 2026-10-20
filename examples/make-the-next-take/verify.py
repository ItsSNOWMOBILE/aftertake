"""Verify the complete source bundle and all four Film source bindings."""
import hashlib
import json
from pathlib import Path, PurePosixPath

folder = Path(__file__).resolve().parent
checkout = folder.parents[1]
listed = {}
for line in (folder / 'SHA256SUMS').read_text(encoding='utf-8').splitlines():
    digest, name = line.split('  ', 1)
    relative = PurePosixPath(name)
    if relative.is_absolute() or '..' in relative.parts or '\\' in name:
        raise ValueError('Unsafe checksum path')
    target = (folder / name).resolve()
    if not target.is_relative_to(folder) or not target.is_file():
        raise ValueError('Missing checksum file: ' + name)
    actual = hashlib.sha256(target.read_bytes()).hexdigest()
    if actual != digest:
        raise ValueError('Checksum mismatch: ' + name)
    if name in listed:
        raise ValueError('Duplicate checksum entry')
    listed[name] = digest
actual_files = {p.relative_to(folder).as_posix() for p in folder.rglob('*') if p.is_file() and p.name != 'SHA256SUMS'}
if not set(listed) <= actual_files:
    raise ValueError('Checksummed files are missing')
bindings = 0
for name in ['project.json', 'campaign-landscape.json', 'campaign-portrait.json', 'campaign-square.json']:
    project = json.loads((folder / name).read_text(encoding='utf-8'))
    if project['format'] != 'aftertake-film/3':
        raise ValueError('Expected native Film format3')
    required = {s['assetId'] for s in project['shots']}
    required.update(a['assetId'] for a in project.get('audio', []))
    required.update(g['assetId'] for g in project.get('graphics', []) if g['kind'] == 'image')
    if required != set(project['sourceFiles']):
        raise ValueError('Project source map does not exactly cover its bindings')
    for source in project['sourceFiles'].values():
        relative = PurePosixPath(source['path'])
        if relative.is_absolute() or '..' in relative.parts or '\\' in source['path']:
            raise ValueError('Unsafe source path')
        target = (checkout / source['path']).resolve()
        if not target.is_relative_to(folder) or not target.is_file():
            raise ValueError('Missing bound source')
        if hashlib.sha256(target.read_bytes()).hexdigest() != source['sha256']:
            raise ValueError('Bound source hash mismatch')
        bindings += 1
print(json.dumps({'verifiedFiles': len(listed), 'verifiedProjects': 4, 'verifiedSourceBindings': bindings, 'otherExistingFilesIgnored': len(actual_files - set(listed))}))
