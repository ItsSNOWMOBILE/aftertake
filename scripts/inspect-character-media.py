"""Check a decoded character deliverable's actual clock, geometry and coverage."""
from pathlib import Path
import json
import sys
import av

path=Path(sys.argv[1])
with av.open(str(path))as container:
    video=container.streams.video[0]
    result={'width':video.width,'height':video.height,'fps':float(video.average_rate or 0),
        'frames':0,'hasAudio':bool(container.streams.audio),'regularTimestamps':True}
    previous=None;result['firstTimestamp']=None
    for frame in container.decode(video=0):
        timestamp=float(frame.pts*frame.time_base)
        if result['firstTimestamp'] is None:result['firstTimestamp']=timestamp
        if previous is not None and abs(timestamp-previous-1/24)>0.0011:result['regularTimestamps']=False
        previous=timestamp;result['frames']+=1
result['duration']=result['frames']/result['fps'] if result['fps'] else 0
if result['hasAudio']:
    with av.open(str(path))as container:
        track=container.streams.audio[0]
        info={'sampleRate':track.rate,'channels':track.codec_context.channels,'samples':0,
              'duration':float(track.duration*track.time_base)if track.duration is not None else None,
              'firstTimestamp':None,'regularTimestamps':True}
        end=None
        for frame in container.decode(audio=0):
            timestamp=float(frame.pts*frame.time_base)
            if info['firstTimestamp'] is None:info['firstTimestamp']=timestamp
            if end is not None and abs(timestamp-end)>.0011:info['regularTimestamps']=False
            info['samples']+=frame.samples;end=timestamp+frame.samples/frame.sample_rate
        result['audio']=info
print(json.dumps(result))
