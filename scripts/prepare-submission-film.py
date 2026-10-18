"""Prepare a narration-first review project for Aftertake's Film editor.

Each paired beat owns its voice recording, shot, caption and measured timing.
--placeholders makes only a capture pass so the real project can be opened in
Aftertake. Never publish that pass. The editor performs the final export.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import urllib.request
import uuid
from urllib.parse import quote, urlsplit
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--url', default='http://127.0.0.1:4322')
parser.add_argument('--voices', default='examples/submission-film/beats.json')
parser.add_argument('--captures', default='.runtime/editorial-rebuild')
parser.add_argument('--placeholders', action='store_true')
args = parser.parse_args()
base = urlsplit(args.url)
if base.scheme != 'http' or base.hostname not in ['localhost', '127.0.0.1'] or base.username or base.password or base.path not in ['', '/'] or base.query or base.fragment:
    parser.error('Choose a local Aftertake studio URL.')
BASE = args.url.rstrip('/')
OUT = ROOT / 'examples/submission-film'
MEDIA = OUT / 'media'
MEDIA.mkdir(parents=True, exist_ok=True)


def api(path, payload=None, name=None):
    headers = {'Content-Type': 'application/octet-stream' if name else 'application/json'}
    body = payload if name else json.dumps(payload).encode() if payload is not None else None
    if name:
        path += '?name=' + quote(name)
    with urllib.request.urlopen(urllib.request.Request(BASE + path, data=body, headers=headers), timeout=250) as response:
        return json.load(response)


assets = api('/api/films/assets')
files, imported = {}, {}


def import_asset(source, public_name):
    if public_name in imported:
        return imported[public_name]
    source = Path(source).resolve()
    # Canonical examples already travel with the portable project. Retain their
    # paths instead of copying the same bytes into the preparation-media folder.
    canonical = source.is_relative_to((ROOT / 'examples').resolve()) and not source.is_relative_to(MEDIA.resolve())
    target = source if canonical else MEDIA / public_name
    if source != target.resolve():
        incoming = source.read_bytes()
        # Keep unchanged media in place while the native editor is open.
        if not target.exists() or hashlib.sha256(target.read_bytes()).digest() != hashlib.sha256(incoming).digest():
            temporary = target.with_name(target.name + '.tmp')
            temporary.write_bytes(incoming)
            temporary.replace(target)
    digest = hashlib.sha256(target.read_bytes()).hexdigest()
    asset = next((item for item in assets if item['sha256'] == digest), None)
    if not asset:
        asset = api('/api/films/assets', target.read_bytes(), public_name)
        assets.append(asset)
    files[asset['id']] = {'path': target.relative_to(ROOT).as_posix(), 'sha256': digest}
    imported[public_name] = asset
    return asset


# A plain graphic canvas. All lettering is editable Film typography.
Image.new('RGB', (1280, 720), '#10150f').save(MEDIA / 'type-canvas.png')
canvas = import_asset(MEDIA / 'type-canvas.png', 'type-canvas.png')
coast_path = ROOT / '.runtime/sources/cinematic-pack/lighthouse.mp4'
if not coast_path.exists():
    coast_path = MEDIA / 'lighthouse-original.mp4'
coast = import_asset(coast_path, 'lighthouse-original.mp4')
castle = import_asset(ROOT / 'examples/coastal-kingdom/edited-first-frame.png', 'castle-reference.png')
captures = ROOT / args.captures
screens = {}
for name in ['social-editor', 'social-hook', 'character-prompt', 'reveal','image','library','cue']:
    source = captures / f'{name}.png'
    if (captures / f'{name}.mp4').exists():
        source = captures / f'{name}.mp4'
    if not source.exists():
        if not args.placeholders:
            parser.error(f'Capture the actual {name} UI before the final pass: {source}')
        source = MEDIA / 'type-canvas.png'
    screens[name] = import_asset(source, f'ui-{name}{source.suffix}')

character_source = import_asset(ROOT / 'examples/character-h3/prepared-source.mp4', 'character-source.mp4')
character_result = import_asset(ROOT / 'examples/character-h3/result.mp4', 'character-result.mp4')
social_a = import_asset(ROOT / 'examples/social-ad/ad-a.mp4', 'social-ad-a.mp4')
social_b = import_asset(ROOT / 'examples/social-ad/ad-b.mp4', 'social-ad-b.mp4')

examples = {case['slug']: case for case in json.loads((ROOT / 'examples/manifest.json').read_text(encoding='utf-8'))['cases']}
voices = json.loads((ROOT / args.voices).read_text(encoding='utf-8'))
shots, titles, audio, ledger = [], [], [], []
clock = 0


def image_shot(asset, length, framing=None, source_in=0):
    shot = {'assetId':asset['id'], 'start':source_in, 'end':source_in+length, 'sha256':asset['sha256']}
    if framing:
        shot['framing'] = framing
    shots.append(shot)


def take_shot(slug, length, source_in=0):
    case = examples[slug]
    digest = hashlib.sha256((ROOT / 'examples' / case['result']).read_bytes()).hexdigest()
    shots.append({'renderId':case['renderId'], 'start':source_in, 'end':source_in+length, 'sha256':digest})


def title(text, start, end, style='headline', position='bottom', color='#ffffff', animation='fade'):
    if end-start < .25:
        raise ValueError('A title needs readable time.')
    titles.append({'id':str(uuid.uuid5(uuid.NAMESPACE_URL,f'aftertake-review:{start}:{text}')), 'text':text,
        'start':start, 'end':end, 'style':style, 'position':position, 'animation':animation, 'color':color})


def zoom(start, end, x=.5, y=.5):
    return {'zoom':start, 'endZoom':end, 'x':x, 'y':y}


captions = {
    'ordinary':'One ordinary shot.', 'ending':'A different ending.', 'brand':'AFTERTAKE',
    'footage':'Your footage.', 'paint':'Choose what changes.', 'frame':'Edit a reference frame.',
    'image':'Generate an image.', 'animation':'Bring it into motion.', 'recipes':'Reuse the recipe.',
    'motion':'Bring the idea into motion.', 'camera':'Direct a new camera move.',
    'character-prompt':'Cast your own character.', 'character-result':'New character. Same scene.',
    'receipt':'Your settings. Your workflow.', 'sdk':'Comfy SDK.\nOpen code. Open weights.',
    'cut':'Cut the story here.', 'titles':'Add titles.', 'voice':'Voice the script.',
    'project':'Keep the editable project.', 'twist':"The twist?",
    'reveal':'Made in Aftertake.', 'looking':'The project that made it.',
    'code':'Open code.', 'weights':'Open weights.', 'yours':'Make the next take yours.',
    'social':'Make ads and reels.', 'hook':'Try another hook.',
    'editable':'Change the words, voice and timing.',
    'vfx':'Change reality.',
}
screen_for = {'social':'social-editor', 'hook':'social-hook', 'editable':'social-editor','image':'image','paint':'cue','recipes':'library',
    'character-prompt':'character-prompt', 'reveal':'reveal', 'looking':'reveal'}
# The opening is a real native portrait export, including its original local
# voice recordings on this editable timeline. Its separate project retains all
# seven text layers, source trims and both hook variants.
social_project = json.loads((ROOT / 'examples/social-ad/project-a.json').read_text(encoding='utf-8'))
for index, (track, caption, begin, end,source_begin) in enumerate(zip(social_project['audio'],
    ['Your morning called.', 'Ground.', 'Pour.', 'Pause.', 'Slow mornings. Find your next cup.'],
    [0,2,3.125,4.25,5.375],[2,3.125,4.25,5.375,8.125],[0,3,4.25,5.5,6.75])):
    image_shot(social_a,end-begin,source_in=source_begin)
    row = social_project['sourceFiles'][track['assetId']]
    asset = import_asset(ROOT / row['path'], f'social-{Path(row["path"]).name}')
    voice_start=begin+track['start']-source_begin
    audio.append({**track,'start':voice_start, 'assetId':asset['id'], 'sha256':asset['sha256']})
    ledger.append({'name':f'ad-{index+1}', 'start':begin, 'end':end, 'spokenText':caption,
        'voiceStart':voice_start, 'voiceEnd':voice_start+track['sourceEnd'],
        'caption':caption, 'shotNumbers':[index+1], 'visual':'native vertical coffee concept ad', 'placeholder':False})
clock = 8.125
for beat in voices:
    name, text = beat['name'], beat['text']
    asset = next((item for item in assets if item.get('narration',{}).get('text') == text and item['narration'].get('voice') == 'af_heart' and item['narration'].get('speed') == 1.05), None)
    if not asset:
        asset = api('/api/films/narration', {'text':text,'voice':'af_heart','speed':1.05})
        assets.append(asset)
    # Never truncate or rush the voice to fit a pre-existing picture interval.
    length = math.ceil(max(beat['minimumHold'],asset['duration']+.3)*24)/24
    dissolve_frames = {'brand':4,'social':4,'hook':3,'editable':3,'vfx':4,
        'character-prompt':4,'twist':4,'reveal':4,'sdk':4,'yours':4,'image':4,'animation':4,'paint':4,'recipes':4}.get(name,0)
    clock -= dissolve_frames/24
    if name in ['motion','camera']:
        length = 4
    if name == 'character-result':
        length = min(length, character_result['duration'])
    target = MEDIA / f'voice-{name}.wav'
    with urllib.request.urlopen(BASE+asset['url']) as response:
        target.write_bytes(response.read())
    if hashlib.sha256(target.read_bytes()).hexdigest() != asset['sha256']:
        raise ValueError('A narration recording changed.')
    files[asset['id']] = {'path':target.relative_to(ROOT).as_posix(), 'sha256':asset['sha256']}
    voice_start = clock+.12
    audio.append({'assetId':asset['id'], 'start':voice_start, 'sourceStart':0,
        'sourceEnd':asset['duration'], 'volume':1, 'sha256':asset['sha256'],
        'asset':{key:asset[key]for key in ['kind','sha256','duration','narration']}})
    first_shot = len(shots)
    if name == 'ordinary':
        image_shot(coast,length)
    elif name == 'ending':
        take_shot('castle-pullback',length,.5)
    elif name == 'footage':
        image_shot(coast,length,source_in=2.5)
    elif name == 'motion':
        take_shot('coastal-kingdom',length)
    elif name == 'animation':
        image_shot(import_asset(ROOT/'examples/observatory/source.png','observatory-source.png'),.5)
        take_shot('observatory',length-.5,.5)
    elif name == 'camera':
        image_shot(castle,1)
        take_shot('castle-pullback',length-1)
    elif name == 'vfx':
        image_shot(import_asset(ROOT/'examples/coastal-kingdom/source.mp4','castle-source.mp4'),.5)
        take_shot('coastal-kingdom',length-.5,.5)
    elif name == 'character-result':
        # Advance the same source clock across the replacement cut. Restarting
        # the generated clip at zero would repeat motion and jump the background.
        before = 11/24
        image_shot(character_source,before)
        image_shot(character_result,length-before,source_in=before)
    elif name in screen_for:
        key = screen_for[name]
        framing = None
        if name == 'receipt':
            framing = zoom(1.3,1.4,.94,.45)
        source_in = 4.8 if name == 'looking' and screens[key]['kind'] == 'video' else 0
        if name == 'editable' and screens[key]['kind'] == 'video':
            source_in = 4
        image_shot(screens[key],length,framing,source_in=source_in)
    else:
        image_shot(canvas,length)
    if dissolve_frames:
        shots[first_shot]['dissolve'] = dissolve_frames/24
    # A caption belongs to one spoken beat; it cannot outlive that concept.
    style = 'caption' if name in screen_for or name in ['motion','camera','character-result'] else 'headline'
    position = 'center' if name in ['brand','sdk','twist','code','weights','yours'] else 'bottom'
    title(captions[name],clock+.12,clock+length-.08,style,position)
    motion_titles={
        'brand':('wipe',.4,130), 'twist':('typewriter',.45,88),
        'code':('impact',.4,132), 'weights':('build',.65,128),
        'yours':('build',.8,112),
    }
    if name in motion_titles:
        animation,entrance,size=motion_titles[name]
        titles[-1].update(animation=animation,motionDuration=entrance,fontSize=size)
    if name == 'brand':
        title('AN OPEN CREATIVE STUDIO',clock+.12,clock+length-.08,'kicker','bottom','#d5e991')
    if name == 'reveal':
        title('CUT · TITLED · VOICED · EXPORTED HERE',clock+.12,clock+length-.08,'kicker','top','#d5e991')
    if name == 'character-result':
        title('H3 CHARACTER SWAP',clock+.12,clock+length-.08,'kicker','top','#d5e991')
        titles[-1]['fontSize']=18
    ledger.append({'name':name,'start':clock,'end':clock+length,'spokenText':text,
        'voiceStart':voice_start,'voiceEnd':voice_start+asset['duration'],
        'caption':captions[name],'shotNumbers':list(range(first_shot+1,len(shots)+1)),
        'visual':screen_for.get(name,name), 'dissolveInFrames':dissolve_frames,
        'placeholder':name in screen_for and not any((captures/f'{screen_for[name]}{suffix}').exists() for suffix in ['.png','.mp4'])})
    clock += length

clock -= 4/24
image_shot(canvas,2.5)
shots[-1]['dissolve'] = 4/24
title('AFTERTAKE',clock+.08,clock+2.4,'headline','center','#d5e991')
title('FOOTAGE · MICHAEL BURROWS + DEAN DIEMERT / PEXELS\nTEARS OF STEEL · BLENDER FOUNDATION · CC BY 3.0\nZ-IMAGE · QWEN IMAGE EDIT · H3 CHARACTER SWAP · LTX-2.5 · SAM3 · KOKORO\nFictional coffee concept · Generation waits omitted',clock+.08,clock+2.4,'kicker','bottom')
clock += 2.5
if any(row['voiceEnd'] > row['end']-(.1 if row['name'].startswith('ad-') else .15) for row in ledger):
    raise ValueError('A voice recording spills into the next visual beat.')

project = {'format':'aftertake-film/2', 'name':'Aftertake — ads, reels and impossible takes / review 10', 'aspect':'landscape',
    'shots':shots,'titles':titles,'audio':audio,'sourceVolume':0,'normalizeAudio':True,'sourceFiles':files,
    'notes':'Narration-first paired beats. Opens with an actual native 9:16 concept ad using Michael Burrows / Pexels footage, generic local Kokoro voices and editable companion projects for two manually prepared hooks. Licensed Dean Diemert / Pexels coast and silent Tears of Steel / Blender Foundation CC BY 3.0 excerpt with generated VFX. Actual local outputs and real UI captures. Generation waits omitted. Review cut; not a contest submission.'}
(OUT/'project.json').write_text(json.dumps(project,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
(OUT/'storyboard.json').write_text(json.dumps({'status':'capture pass' if args.placeholders else 'review cut','duration':clock,'beats':ledger},indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
(OUT/'narration.txt').write_text('\n\n'.join(f"{row['voiceStart']:.3f}s — {row['voiceEnd']:.3f}s\n{row['spokenText']}" for row in ledger)+'\n',encoding='utf-8')
api('/api/films/resolve',project)
print(f'Prepared {clock:.2f}s, {len(shots)} cuts, {len(titles)} titles, {len(audio)} whole voice recordings. Import project.json in Film assembly and export there.')
