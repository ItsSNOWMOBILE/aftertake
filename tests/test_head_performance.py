import copy,hashlib,sys,tempfile,unittest
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
from head_performance import checked_head_request,validate_annotations,head_composite

class HeadPerformanceTests(unittest.TestCase):
    def test_portrait_and_media_are_content_bound_and_annotations_start_at_zero(self):
        with tempfile.TemporaryDirectory()as directory:
            folder=Path(directory)
            for name in ['base.mp4','driver.mp4','portrait.png']:(folder/name).write_bytes(name.encode())
            def item(name):return {'path':name,'sha256':hashlib.sha256(name.encode()).hexdigest(),'box':[.2,.1,.5,.5]}
            annotation={'frame':0,'points':[[30,30],[80,80]],'labels':[1,0],'box':[15,15,55,55]}
            request={'format':'aftertake-head-performance/1','frames':3,'fps':24,'base':item('base.mp4'),'driver':item('driver.mp4'),'portrait':{**item('portrait.png'),'kind':'aligned-512'},'matte':{'source':[annotation],'generation':[annotation]}}
            checked_head_request(request,folder)
            changed=copy.deepcopy(request);changed['matte']['source'][0]['frame']=1
            with self.assertRaisesRegex(ValueError,'first-frame'):checked_head_request(changed,folder)
            changed=copy.deepcopy(request);changed['portrait']['sha256']='0'*64
            with self.assertRaisesRegex(ValueError,'Portrait content'):checked_head_request(changed,folder)
            (folder/'driver.mp4').write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError,'Input content'):checked_head_request(request,folder)

    def test_annotation_geometry_rejects_an_offscreen_click(self):
        a={'frame':0,'points':[[30,30]],'labels':[1],'box':[10,10,60,60]}
        validate_annotations({'source':[a],'generation':[a]},100,100)
        a['points']=[[100,30]]
        with self.assertRaisesRegex(ValueError,'click falls outside'):validate_annotations({'source':[a]},100,100)

    def test_moving_head_and_exposed_contour_leave_scene_pixels_exact(self):
        rng=np.random.default_rng(5090);base=rng.integers(0,256,(128,128,3),dtype=np.uint8);placed=base.copy();placed[35:60,45:70]=[190,130,80]
        old=np.zeros((128,128),np.uint8);new=old.copy();old[35:60,38:63]=1;new[35:60,45:70]=1
        result,alpha,removed=head_composite(base,placed,old,new)
        self.assertGreater(int(removed.sum()),0)
        protected=(alpha==0)&(removed==0)
        self.assertTrue(np.array_equal(result[protected],base[protected]))
        self.assertFalse(np.array_equal(result[alpha>.99],base[alpha>.99]))
        with self.assertRaisesRegex(ValueError,'too much'):head_composite(base,placed,np.ones_like(old),new)
        with self.assertRaisesRegex(ValueError,'binary'):head_composite(base,placed,old,new.astype('float32')*.5)

if __name__=='__main__':unittest.main()
