"""Contracts and source-preserving blend for an experimental head-performance pass."""
from pathlib import Path
import math
from face_performance import checked_request,sha

def checked_head_request(raw,directory):
    if raw.get('format')!='aftertake-head-performance/1':raise ValueError('Use an aftertake-head-performance/1 request.')
    result=checked_request({**raw,'format':'aftertake-face-performance/1'},directory)
    portrait=raw.get('portrait',{})
    if not isinstance(portrait,dict) or portrait.get('kind')!='aligned-512' or not isinstance(portrait.get('path'),str):raise ValueError('Supply an aligned 512-square portrait with the complete head and neck.')
    path=(Path(directory)/portrait['path']).resolve()
    if not path.is_file() or sha(path)!=portrait.get('sha256'):raise ValueError('Portrait content hash mismatch.')
    result['portrait']={**portrait,'path':path}
    matte=raw.get('matte',{})
    if not isinstance(matte,dict):raise ValueError('Supply reviewed head annotations.')
    for role in ['source','generation']:
        annotations=matte.get(role,[])
        if not isinstance(annotations,list) or not 1<=len(annotations)<=8:raise ValueError('Supply one to eight reviewed head annotations per input.')
        if any(not isinstance(a,dict) for a in annotations):raise ValueError('Head annotations must be objects.')
        if not any(a.get('frame')==0 for a in annotations):raise ValueError('Every head needs a first-frame annotation.')
        for a in annotations:
            if type(a.get('frame'))!=int or not 0<=a['frame']<result['frames']:raise ValueError('A head annotation falls outside the shot.')
            pts,labels=a.get('points',[]),a.get('labels',[])
            if not isinstance(pts,list) or not 1<=len(pts)<=32 or len(labels)!=len(pts) or any(type(n)!=int or n not in [0,1] for n in labels) or 1 not in labels:raise ValueError('Head clicks need matching positive/negative labels.')
            if any(not isinstance(p,list) or len(p)!=2 or any(type(v) not in [int,float] or not math.isfinite(v) for v in p) for p in pts):raise ValueError('Head clicks must be finite pixel coordinates.')
            box=a.get('box')
            if not isinstance(box,list) or len(box)!=4 or any(type(v) not in [int,float] or not math.isfinite(v) for v in box):raise ValueError('Supply an explicit pixel box around the head.')
    result['matte']={role:matte[role]for role in ['source','generation']}
    return result

def validate_annotations(matte,width,height):
    for annotations in matte.values():
        for a in annotations:
            l,t,r,b=a['box']
            if not (0<=l<r<width and 0<=t<b<height and r-l>=24 and b-t>=24):raise ValueError('Keep each head box inside the display frame, at least 24 pixels per side.')
            if any(not(0<=x<width and 0<=y<height)for x,y in a['points']):raise ValueError('A head click falls outside the display frame.')

def head_composite(base,placed,old,new):
    import cv2,numpy as np
    if base.dtype!=np.uint8 or placed.dtype!=np.uint8 or base.shape!=placed.shape or base.ndim!=3 or base.shape[-1]!=3:raise ValueError('Head and base plates need identical RGB geometry.')
    if old.shape!=base.shape[:2] or new.shape!=old.shape or any(not np.isin(mask,[0,1]).all() for mask in [old,new]):raise ValueError('Subject masks must be binary and match the display frame.')
    if any(not 10<=np.count_nonzero(mask)<=mask.size*.15 for mask in [old,new]):raise ValueError('Head segmentation is empty or covers too much of the scene; review annotations.')
    old,new=old.astype('uint8'),new.astype('uint8')
    removal=cv2.dilate(old,np.ones((3,3),np.uint8))*(1-cv2.erode(new,np.ones((3,3),np.uint8)))
    clean=cv2.inpaint(base,removal,3,cv2.INPAINT_TELEA)
    alpha=cv2.GaussianBlur(new.astype('float32'),(0,0),.7);alpha[alpha<1/255]=0
    result=np.rint(placed*alpha[:,:,None]+clean*(1-alpha[:,:,None])).clip(0,255).astype('uint8')
    protected=(alpha==0)&(removal==0)
    if not np.array_equal(result[protected],base[protected]):raise ValueError('Protected scene pixels changed before encoding.')
    return result,alpha,removal
