"""Export an offline deployment inventory, not a Comfy Build/deployment specification."""
from __future__ import annotations

import argparse
import ast
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
SHA256 = re.compile(r'^[0-9a-f]{64}$')
REVISION = re.compile(r'^[0-9a-f]{40}$')
PACKAGE = 'custom_nodes/aftertake'
REQUIRED_SOURCES = (
    'scripts/setup.py', 'scripts/download-models.py', 'scripts/engine.py', 'scripts/hardware-check.py',
    'scripts/character-workflow.py', 'server/character-profile.ts',
    'docs/models-character-swap.json', 'requirements-runtime.txt',
    *(f'{PACKAGE}/{name}' for name in (
        '__init__.py', 'character_nodes.py', 'media_utils.py', 'memory_compat.py',
        'hardware.py', 'vram.py', 'requirements.txt',
    )),
)


class InventoryError(ValueError):
    pass


def relative(value):
    if not isinstance(value, str) or not value or '\\' in value or ':' in value:
        raise InventoryError('Inventory paths must be portable relative paths.')
    result = PurePosixPath(value)
    if result.is_absolute() or any(part in ('', '.', '..') for part in value.split('/')):
        raise InventoryError('Inventory paths must not escape their package root.')
    return result


def inside(root, name):
    target = root.joinpath(*relative(name).parts)
    if not target.resolve().is_relative_to(root.resolve()):
        raise InventoryError(f'Source path escapes its package root: {name}')
    return target


def source_file(root, name):
    target = inside(root, name)
    if not target.is_file():
        return {'path': name, 'state': 'missing', 'sha256': None, 'size': None}
    data = target.read_bytes()
    return {'path': name, 'state': 'present', 'sha256': hashlib.sha256(data).hexdigest(), 'size': len(data)}


def required_text(root, name):
    target = inside(root, name)
    if not target.is_file():
        raise InventoryError(f'Missing inventory source: {name}')
    return target.read_text(encoding='utf-8-sig')


def setup_pins(text):
    """Read the setup recipe as data; never import/run installation code."""
    try:
        tree = ast.parse(text)
    except SyntaxError:
        raise InventoryError('Invalid setup source: scripts/setup.py') from None

    def target_path(node):
        if isinstance(node, ast.Name) and node.id == 'RUNTIME':
            return '.runtime'
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            return node.value
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Div):
            return target_path(node.left) + '/' + target_path(node.right)
        raise InventoryError('Unsupported repository path in scripts/setup.py')

    tuples = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and any(isinstance(item, ast.Name) and item.id == 'REPOS' for item in node.targets):
            if not isinstance(node.value, ast.List):
                raise InventoryError('Setup REPOS must be a static list.')
            tuples.extend(node.value.elts)
        if isinstance(node, ast.If) and ast.dump(node.test) == ast.dump(ast.parse('args.character_swap', mode='eval').body):
            for call in ast.walk(node):
                if isinstance(call, ast.Call) and isinstance(call.func, ast.Attribute) and call.func.attr == 'append' and isinstance(call.func.value, ast.Name) and call.func.value.id == 'repos':
                    tuples.extend(call.args)
    repos = []
    for item in tuples:
        try:
            url, revision = ast.literal_eval(item.elts[0]), ast.literal_eval(item.elts[2])
            target = target_path(item.elts[1])
        except (AttributeError, IndexError, TypeError, ValueError):
            raise InventoryError('Invalid pinned repository in scripts/setup.py') from None
        if not isinstance(url, str) or not isinstance(revision, str) or not re.fullmatch(r'https://github\.com/[\w.-]+/[\w.-]+\.git', url) or not REVISION.fullmatch(revision):
            raise InventoryError('Setup repositories require public GitHub URLs and full commit pins.')
        relative(target)
        if target != '.runtime/ComfyUI' and not target.startswith('.runtime/ComfyUI/'):
            raise InventoryError('Repository target must be inside the ComfyUI runtime.')
        repos.append({'url': url, 'revision': revision, 'installPath': target.removeprefix('.runtime/')})
    paths = [item['installPath'] for item in repos]
    if len(set(paths)) != len(paths) or 'ComfyUI' not in paths or 'ComfyUI/custom_nodes/h3-relay' not in paths:
        raise InventoryError('Setup must pin ComfyUI and the H3 Relay character profile without duplicate targets.')

    python = None
    installs = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Compare) and isinstance(node.left, ast.Subscript) and ast.unparse(node.left) == 'sys.version_info[:2]':
            try:
                version = ast.literal_eval(node.comparators[0])
                python = '.'.join(str(part) for part in version)
            except (ValueError, TypeError):
                raise InventoryError('Unsupported Python version pin in scripts/setup.py') from None
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == 'run':
            values = [item.value if isinstance(item, ast.Constant) else None for item in node.args[1:]]
            if values[:3] == ['-m', 'pip', 'install'] and any(isinstance(value, str) and value.startswith('torch==') for value in values):
                installs = values[3:]
    if python is None or not installs or any(not isinstance(item, str) for item in installs):
        raise InventoryError('Missing static Python/PyTorch setup pins.')
    for value in installs:
        if not (re.fullmatch(r'[\w.-]+==[\w.+-]+', value) or value == '--index-url' or re.fullmatch(r'https://download\.pytorch\.org/whl/[\w.-]+', value)):
            raise InventoryError('Unsupported PyTorch installation argument; review it before exporting.')
    return repos, python, installs


def profile_contract(text):
    models_match = re.search(r'export const characterModels\s*=\s*\{(.*?)\};', text, re.S)
    node_list = re.search(r'const nodes\s*=\s*\[(.*?)\];', text, re.S)
    extra_nodes = re.search(r'nodes\.push\((.*?)\);', text, re.S)
    if not all((models_match, node_list, extra_nodes)):
        raise InventoryError('Unsupported character profile contract; update the inventory parser.')
    models = dict(re.findall(r"(\w+)\s*:\s*'([^']+)'", models_match.group(1)))
    nodes = []
    for group in (node_list.group(1), extra_nodes.group(1)):
        values = re.findall(r"'([^']+)'", group)
        if re.sub(r"'[^']+'|[\s,]", '', group):
            raise InventoryError('Required nodes must be static character profile strings.')
        nodes.extend(values)
    menus = []
    for node, input_name, model in re.findall(r"\['([^']+)',\s*'([^']+)',\s*characterModels\.(\w+)\]", text):
        if model not in models:
            raise InventoryError('Character model menu references an unknown model.')
        menus.append({'node': node, 'input': input_name, 'filename': models[model]})
    if not models or not menus or len(nodes) != len(set(nodes)):
        raise InventoryError('Character node and model contracts must be complete and unique.')
    return models, nodes, menus


def model_inventory(entries, models_dir):
    if not isinstance(entries, list) or not entries:
        raise InventoryError('Character model manifest must be a nonempty list.')
    result = []
    targets = set()
    for entry in entries:
        if not isinstance(entry, dict):
            raise InventoryError('Invalid character model manifest entry.')
        repository, revision = entry.get('repository'), entry.get('revision')
        digest, size, category = entry.get('sha256'), entry.get('size'), entry.get('category')
        if not isinstance(repository, str) or not re.fullmatch(r'[\w.-]+/[\w.-]+', repository):
            raise InventoryError('Model source must name a public repository.')
        if not isinstance(revision, str) or not REVISION.fullmatch(revision) or not isinstance(digest, str) or not SHA256.fullmatch(digest):
            raise InventoryError('Model entries require full revision and SHA-256 pins.')
        if type(size) is not int or size <= 0 or not isinstance(category, str) or not re.fullmatch(r'[a-z_]+', category):
            raise InventoryError('Model entries require a positive size and portable category.')
        remote = relative(entry.get('path'))
        target = f'{category}/{remote.name}'
        if target in targets:
            raise InventoryError(f'Duplicate model destination: models/{target}')
        targets.add(target)
        observed = {'state': 'not-checked', 'size': None, 'sha256': None}
        if models_dir is not None:
            local = inside(models_dir, target)
            if local.is_file():
                actual_size = local.stat().st_size
                observed = {'state': 'present-unhashed' if actual_size == size else 'size-mismatch', 'size': actual_size, 'sha256': None}
            else:
                observed['state'] = 'missing'
        result.append({
            'repository': repository, 'revision': revision, 'sourcePath': str(remote),
            'installPath': f'models/{target}', 'expectedSize': size, 'expectedSha256': digest,
            'verification': 'pinned-manifest-only; model contents not read', 'local': observed,
        })
    return result


def prepare_inventory(root=ROOT, models_dir=None):
    root = Path(root).resolve()
    repos, python, torch_install = setup_pins(required_text(root, 'scripts/setup.py'))
    try:
        model_manifest = json.loads(required_text(root, 'docs/models-character-swap.json'))
    except json.JSONDecodeError:
        raise InventoryError('Invalid JSON in docs/models-character-swap.json') from None
    models = model_inventory(model_manifest, Path(models_dir).resolve() if models_dir is not None else None)
    model_names, nodes, menus = profile_contract(required_text(root, 'server/character-profile.ts'))
    filenames = {PurePosixPath(item['installPath']).name for item in models}
    if set(model_names.values()) != filenames or {item['filename'] for item in menus} != filenames:
        raise InventoryError('Character profile model menus and the download manifest disagree.')
    if 'models-character-swap.json' not in required_text(root, 'scripts/download-models.py'):
        raise InventoryError('Download script does not reference the character model manifest.')

    names = set(REQUIRED_SOURCES)
    package = inside(root, PACKAGE)
    if package.is_dir():
        for item in package.rglob('*.py'):
            if '__pycache__' not in item.parts:
                names.add(item.relative_to(root).as_posix())
    files = [source_file(root, name) for name in sorted(names)]
    missing = [item['path'] for item in files if item['state'] == 'missing']
    requirements = []
    for name in ('requirements-runtime.txt', f'{PACKAGE}/requirements.txt'):
        item = next(item for item in files if item['path'] == name)
        entries = [line.strip() for line in inside(root, name).read_text(encoding='utf-8-sig').splitlines() if line.strip() and not line.lstrip().startswith('#')] if item['state'] == 'present' else []
        if any(not re.fullmatch(r'[\w.-]+(?:\[[\w,.-]+\])?==[\w.+-]+', entry) for entry in entries):
            raise InventoryError(f'Dependency inventory requires public exact package pins: {name}')
        requirements.append({
            'path': name, 'sha256': item['sha256'], 'state': item['state'],
            'entries': entries,
        })
    relay = source_file(root, '.runtime/ComfyUI/custom_nodes/h3-relay/h3_relay/workflows.py')
    relay['path'] = 'ComfyUI/custom_nodes/h3-relay/h3_relay/workflows.py'
    return {
        'format': 'aftertake-cloud-profile-inventory/1', 'profile': 'character-swap',
        'purpose': 'Offline inputs for future provider build validation; not a deployment specification.',
        'deployment': {'ready': False, 'linuxValidated': False, 'providerSchema': None, 'actionsPerformed': []},
        'runtime': {
            'python': python, 'torchInstallArguments': torch_install,
            'systemTools': ['ffmpeg', 'ffprobe'], 'systemToolsRequirement': 'Both tools must be available on the worker PATH; codec and Linux GPU support need validation.',
            'gpu': 'CUDA runtime and capacity must be validated on the target worker; no portable hardware certification is implied.',
        },
        'repositories': repos, 'requirements': requirements,
        'customNodeFiles': [item for item in files if item['path'].startswith(PACKAGE + '/')],
        'sourceFiles': files, 'models': models,
        'modelBytesExpected': sum(item['expectedSize'] for item in models),
        'workflowContract': {
            'source': 'server/character-profile.ts', 'requiredNodes': nodes, 'modelMenus': menus,
            'applicationBuilder': 'scripts/character-workflow.py',
            'relayRecipe': relay,
            'relayRequirement': 'The application builder imports this recipe from the pinned Relay checkout; source hashes alone do not certify its worker installation.',
        },
        'validation': {
            'sourceFilesComplete': not missing, 'missingSourceFiles': missing,
            'modelMenuCoverage': True, 'modelContentHashesVerified': False,
            'modelPresenceChecked': models_dir is not None,
            'pending': ['Linux dependency resolution and GPU/codec smoke test', 'Exact node/model capability and output-contract verification', 'Provider build schema translation', 'Account, billing ownership and isolated job routing verification'],
        },
        'privacy': 'Contains code/dependency/model metadata only. No credentials, account documents, host paths, photos, media, projects or job records are included.',
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--profile', choices=['character-swap'], required=True)
    parser.add_argument('--output', type=Path, required=True, help='Inventory JSON destination; no archive or deployment is created')
    parser.add_argument('--models-dir', type=Path, help='Optionally inspect model presence and sizes without reading model contents; the host path is not recorded')
    args = parser.parse_args()
    try:
        inventory = prepare_inventory(models_dir=args.models_dir)
        output = args.output.resolve()
        if output.is_relative_to((ROOT / 'custom_nodes').resolve()) or output in {inside(ROOT, name).resolve() for name in REQUIRED_SOURCES}:
            raise InventoryError('Choose an inventory destination outside profile source files.')
        if args.models_dir is not None and output.is_relative_to(args.models_dir.resolve()):
            raise InventoryError('Choose an inventory destination outside model storage.')
        if output.exists():
            try:
                previous = json.loads(output.read_text(encoding='utf-8-sig'))
            except (json.JSONDecodeError, UnicodeError):
                previous = None
            if not isinstance(previous, dict) or previous.get('format') != 'aftertake-cloud-profile-inventory/1':
                raise InventoryError('Choose an unused output file or an existing profile inventory.')
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(inventory, indent=2, ensure_ascii=True) + '\n', encoding='utf-8')
    except (InventoryError, OSError) as error:
        # OSError paths can expose machine-specific directories; keep those generic.
        parser.exit(2, f'Inventory failed: {error if isinstance(error, InventoryError) else "could not read inputs or write output"}\n')
    print(f'Prepared offline character-swap inventory: {len(inventory["repositories"])} pinned repositories, {len(inventory["models"])} models. Deployment remains unverified.')


if __name__ == '__main__':
    main()
