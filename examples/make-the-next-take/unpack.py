"""Safely install the exact preview companions without clobbering existing files."""
import argparse
import hashlib
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import tempfile
import os
import zipfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('archive', type=Path)
parser.add_argument('--root', type=Path, default=Path.cwd())
args = parser.parse_args()
root = args.root.resolve()
prefix = 'examples/make-the-next-take/'

def digest(stream):
    h = hashlib.sha256()
    while block := stream.read(1024 * 1024): h.update(block)
    return h.hexdigest()

with zipfile.ZipFile(args.archive) as archive:
    infos = archive.infolist()
    if len(infos) > 512 or sum(i.file_size for i in infos) > 1024 ** 3:
        raise ValueError('Archive exceeds preview bundle bounds')
    entries = {}
    destinations = set()
    for item in infos:
        name = item.filename
        path = PurePosixPath(name)
        if (not name.startswith(prefix) or path.as_posix() != name or path.is_absolute() or '..' in path.parts
                or '\\' in name or ':' in name or item.is_dir()
                or stat.S_ISLNK(item.external_attr >> 16) or name in entries):
            raise ValueError('Unsafe or duplicate archive entry')
        target = (root / name).resolve()
        if not target.is_relative_to(root): raise ValueError('Archive target escapes checkout')
        destination = str(target).casefold() if os.name == 'nt' else str(target)
        if destination in destinations: raise ValueError('Duplicate resolved archive destination')
        destinations.add(destination)
        entries[name] = (item, target)
    checksum_name = prefix + 'SHA256SUMS'
    sums = {}
    for line in archive.read(checksum_name).decode('utf-8').splitlines():
        if not re.fullmatch(r'[0-9a-f]{64}  .+', line): raise ValueError('Invalid checksum line')
        expected, name = line.split('  ', 1)
        full_name = prefix + name
        if full_name in sums: raise ValueError('Duplicate checksum entry')
        sums[full_name] = expected
    if set(entries) != set(sums) | {checksum_name}: raise ValueError('Incomplete checksum coverage')
    # Complete preflight comes before the first filesystem mutation.
    actuals = {}
    for name, (item, target) in entries.items():
        with archive.open(item) as stream: actual = digest(stream)
        actuals[name] = actual
        if name in sums and actual != sums[name]: raise ValueError('Corrupt archive file: ' + name)
        if target.exists():
            if not target.is_file(): raise ValueError('Existing target is not a file: ' + name)
            with target.open('rb') as stream: current = digest(stream)
            if current != actual: raise ValueError('Refusing to overwrite different existing file: ' + name)
    created = reused = 0
    for name, (item, target) in entries.items():
        if target.exists():
            with target.open('rb') as stream: current = digest(stream)
            if current != actuals[name]: raise ValueError('Refusing changed destination after preflight: ' + name)
            reused += 1
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=target.parent, delete=False) as stream:
            temporary = Path(stream.name)
            with archive.open(item) as source: shutil.copyfileobj(source, stream, 1024 * 1024)
        try:
            # A same-directory hard link creates the destination exclusively on
            # Windows and POSIX. Unlike rename, it never replaces an existing file.
            os.link(temporary, target)
            created += 1
        finally:
            temporary.unlink()
print(f'Installed {created} exact files; reused {reused} identical files. Nothing was overwritten.')
