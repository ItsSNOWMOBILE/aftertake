"""Package a prebuilt static editor, reviewed media and complete source for hosting."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tarfile
import zipfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True)
    parser.add_argument('--source-ref', default='HEAD')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    output = Path(args.output).resolve()
    if root not in output.parents or output == root:
        raise ValueError('The showcase output must stay inside this checkout.')
    revision = subprocess.check_output(['git', 'rev-parse', '--verify', '--end-of-options', args.source_ref + '^{commit}'], cwd=root, text=True).strip()
    snapshot = json.loads((output / 'studio/snapshot.json').read_text(encoding='utf-8'))
    if snapshot['mediaRevision'] != revision or not all(url.startswith('../examples/') for url in snapshot['media'].values()):
        raise ValueError('Build the editor for this source revision with --media-base=../examples/ first.')
    raw = subprocess.check_output(['git', 'archive', '--format=tar', revision], cwd=root)
    with tarfile.open(fileobj=io.BytesIO(raw)) as archive:
        blobs = {item.name: archive.extractfile(item).read() for item in archive.getmembers() if item.isfile()}
    expected = {}
    for line in subprocess.check_output(['git', 'ls-tree', '-rz', revision], cwd=root).split(b'\0'):
        if line:
            metadata, name = line.split(b'\t', 1)
            _, kind, digest = metadata.split()
            if kind == b'blob':
                expected[name.decode()] = digest.decode()
    if set(blobs) != set(expected):
        raise ValueError('Source archive does not contain the exact tracked file set.')
    for name, data in blobs.items():
        digest = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
        if expected[name] != digest:
            raise ValueError('Source archive blob mismatch: ' + name)
    for font in snapshot.get('externalFonts',[]):
        data=blobs['docs/assets/'+font['name']]
        if hashlib.sha256(data).hexdigest()!=font['sha256']:raise ValueError('Shared browser font differs from the source snapshot.')
    manifest = json.loads(blobs['examples/manifest.json'])
    for item in manifest['files']:
        data = blobs['examples/' + item['source']]
        if len(data) != item['size'] or hashlib.sha256(data).hexdigest() != item['sha256']:
            raise ValueError('Example checksum mismatch: ' + item['source'])
    # These preparation assets are complete in the source ZIPs; the raw ad
    # sources are also in the dedicated ad pack. Public players use the final
    # exports, so another loose copy is unnecessary.
    archive_media_prefixes = ('examples/submission-film/media/', 'examples/judges-film/media/', 'examples/social-ad/media/', 'examples/performer-focus/research/',
                              'examples/narrated-cut/workflow-media/', 'examples/narrated-cut/variants/', 'examples/spoken-type/media/')
    # Internal review sheets and raw subject arrays remain in the complete source
    # downloads. Public players do not need duplicate loose copies of these files.
    archive_only_files=('docs/assets/video-codec-comparison.jpg','docs/assets/film-review-contact.jpg','examples/head-performance/result-subjects.npz')
    for name in archive_only_files:
        loose=(output/name.removeprefix('docs/')).resolve()
        if output not in loose.parents:raise ValueError('Archive-only cleanup escaped the showcase.')
        loose.unlink(missing_ok=True)
    # Preserve legacy castle download URLs from the same verified example
    # files, without checking redundant copies into every source archive.
    castle_aliases={'docs/castle/source.mp4':'examples/coastal-kingdom/source.mp4',
                    'docs/castle/transformation.mp4':'examples/coastal-kingdom/result.mp4',
                    'docs/castle/camera-take.mp4':'examples/castle-pullback/result.mp4'}
    for name,canonical in castle_aliases.items():
        receipt=json.loads(blobs['docs/castle/provenance.json'])['files'][Path(name).name]
        data=blobs[canonical]
        if len(data)!=receipt['bytes'] or hashlib.sha256(data).hexdigest()!=receipt['sha256']:
            raise ValueError('Castle review alias differs from its verified receipt: '+name)
        target=(output/name.removeprefix('docs/')).resolve()
        if output not in target.parents:raise ValueError('Castle alias path escapes output.')
        target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
    # Raw camera outputs can be identical to their finished takes. Keep their
    # legacy public URLs while storing one canonical copy in source packages.
    example_aliases={'examples/crystal-transition/raw.mp4':'examples/crystal-transition/result.mp4',
                     'examples/castle-pullback/raw.mp4':'examples/castle-pullback/result.mp4'}
    for name,canonical in example_aliases.items():
        target=(output/name).resolve()
        if output not in target.parents:raise ValueError('Example alias path escapes output.')
        target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(blobs[canonical])
    for prefix in archive_media_prefixes:
        loose_media = (output / prefix).resolve()
        if output not in loose_media.parents:
            raise ValueError('Loose media cleanup escapes the showcase output.')
        if loose_media.exists():
            for old in loose_media.rglob('*'):
                if old.is_file():
                    if loose_media not in old.resolve().parents:
                        raise ValueError('Unexpected loose media path.')
                    old.unlink()
    for name, data in blobs.items():
        if name.startswith(archive_media_prefixes) or name in castle_aliases or name in archive_only_files:
            continue
        if name.startswith(('docs/assets/', 'docs/castle/', 'docs/type/', 'docs/cast/', 'docs/ads/', 'docs/agent/', 'docs/judges/','docs/create/', 'examples/')):
            relative = name.removeprefix('docs/') if name.startswith('docs/') else name
            destination = (output / relative).resolve()
            if output not in destination.parents:
                raise ValueError('Asset path escapes output: ' + name)
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(data)
    # Verify both ad projects and their licensed media before including them in
    # the complete source downloads from this exact snapshot.
    ad_prefix = 'examples/social-ad/'
    ad_files = {name.removeprefix(ad_prefix): data for name, data in blobs.items() if name.startswith(ad_prefix)}
    if not {'project-a.json', 'project-b.json', 'ATTRIBUTION.txt', 'media/pour.mp4', 'media/grounds.mp4', 'media/brew.mp4'} <= set(ad_files):
        raise ValueError('The ad convenience download needs both editable projects and their licensed media.')
    # All ad projects and original media are already in the complete source
    # downloads below. Do not retain another 15 MB ZIP of those same bytes as
    # new workflow examples are added to the showcase.
    ad_package = (output / 'assets/aftertake-social-ad-projects.zip').resolve()
    if output not in ad_package.parents:
        raise ValueError('Ad archive cleanup escaped the showcase.')
    ad_package.unlink(missing_ok=True)
    # Target 20 MiB per independent ZIP. A larger individual film may occupy its
    # own part, provided the resulting archive still passes the host's 25 MiB cap.
    # All application code and JSON workflows go into part one.
    cap = 20 * 1024 * 1024
    groups = [[]]
    sizes = [0]
    binary = {'.mp4', '.png', '.jpg', '.jpeg', '.ttf', '.wav'}
    for name in sorted(blobs, key=lambda name: (Path(name).suffix.lower() in binary, name)):
        data = blobs[name]
        if len(data) >= 25 * 1024 * 1024:
            raise ValueError('Source file exceeds static host size limit: ' + name)
        if sizes[-1] + len(data) > cap and groups[-1]:
            groups.append([])
            sizes.append(0)
        groups[-1].append(name)
        sizes[-1] += len(data)
    downloads = (output / 'downloads').resolve()
    if output not in downloads.parents:
        raise ValueError('Source download paths must stay inside the showcase.')
    downloads.mkdir(exist_ok=True)
    prior_index = downloads / 'source-packages.json'
    prior_parts = json.loads(prior_index.read_text(encoding='utf-8'))['parts'] if prior_index.exists() else []
    parts = []
    for index, names in enumerate(groups, 1):
        filename = f'aftertake-{revision[:12]}-source-{index}-of-{len(groups)}.zip'
        target = downloads / filename
        with zipfile.ZipFile(target, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            for name in names:
                archive.writestr(name, blobs[name])
        with zipfile.ZipFile(target) as archive:
            for name in names:
                if archive.read(name) != blobs[name]:
                    raise ValueError('Source package verification failed: ' + name)
        parts.append({'file': filename, 'bytes': target.stat().st_size, 'sha256': hashlib.sha256(target.read_bytes()).hexdigest(), 'files': len(names)})
    current_parts = {part['file'] for part in parts}
    for old in prior_parts:
        name = old['file']
        target = (downloads / name).resolve()
        if Path(name).name != name or not name.startswith('aftertake-') or not name.endswith('.zip') or target.parent != downloads:
            raise ValueError('Unexpected prior source package path.')
        if name not in current_parts:
            target.unlink(missing_ok=True)
    source_index = {'format': 'aftertake-source-parts/1', 'sourceCommit': revision, 'files': len(blobs), 'parts': parts,
                    'instructions': 'Download every ZIP and extract them into the same empty folder. These are independent ZIPs with different files. Model weights are separate. Use a Git checkout for history-dependent development checks.'}
    (downloads / 'source-packages.json').write_text(json.dumps(source_index, indent=2) + '\n', encoding='utf-8')
    links = ' · '.join(f'<a href="downloads/{part["file"]}" download>Part {i}</a>' for i, part in enumerate(parts, 1))
    section = '<section class="details" id="source-downloads" aria-label="Complete source downloads"><p><strong>Complete source snapshot, workflows and media.</strong><br/>' + links + '<br/>Download every part and extract them into the same empty folder. Model weights are separate.</p><p>App code is MIT; media and models retain their own licenses. <a href="downloads/source-packages.json">Package checksums and instructions</a></p></section>\n'
    page = blobs['docs/index.html'].decode('utf-8')
    if page.count('</main>') != 1:
        raise ValueError('Unexpected landing-page structure.')
    page = page.replace('Explore recorded sources, results, cues and frame-editing recipes without Python, model downloads or a GPU. New generation uses your connected local Comfy engine.',
                        f'Try {len(manifest["cases"])} examples here, or download the complete source below for the matching local workspace. New generation uses your connected local Comfy engine.')
    page = page.replace('href="assets/aftertake-portrait-teaser.mp4"', 'href="portrait/"')
    page = page.replace('</body>', '<script type="module" src="assets/recorded-video-preview.js"></script>\n</body>')
    (output / 'assets/recorded-video-preview.js').write_bytes(blobs['public/recorded-video-preview.js'])
    (output / 'agent/guide.txt').write_bytes(blobs['docs/mcp.md'])
    (output / 'ads/narrated-cut-guide.txt').write_bytes(blobs['docs/narrated-cut.md'])
    (output / 'cast/focus-guide.txt').write_bytes(blobs['docs/performer-focus.md'])
    (output / 'cast/performance-guide.txt').write_bytes(blobs['docs/face-performance.md'])
    (output / 'cast/head-guide.txt').write_bytes(blobs['docs/head-performance.md'])
    (output / 'ads/script-guide.txt').write_bytes(blobs['docs/script-draft.md'])
    (output / 'agent/evidence.json').write_bytes(blobs['docs/agent-edit-evidence.json'])
    (output / 'judges/evidence.json').write_bytes(blobs['docs/judges-film-evidence.json'])
    (output / 'index.html').write_text(page.replace('</main>', section + '</main>'), encoding='utf-8')
    portrait = output / 'portrait'
    portrait.mkdir(exist_ok=True)
    (portrait / 'index.html').write_text('''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Aftertake — portrait cut</title>
<style>@font-face{font-family:Manrope;src:url('../assets/manrope.ttf')}*{box-sizing:border-box}body{margin:0;background:#171d14;color:#d5e991;font:14px/1.7 Manrope,sans-serif}.wrap{max-width:840px;margin:0 auto;padding:28px 20px}header{display:flex;justify-content:space-between;gap:20px;align-items:center}a{color:inherit;text-underline-offset:4px}.brand{font-size:24px;font-weight:700;text-decoration:none}h1{font-size:26px;margin:26px 0 4px}p{color:#aebda0;margin:0 0 18px}video{display:block;width:auto;max-width:100%;height:min(72vh,960px);margin:0 auto;background:#0c1109;border:1px solid #445637;border-radius:6px}.download{display:block;width:max-content;margin:18px auto 0;padding:10px 16px;border:1px solid #62794a;border-radius:4px}</style></head>
<body><main class="wrap"><header><a class="brand" href="../">a↗ aftertake</a><a href="../studio/">Try the editor ↗</a></header><h1>A different reality, in 24 seconds.</h1><p>Actual app captures and local outputs. Silent captions. Generation waits omitted; short guide and cue previews are labeled as looped.</p>
<video controls playsinline preload="metadata" poster="../assets/portrait-teaser-poster.jpg" aria-label="Aftertake 24-second portrait teaser"><source src="../assets/aftertake-portrait-teaser.mp4" type="video/mp4"></video>
<a class="download" href="../assets/aftertake-portrait-teaser.mp4" download>Download portrait MP4 ↧</a></main><script type="module" src="../assets/recorded-video-preview.js"></script></body></html>
''', encoding='utf-8')
    proof = {'format': 'aftertake-showcase/1', 'sourceCommit': revision, 'examples': len(manifest['cases']),
             'manifestAssets': len(manifest['files']), 'allSourceBlobsVerified': True, 'sourceParts': parts,
             'demoSHA256': hashlib.sha256(blobs['docs/assets/aftertake-demo.mp4']).hexdigest(),
             'judgesSHA256': hashlib.sha256(blobs['docs/assets/aftertake-judges.mp4']).hexdigest(),
             'portraitSHA256': hashlib.sha256(blobs['docs/assets/aftertake-portrait-teaser.mp4']).hexdigest(),
             'socialAdPackage': {'files': len(ad_files), 'includedIn': 'sourceParts', 'allSourceFilesVerified': True},
             'castleHostedAliases':castle_aliases,'exampleHostedAliases':example_aliases}
    (output / 'showcase.json').write_text(json.dumps(proof, indent=2) + '\n', encoding='utf-8')
    for path in output.rglob('*'):
        if path.is_file() and path.stat().st_size >= 25 * 1024 * 1024:
            raise ValueError('Static asset exceeds host file size limit: ' + str(path))
    if sum(path.stat().st_size for path in output.rglob('*') if path.is_file()) > 250 * 1024 * 1024:
        raise ValueError('The expanded static package exceeds the showcase size budget.')
    print(json.dumps(proof, indent=2))


if __name__ == '__main__':
    main()
