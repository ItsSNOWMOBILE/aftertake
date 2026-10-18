"""Draft bounded, editable spoken copy using a pinned local CPU language model."""
import argparse,hashlib,json,os,time
from pathlib import Path
from filelock import FileLock

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('request');parser.add_argument('output');parser.add_argument('--models',required=True)
args=parser.parse_args();root=Path(__file__).resolve().parents[1]
request_file=Path(args.request).resolve();output_file=Path(args.output).resolve()
if request_file.parent!=output_file.parent or request_file==output_file:raise ValueError('Use separate request and result files in the same job directory.')
input=json.loads(request_file.read_text(encoding='utf-8'));request=input['request'];digest=input['requestDigest']

def atomic(value):
 temporary=output_file.with_name(output_file.name+f'.{os.getpid()}.tmp')
 temporary.write_text(json.dumps(value,ensure_ascii=False),encoding='utf-8');temporary.replace(output_file)

# Rejoining after studio restart waits for the same cache, even if the original
# Python process outlived its parent. Other local copy jobs share this lock.
with FileLock(str(output_file.parent/'inference.lock'),timeout=235):
 if output_file.exists():
  saved=json.loads(output_file.read_text(encoding='utf-8'))
  if saved.get('requestDigest')!=digest:raise ValueError('The saved script belongs to another request.')
 else:
  try:
   pictures=request['pictures'];closing=request.get('closingLine','');variation=request.get('variation',0)
   if not 1<=len(pictures)<=16 or not 10<=len(request['brief'])<=1600 or len(closing)>100 or not 0<=variation<=999:raise ValueError('Invalid bounded script request.')
   model=Path(args.models).resolve();manifest=json.loads((root/'docs/models-script.json').read_text(encoding='utf-8'))
   def sha256(path):
    value=hashlib.sha256()
    with path.open('rb')as f:
     while chunk:=f.read(4*1024*1024):value.update(chunk)
    return value.hexdigest()
   for file in manifest['files']:
    path=(model/file['path']).resolve()
    if model not in path.parents or path.stat().st_size!=file['size'] or sha256(path)!=file['sha256']:raise ValueError('The local script model differs from its pinned manifest. Run setup-script.py again.')
   import openvino_genai as g
   import openvino as ov
   started=time.perf_counter();pipe=g.LLMPipeline(model,'CPU',INFERENCE_NUM_THREADS=8,PERFORMANCE_HINT='LATENCY');loaded=time.perf_counter()
   system=('Draft voiceover copy for a short social product video. Write one naturally spoken line per picture, usually 3 to 7 words. '
    'The hook addresses the supplied audience. Middle lines may mention only supplied visible details or product facts. '
    'Do not infer product benefits, construction, comfort, performance, prices, endorsements or offers. '
    'Never say closeup, hero, shot, camera or scene in the voiceover. Do not describe filming instructions. '
    'Keep copy short for the available picture duration. Return only the requested JSON. '
    'When a closing line is provided, the last line must match it exactly. This is a draft for the user to review.')
   prompt=json.dumps({'brief':request['brief'],'pictures':pictures,'closingLine':closing,'version':variation},ensure_ascii=False)
   items=[{'type':'string','minLength':1,'maxLength':120}for _ in pictures]
   if closing:items[-1]={'const':closing}
   schema={'type':'object','properties':{'lines':{'type':'array','prefixItems':items,'items':False,'minItems':len(items),'maxItems':len(items)}},'required':['lines'],'additionalProperties':False}
   history=g.ChatHistory([{'role':'system','content':system},{'role':'user','content':prompt}]);history.set_extra_context({'enable_thinking':False})
   config=g.GenerationConfig(max_new_tokens=min(1200,128+len(items)*64),do_sample=variation>0,temperature=.65,top_p=.9,rng_seed=5090+variation,
    structured_output_config=g.StructuredOutputConfig(json_schema=json.dumps(schema)))
   response=pipe.generate(history,config);finished=time.perf_counter();lines=json.loads(response.texts[0])['lines']
   if len(lines)!=len(pictures) or any(not isinstance(line,str)or not line.strip()or len(line.strip())>120 or any(ord(c)<32 for c in line)for line in lines):raise ValueError('The local model returned invalid draft lines. Draft another version.')
   lines=[line.strip()for line in lines]
   if closing and lines[-1]!=closing:raise ValueError('The model changed the supplied closing line.')
   weights=next(file for file in manifest['files']if file['path']=='openvino_model.bin')
   result={'lines':lines,'receipt':{'model':'Qwen3-4B / OpenVINO INT4','revision':manifest['revision'],'weightsSha256':weights['sha256'],
    'runtime':'OpenVINO '+ov.get_version(),'device':'CPU','deviceName':ov.Core().get_property('CPU','FULL_DEVICE_NAME'),
    'loadSeconds':loaded-started,'generationSeconds':finished-loaded,'structuredOutput':True}}
   atomic({'requestDigest':digest,'result':result})
  except Exception as error:atomic({'requestDigest':digest,'error':str(error)[:1000]})
