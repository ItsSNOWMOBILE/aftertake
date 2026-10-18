"""Request, media-clock and compositing contracts for the optional local utility."""
import hashlib,json,math
from pathlib import Path

def sha(path):
    digest=hashlib.sha256()
    with Path(path).open('rb') as f:
        while chunk:=f.read(8*1024*1024):digest.update(chunk)
    return digest.hexdigest()

def checked_request(raw,directory):
    if raw.get('format')!='aftertake-face-performance/1':raise ValueError('Use an aftertake-face-performance/1 request.')
    frames,fps=raw.get('frames'),raw.get('fps')
    if type(frames)!=int or not 1<=frames<=257 or type(fps)!=int or not 1<=fps<=60:raise ValueError('Choose 1–257 frames and 1–60 fps.')
    result={'frames':frames,'fps':fps}
    for role in ['base','driver']:
        item=raw.get(role,{})
        if not isinstance(item,dict) or not isinstance(item.get('path'),str) or not isinstance(item.get('sha256'),str):raise ValueError('Bind both input files by path and SHA-256.')
        path=(Path(directory)/item['path']).resolve()
        if not path.is_file() or sha(path)!=item['sha256']:raise ValueError('Input content hash mismatch: '+role)
        box=item.get('box')
        if not isinstance(box,list) or len(box)!=4 or any(type(n) not in [int,float] or not math.isfinite(n) for n in box):raise ValueError('Supply a normalized first-frame face box.')
        if not (0<=box[0]<box[2]<=1 and 0<=box[1]<box[3]<=1):raise ValueError('Keep each face box inside its first frame.')
        result[role]={'path':path,'sha256':item['sha256'],'box':box}
    return result

def read_frames(path,count,fps):
    import av
    from media_utils import display_transform
    frames=[]
    with av.open(str(path)) as c:
        stream=c.streams.video[0]
        if not 64<=stream.width<=1920 or not 64<=stream.height<=1920:raise ValueError('Use upright media between 64 and 1920 pixels per side.')
        origin=None
        for f in c.decode(video=0):
            if f.width!=stream.width or f.height!=stream.height:raise ValueError('Input frame geometry changed inside the shot.')
            if f.time is None:raise ValueError('Input frames need timestamps.')
            if display_transform(f) is not None:raise ValueError('Bake the phone orientation into the pixels first.')
            if origin is None:origin=float(f.time)
            if abs(float(f.time)-origin-len(frames)/fps)>1e-6:raise ValueError('Both inputs must use the requested constant frame clock; no frame interpolation is performed.')
            frames.append(f.to_ndarray(format='rgb24'))
            if len(frames)==count:break
    if len(frames)!=count:raise ValueError('Input does not cover every requested frame.')
    return frames

def mouth_alpha(points,height,width):
    import cv2,numpy as np
    center=(points[48]+points[66])/2
    eyes=[np.mean(points[x],axis=0) for x in [[0,6,12,18],[24,30,36,42]]]
    distance=float(np.linalg.norm(eyes[1]-eyes[0]))
    if not 6<=distance<=min(height,width)*.4:raise ValueError('Tracked face scale is implausible; review the first-frame box.')
    angle=float(np.degrees(np.arctan2(*(eyes[1]-eyes[0])[::-1])))
    mask=np.zeros((height,width),np.float32)
    cv2.ellipse(mask,tuple(np.rint(center+[0,distance*.08]).astype(int)),(round(distance*.85),round(distance*.78)),angle,0,360,1,-1)
    hull=np.zeros_like(mask);cv2.fillConvexPoly(hull,cv2.convexHull(np.rint(points).astype(np.int32)),1)
    mask=cv2.GaussianBlur(mask*hull,(0,0),max(.5,distance*.055));mask[mask<1/255]=0
    return mask

def composite(base,generated,alpha):
    import numpy as np
    out=np.rint(generated*alpha[:,:,None]+base*(1-alpha[:,:,None])).clip(0,255).astype(np.uint8)
    if not np.array_equal(out[alpha==0],base[alpha==0]):raise ValueError('Protected pixels changed before encoding.')
    return out
