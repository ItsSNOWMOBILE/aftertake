"""Verify and unpack the optional review-film ZIP into this repository."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import uuid
import zipfile


def filesystem_path(value):
    """Keep deep Windows checkouts usable without changing global OS settings."""
    value = value.resolve()
    text = str(value)
    if os.name == 'nt' and not text.startswith('\\\\?\\'):
        return Path('\\\\?\\UNC\\' + text[2:] if text.startswith('\\\\') else '\\\\?\\' + text)
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path)
    args = parser.parse_args()
    args.archive = filesystem_path(args.archive)
    folder = filesystem_path(Path(__file__).parent)
    root = folder.parents[1]
    manifest = json.loads((folder / 'media-bundle.json').read_text(encoding='utf-8'))
    if args.archive.stat().st_size != manifest['bytes']:
        raise ValueError('The archive size does not match media-bundle.json.')
    data = args.archive.read_bytes()
    if hashlib.sha256(data).hexdigest() != manifest['sha256']:
        raise ValueError('The archive checksum does not match media-bundle.json.')
    expected = {item['path']: item for item in manifest['files']}
    prepared = []
    with zipfile.ZipFile(args.archive) as archive:
        if len(archive.infolist()) != len(expected) or set(archive.namelist()) != set(expected):
            raise ValueError('The archive must contain exactly the declared media files.')
        for item in archive.infolist():
            declared = expected[item.filename]
            if item.file_size != declared['bytes'] or item.is_dir():
                raise ValueError('An archive entry differs from its declared file.')
            target = (root / item.filename).resolve()
            if not target.is_relative_to(folder) or not item.filename.startswith('examples/product-film/'):
                raise ValueError('An archive path escaped the film example.')
            payload = archive.read(item)
            if hashlib.sha256(payload).hexdigest() != declared['sha256']:
                raise ValueError('An input checksum does not match the manifest.')
            if target.exists() and target.read_bytes() != payload:
                raise ValueError('A changed local input already exists; keep your edit before importing.')
            prepared.append((target, payload))
    for target, payload in prepared:
        if target.exists():
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_name(target.name + '.' + uuid.uuid4().hex + '.tmp')
        try:
            temporary.write_bytes(payload)
            temporary.replace(target)
        finally:
            temporary.unlink(missing_ok=True)
    print(f'Verified {len(prepared)} review-film inputs. Import project.json using scripts/import-film-project.py.')


if __name__ == '__main__':
    main()
