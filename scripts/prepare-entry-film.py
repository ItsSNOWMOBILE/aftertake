"""Prepare the measured entry film in a loopback Aftertake workspace.

Import project.json in Film, record that project's reveal, then run again
without --capture-pass before exporting. No contest submission is performed.
"""
import argparse, hashlib, json, math, uuid
from pathlib import Path
from urllib.parse import quote, urlsplit
import urllib.request

ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--url',default='http://127.0.0.1:4332')
parser.add_argument('--capture-pass',action='store_true')
args=parser.parse_args();url=urlsplit(args.url)
if url.scheme!='http' or url.hostname not in ['localhost','127.0.0.1'] or url.username or url.password or url.path not in ['', '/'] or url.query or url.fragment:parser.error('Choose a loopback studio URL.')
BASE=args.url.rstrip('/');OUT=ROOT/'examples/judges-film';MEDIA=OUT/'media'
def read(p):return json.loads(p.read_text(encoding='utf-8'))
def save(p,v):p.write_text(json.dumps(v,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def api(route,value=None,name=None):
 headers={'Content-Type':'application/octet-stream' if name else 'application/json'}
 data=value if name else json.dumps(value).encode() if value is not None else None
 if name:route+='?name='+quote(name)
 try:
  with urllib.request.urlopen(urllib.request.Request(BASE+route,data=data,headers=headers),timeout=270)as response:return json.load(response)
 except urllib.error.HTTPError as error:raise RuntimeError(error.read().decode())from error
assets=api('/api/films/assets');files={};shots=[];titles=[];audio=[];ledger=[]
def asset(file,receipt=None):
 p=(ROOT/file).resolve()
 if ROOT not in p.parents:raise ValueError('Keep sources inside the checkout.')
 digest=sha(p)
 if receipt and receipt['sha256']!=digest:raise ValueError('Voice bytes changed.')
 item=next((a for a in assets if a['sha256']==digest),None)
 if not item:item=api('/api/films/assets',p.read_bytes(),p.name);assets.append(item)
 # Restore the byte-verified shipped voice receipt through the portable project.
 # /resolve preserves any other receipt on identical audio and forks if needed.
 if receipt and receipt.get('narration'):item={**item,'narration':receipt['narration']}
 files[item['id']]={'path':p.relative_to(ROOT).as_posix(),'sha256':digest}
 return item
def picture(file,length,start=0,dissolve=0):
 item=asset(file)
 if item['kind']!='image' and round((start+length)*24)>round(item['duration']*24):raise ValueError('Insufficient picture coverage: '+file)
 return {'assetId':item['id'],'sha256':item['sha256'],'start':start,'end':start+length,'dissolve':dissolve}
def timeline():
 cursor=0;previous=0;rows=[]
 for i,s in enumerate(shots):
  count=round(s['end']*24)-round(s['start']*24);overlap=min(round(s.get('dissolve',0)*24),count//2,previous//2)if i else 0
  start=cursor-overlap;cursor=start+count;previous=count;rows.append({'start':start/24,'end':cursor/24})
 return rows
def title(text,start,end,style='caption',position='bottom',size=34,animation='fade',color='#ffffff',motion=.3):
 if end-start<.25 or len(text)>240:raise ValueError('Use readable bounded titles.')
 titles.append({'id':str(uuid.uuid5(uuid.NAMESPACE_URL,f'aftertake-entry:{text}:{start}')),'text':text,'start':start,'end':end,'style':style,'position':position,'animation':animation,'fontSize':size,'color':color,'motionDuration':motion})
spec=read(OUT/'beats.json');voices=read(OUT/'voices.json')
canvas='examples/submission-film/media/type-canvas.png';source='examples/submission-film/media/'
tags={'builder':'WRITE → LOCAL VOICE → EDITABLE CUT','words':'FOLLOW VOICE · EDITABLE WORD TIMES','hook':'ONE NEW HOOK · SAME BODY & FOOTAGE',
 'agent-editing':'LOCAL MCP · INSPECT / PLAN / EXPORT / REVIEW','image':'Z-IMAGE TURBO · TEXT TO IMAGE','animation':'LTX · IMAGE TO VIDEO',
 'camera':'CAMERA · FRAMING GUIDANCE','ending':'START + END IMAGE GUIDES','reference':'QWEN IMAGE EDIT · SAME COMPOSITION',
 'paint':'ONE CUE · SPACE + TIME','vfx':'LTX MASK GUIDANCE + SOURCE COMPOSITE','character-prompt':'NATURAL FICTIONAL APPEARANCE',
 'character-result':'H3 CHARACTER SWAP V1.5','recipes':'RECIPES + EXECUTED WORKFLOWS','subject-matte':'SAM 2.1 · REVIEWED SUBJECT MATTE',
 'build-stack':'OPEN CODE · LOCAL OPEN-WEIGHT WORKFLOWS','contribution':'ONE EDITABLE CREATIVE CHAIN'}
for beat in spec['beats']:
 name=beat['name'];voice_row=voices.get(name);voice=asset(voice_row['file'],voice_row['asset'])if voice_row else None
 length=math.ceil(max(beat['minimum'],voice['duration']+9/24 if voice else 0)*24)/24;first=len(shots)
 if name=='ad':cuts=[picture('examples/spoken-type/result.mp4',length)]
 elif name=='builder':cuts=[picture('examples/judges-film/media/entry-ui-builder-lines.mp4',1.5),picture('examples/judges-film/media/entry-ui-builder.mp4',length-1.5+.125,.5,.125)]
 elif name=='words':cuts=[picture('examples/judges-film/media/entry-ui-words.mp4',length,.25)]
 elif name=='hook':cuts=[picture('examples/judges-film/media/entry-ui-hook.mp4',1.25),picture('examples/judges-film/media/entry-ui-hook.mp4',length-1.25+.125,3.25,.125)]
 elif name=='agent-editing':cuts=[picture('examples/judges-film/media/entry-ui-agent.mp4',length,.5)]
 elif name=='image':cuts=[picture(source+'ui-image.png',length)]
 elif name=='animation':cuts=[picture('examples/observatory/result.mp4',length,.25)]
 elif name in ['camera','ending','reference','paint','recipes']:
  ui={'camera':'camera','ending':'ending','reference':'reference','paint':'cue','recipes':'library'}[name]
  cuts=[picture('examples/judges-film/media/entry-ui-'+ui+'.mp4',length,.25 if name not in ['camera']else 0)]
 elif name=='vfx':cuts=[picture('examples/coastal-kingdom/source.mp4',.75),picture('examples/coastal-kingdom/result.mp4',length-.625,.625,.125)]
 elif name=='character-prompt':cuts=[picture(source+'ui-character-prompt.mp4',length)]
 elif name=='character-result':cuts=[picture('examples/character-h3/prepared-source.mp4',.75),picture('examples/character-h3/result.mp4',length-.625,.625,.125)]
 elif name=='subject-matte':cuts=[picture('examples/performer-focus/subject-matte.mp4',length)]
 elif name=='contribution':
  cuts=[picture('examples/coastal-kingdom/result.mp4',2),picture('examples/judges-film/media/entry-ui-reference.mp4',2,.75,.125),picture('examples/judges-film/media/entry-ui-agent.mp4',length-3.75,2,.125)]
 elif name=='reveal':
  reveal='examples/judges-film/media/entry-ui-reveal.mp4'
  if not (ROOT/reveal).exists():
   if not args.capture_pass:parser.error('Record this exact native project before its final export.')
   cuts=[picture(canvas,length)]
  else:cuts=[picture(reveal,length,.25)]
 else:cuts=[picture(canvas,length)]
 cuts[0]['dissolve']=.125 if first else 0;shots.extend(cuts);rows=timeline();start=rows[first]['start'];end=rows[-1]['end'];vs=start+.125
 if voice:
  audio.append({'assetId':voice['id'],'sha256':voice['sha256'],'start':vs,'sourceStart':0,'sourceEnd':voice['duration'],'volume':1,
   'asset':{key:voice[key]for key in ['kind','sha256','duration','narration']}})
  if vs+voice['duration']>end-.2:raise ValueError('Whole voice does not fit: '+name)
  if name not in ['brand','build-stack','twist','yours']:title(beat.get('caption',beat['text']),vs,end-.08)
 if name in tags and name!='character-result':title(tags[name],start+.125,end-.08,'kicker','top',23,color='#d5e991')
 if name=='brand':title('AFTERTAKE',vs,end-.08,'headline','center',118,'impact',color='#d5e991');title('ADS. REELS. IMPOSSIBLE SCENES.',vs,end-.08,'kicker','top',27)
 if name=='build-stack':title('REACT + TYPESCRIPT\nCOMFY SDK\nPYAV + FFMPEG',vs,end-.08,'headline','center',67,'build',motion=1.5)
 if name=='contribution':
  for at,text in enumerate(['PROTECT THE SCENE.','INSPECT THE WORK.','REOPEN THE EDIT.']):
   cut=rows[first+at];title(text,cut['start']+.125,cut['end']-.125,'headline','center',64,'rise',color='#d5e991')
 if name=='twist':title('THE TWIST?',vs,end-.08,'headline','center',118,'impact',color='#d5e991')
 if name=='yours':title('MAKE THE NEXT TAKE\nYOURS.',vs,end-.08,'headline','center',92,'build',color='#d5e991',motion=.65)
 if name=='character-result':title('H3 CHARACTER SWAP',start+.125,end-.08,'kicker','top',18,color='#d5e991')
 if name=='credits':
  title('OPEN CODE. OPEN WEIGHTS.',start+.125,end-.08,'headline','center',76,'fade',color='#d5e991')
  title('MICHAEL BURROWS + DEAN DIEMERT / PEXELS\nTEARS OF STEEL · BLENDER FOUNDATION · CC BY 3.0\nFictional coffee concept · Generation waits omitted',start+.125,end-.08,'kicker','bottom',20)
 beat['duration']=length
 ledger.append({'name':name,'start':start,'end':end,'spokenText':beat.get('text',''),'voiceStart':vs if voice else None,'voiceEnd':vs+voice['duration']if voice else None,'caption':beat.get('caption',beat.get('text','')),'shotNumbers':list(range(first+1,len(shots)+1)),'visual':beat['visual'],'placeholder':args.capture_pass and name=='reveal'})
duration=timeline()[-1]['end']
if duration>120 or len(shots)>48 or len(audio)>32 or len(titles)>80:raise ValueError('Native film limits exceeded.')
project={'format':'aftertake-film/2','name':'Aftertake / an open creative chain','aspect':'landscape','shots':shots,'titles':titles,'audio':audio,'sourceVolume':.7,'normalizeAudio':True,'sourceFiles':files,
 'notes':'Actual UI recordings at 1280 × 720 and local outputs. Source/result comparisons retain the same source clock and geometry. Generation waits omitted. '+('Capture pass: replace the reveal before export.'if args.capture_pass else 'Fresh native editor reveal. Awaiting Jay review; not submitted.')}
if not args.capture_pass:
 receipt=read(OUT/'capture-receipts.json')['reveal']
 if receipt['projectDuration']!=duration or receipt['sha256']!=sha(ROOT/'examples/judges-film/media/entry-ui-reveal.mp4'):raise ValueError('Record this exact project before export.')
api('/api/films/resolve',project);save(OUT/'project.json',project);save(OUT/'storyboard.json',{'status':'capture pass'if args.capture_pass else'review cut','duration':duration,'beats':ledger})
spec.update(status='capture pass'if args.capture_pass else'review cut',measuredDuration=duration);save(OUT/'beats.json',spec)
(OUT/'narration.txt').write_text('\n\n'.join(f"{b['voiceStart']:.3f}s — {b['voiceEnd']:.3f}s\n{b['spokenText']}"for b in ledger if b['voiceStart']is not None)+'\n',encoding='utf-8')
print(json.dumps({'duration':duration,'shots':len(shots),'titles':len(titles),'voices':len(audio),'project':str(OUT/'project.json')}))
