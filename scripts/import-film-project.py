"""Import an Aftertake film's hash-verified source assets into a local studio.

Run pnpm demo first for the bundled finished takes. Then import project.json
using the editor's Import film project button. No rendering starts here.
"""
import argparse
import hashlib
import json
from pathlib import Path
import urllib.parse
import urllib.request

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('project', type=Path)
parser.add_argument('--url', default='http://127.0.0.1:4312')
args = parser.parse_args()
base = urllib.parse.urlsplit(args.url)
if base.scheme != 'http' or base.hostname not in ['localhost', '127.0.0.1'] or base.username or base.password or base.path not in ['', '/'] or base.query or base.fragment:
    parser.error('Choose a local Aftertake studio URL, such as http://127.0.0.1:4312.')
root = Path(__file__).resolve().parents[1]
project = json.loads(args.project.read_text(encoding='utf-8'))


def request(path, payload=None, media=False):
    body = payload if media else json.dumps(payload).encode() if payload is not None else None
    headers = {'Content-Type': 'application/octet-stream' if media else 'application/json'}
    with urllib.request.urlopen(urllib.request.Request(args.url.rstrip('/') + path, data=body, headers=headers), timeout=60) as response:
        return json.load(response)


assets = request('/api/films/assets')
for item in project.get('sourceFiles', {}).values():
    path = (root / item['path']).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        raise ValueError('Project sources must be files inside this checkout.')
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != item['sha256']:
        raise ValueError(f'Source hash does not match: {item["path"]}')
    if not any(asset['sha256'] == item['sha256'] for asset in assets):
        assets.append(request('/api/films/assets?name=' + urllib.parse.quote(path.name), data, media=True))
request('/api/films/resolve', project)
print('Verified source assets imported. Open Film assembly and choose Import film project, then select ' + str(args.project.resolve()))
