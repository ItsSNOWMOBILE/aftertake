"""Install the optional, pinned video-driven mouth-performance utility."""
import argparse,concurrent.futures,hashlib,json,subprocess,sys,urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime-dir',type=Path,default=ROOT/'.runtime/face-performance/LivePortrait')
    parser.add_argument('--python',type=Path,default=ROOT/('.runtime/venv/Scripts/python.exe' if sys.platform=='win32' else '.runtime/venv/bin/python'))
    args=parser.parse_args();runtime=args.runtime_dir.resolve();python=args.python.resolve()
    manifest=json.loads((ROOT/'docs/models-face-performance.json').read_text(encoding='utf-8'))
    if not python.is_file():parser.error('Install the GPU runtime first: python scripts/setup.py --skip-models')
    if not (runtime/'.git').is_dir():
        runtime.mkdir(parents=True,exist_ok=True)
        if any(runtime.iterdir()):parser.error('Use an empty runtime directory or an existing pinned checkout.')
        subprocess.run(['git','init',str(runtime)],check=True)
        subprocess.run(['git','-C',str(runtime),'remote','add','origin',manifest['code']['repository']],check=True)
        subprocess.run(['git','-C',str(runtime),'fetch','--depth','1','origin',manifest['code']['revision']],check=True)
        subprocess.run(['git','-C',str(runtime),'checkout','--detach','FETCH_HEAD'],check=True)
    if subprocess.check_output(['git','-C',str(runtime),'rev-parse','HEAD'],text=True).strip()!=manifest['code']['revision']:
        parser.error('The existing runtime has another revision; preserve it and choose a new directory.')
    subprocess.run(['git','-C',str(runtime),'diff','--exit-code','HEAD','--'],check=True)
    # Keep optional ONNX packages apart from the main engine's pinned dependencies.
    deps=ROOT/'.runtime/face-performance/deps';deps.mkdir(parents=True,exist_ok=True)
    subprocess.run([str(python),'-m','pip','install','--no-deps','--target',str(deps),'onnxruntime==1.23.2','flatbuffers==25.12.19'],check=True)
    def download(row):
        target=runtime/'pretrained_weights'/row['path'];target.parent.mkdir(parents=True,exist_ok=True)
        def valid(p):return p.is_file() and p.stat().st_size==row['bytes'] and hashlib.sha256(p.read_bytes()).hexdigest()==row['sha256']
        if not valid(target):
            part=target.with_suffix(target.suffix+'.partial')
            urllib.request.urlretrieve(f'https://huggingface.co/{manifest["repo"]}/resolve/{manifest["revision"]}/{row["path"]}',part)
            if not valid(part):raise ValueError('Model integrity mismatch: '+row['path'])
            part.replace(target)
        print(row['path']+': verified',flush=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:list(pool.map(download,manifest['files']))
    config=ROOT/'.runtime/face-performance/config.json';config.write_text(json.dumps({'runtime':str(runtime),'deps':str(deps)},indent=2)+'\n',encoding='utf-8')
    print('Optional face utility ready. See docs/face-performance.md. No video has been uploaded.')

if __name__=='__main__':main()
