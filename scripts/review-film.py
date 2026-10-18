"""Decode a bounded local film and save requested review frames and diagnostics."""
import hashlib,json,math,sys
from pathlib import Path
import av
import numpy as np

request=json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
source=Path(request['source']);output=Path(request['output']);times=request['times']
if not 1<=len(times)<=8 or any(not isinstance(t,(int,float)) or not math.isfinite(t) or t<0 or t>600 for t in times):
    raise ValueError('Choose one to eight finite review times inside a ten-minute film.')
output.mkdir(parents=True,exist_ok=True)
frames=[];count=0;last=None;max_gap=0;wanted=sorted(enumerate(times),key=lambda item:item[1]);audio_samples=0;energy=0.;peak=0.;clipped=0;audio_gap=0.;previous_end=None
with av.open(str(source)) as container:
    stream=container.streams.video[0];fps=float(stream.average_rate);width,height=stream.width,stream.height
    if width>4096 or height>4096 or not 1<=fps<=120:raise ValueError('Review is bounded to 4K and 120 fps.')
    manifest=json.loads(container.metadata['comment'])
    for frame in container.decode(video=0):
        at=float(frame.time);count+=1
        if count>72001:raise ValueError('Review film exceeds ten minutes.')
        if last is not None:max_gap=max(max_gap,abs(at-last-1/fps))
        last=at
        while wanted and at+1e-6>=wanted[0][1]:
            index,requested=wanted.pop(0);file=f'frame-{index+1:02d}.jpg';image=frame.to_image();image.thumbnail((960,540));image.save(output/file,quality=92)
            frames.append({'requestedTime':requested,'decodedTime':at,'file':file})
    if wanted:raise ValueError('A requested review time exceeds the decoded picture.')
with av.open(str(source)) as container:
    if container.streams.audio:
        for frame in container.decode(audio=0):
            values=frame.to_ndarray().astype('float64')
            if frame.format.name.startswith('s16'):values/=32768
            elif frame.format.name.startswith('s32'):values/=2147483648
            energy+=float(np.square(values).sum());audio_samples+=values.size;peak=max(peak,float(np.abs(values).max()));clipped+=int((np.abs(values)>=1).sum())
            at=float(frame.time)
            if previous_end is not None:audio_gap=max(audio_gap,abs(at-previous_end))
            previous_end=at+frame.samples/frame.sample_rate
report={'sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'width':width,'height':height,'fps':fps,'frameCount':count,'duration':count/fps,
 'maxVideoTimestampDeviationSeconds':max_gap,'frames':sorted(frames,key=lambda f:f['requestedTime']),
 'audio':{'decodedValues':audio_samples,'rms':math.sqrt(energy/audio_samples) if audio_samples else None,'samplePeak':peak if audio_samples else None,'samplesAtOrAboveFullScale':clipped,'maxTimestampGapSeconds':audio_gap},
 'manifest':manifest,'notice':'Decoded sample diagnostics and selected frames; not a perceptual or editorial quality score.'}
(output/'report.json').write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
# Process protocols must survive Windows' legacy console code pages. The saved
# report remains UTF-8; ASCII JSON escapes preserve Unicode over stdout.
print(json.dumps(report,ensure_ascii=True))
