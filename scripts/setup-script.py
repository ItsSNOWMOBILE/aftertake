"""Install the optional local copy model and its separate CPU runtime."""
import hashlib,json,subprocess,sys,urllib.request,venv
from pathlib import Path
root=Path(__file__).resolve().parents[1];environment=root/'.runtime/script-venv'
python=environment/('Scripts/python.exe'if sys.platform=='win32'else'bin/python')
if not python.exists():venv.create(environment,with_pip=True)
subprocess.run([str(python),'-m','pip','install','openvino-genai==2026.4.1.0','filelock==4.2.2'],check=True)
manifest=json.loads((root/'docs/models-script.json').read_text(encoding='utf-8'));models=root/'.runtime/script-model';models.mkdir(parents=True,exist_ok=True)
def digest(path):
 result=hashlib.sha256()
 with path.open('rb')as f:
  while chunk:=f.read(4*1024*1024):result.update(chunk)
 return result.hexdigest()
for file in manifest['files']:
 target=(models/file['path']).resolve()
 if models.resolve()not in target.parents:raise ValueError('Model path escapes its directory.')
 if target.is_file()and target.stat().st_size==file['size']and digest(target)==file['sha256']:continue
 temporary=target.with_name(target.name+'.download')
 url='https://huggingface.co/'+manifest['repository']+'/resolve/'+manifest['revision']+'/'+file['path']
 with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Aftertake-script-setup/1'}),timeout=180)as response,temporary.open('wb')as output:
  while chunk:=response.read(4*1024*1024):output.write(chunk)
 if temporary.stat().st_size!=file['size']or digest(temporary)!=file['sha256']:
  temporary.unlink();raise ValueError('Downloaded script weights failed their checksum.')
 temporary.replace(target)
print('Local script drafting is ready. Restart Aftertake if it is running.')
