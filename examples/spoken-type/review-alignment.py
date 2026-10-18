"""Optional independent CPU timing review; downloads the pinned Apache-2.0 Wav2Vec2 model.
Run in the installed Comfy Python runtime with transformers and torch.
Model card: https://huggingface.co/facebook/wav2vec2-base-960h
"""
import json,os,re,time,hashlib
os.environ['HF_HUB_DISABLE_XET']='1'
from pathlib import Path
import numpy as np,torch,imageio_ffmpeg,subprocess
from transformers import AutoProcessor,AutoModelForCTC
root=Path(__file__).resolve().parents[2];work=Path(__file__).parent;revision='22aad52d435eb6dbaf354bdad9b0da84ce7d6156';cache=root/'.runtime/alignment-models'
from huggingface_hub import hf_hub_download
checkpoint=Path(hf_hub_download('facebook/wav2vec2-base-960h','model.safetensors',revision=revision,cache_dir=str(cache)))
assert hashlib.sha256(checkpoint.read_bytes()).hexdigest()=='8aa76ab2243c81747a1f832954586bc566090c83a0ac167df6f31f0fa917d74a', 'Review model checksum mismatch'
torch.set_num_threads(2);torch.set_num_interop_threads(1)
processor=AutoProcessor.from_pretrained('facebook/wav2vec2-base-960h',revision=revision,cache_dir=str(cache))
model=AutoModelForCTC.from_pretrained('facebook/wav2vec2-base-960h',revision=revision,cache_dir=str(cache)).eval()
project=json.loads((root/'examples/spoken-type/exported-project.json').read_text());vocab=processor.tokenizer.get_vocab();blank=model.config.pad_token_id

def align(emission,labels):
 states=[blank]
 for label in labels:states.extend([label,blank])
 count=len(states);prev=np.full(count,-np.inf);prev[0]=0;back=[]
 for frame in emission:
  choices=np.stack([prev,np.r_[-np.inf,prev[:-1]],np.r_[[-np.inf,-np.inf],prev[:-2]]])
  for i in range(count):
   if i<2 or i%2==0 or states[i]==states[i-2]:choices[2,i]=-np.inf
  step=choices.argmax(axis=0);prev=choices[step,np.arange(count)]+frame[states];back.append(step)
 state=count-1 if prev[-1]>=prev[-2]else count-2;path=[]
 for t in range(len(back)-1,-1,-1):path.append((t,state));state-=int(back[t][state])
 return path[::-1]

reports=[]
for index,track in enumerate(project['audio']):
 filename=root/'examples/spoken-type/media'/f'voice-{index+1}.wav';audio=np.frombuffer(subprocess.check_output([imageio_ffmpeg.get_ffmpeg_exe(),'-v','error','-i',str(filename),'-ac','1','-ar','16000','-f','f32le','pipe:1']),dtype='<f4').copy()
 inputs=processor(audio,sampling_rate=16000,return_tensors='pt');before=time.monotonic()
 with torch.inference_mode():logits=model(**inputs).logits[0];emission=logits.log_softmax(-1).numpy()
 text=track['asset']['narration']['text'];written=text.split();tokens=[re.sub("[^A-Z']",'',word.upper())for word in written];target='|'.join(tokens);labels=[vocab[letter]for letter in target]
 decoded=processor.decode(logits.argmax(-1));path=align(emission,labels);offset=0;words=[];stride=model.config.inputs_to_logits_ratio/16000
 for original,letters in zip(written,tokens):
  hits=[t for t,state in path if state%2 and offset<=state//2<offset+len(letters)]
  words.append({'text':original,'start':min(hits)*stride,'end':(max(hits)+1)*stride});offset+=len(letters)+1
 report={'text':text,'decoded':decoded,'seconds':time.monotonic()-before,'words':words,'modelWords':track['asset']['narration']['wordTiming']['words']};reports.append(report);print(json.dumps(report),flush=True)
(work/'alignment-rerun.json').write_text(json.dumps({'model':'facebook/wav2vec2-base-960h','revision':revision,'lines':reports},indent=2))
