import hashlib,importlib.util,json,sys,tempfile,unittest
from fractions import Fraction
from pathlib import Path
import av,numpy as np
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'));sys.path.insert(0,str(ROOT/'custom_nodes/aftertake'))
from face_performance import checked_request,read_frames

class FacePerformanceContractTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.folder=Path(self.tmp.name)
        self.video=self.folder/'input.mp4'
        with av.open(str(self.video),'w') as c:
            s=c.add_stream('libx264',rate=24);s.width=96;s.height=96;s.pix_fmt='yuv420p'
            for i in range(3):
                im=np.zeros((96,96,3),np.uint8);im[:,:,i]=120
                f=av.VideoFrame.from_ndarray(im,format='rgb24');f.pts=i;f.time_base=Fraction(1,24)
                for p in s.encode(f):c.mux(p)
            for p in s.encode():c.mux(p)
        entry={'path':'input.mp4','sha256':hashlib.sha256(self.video.read_bytes()).hexdigest(),'box':[.2,.2,.6,.6]}
        self.request={'format':'aftertake-face-performance/1','frames':3,'fps':24,'base':dict(entry),'driver':dict(entry)}
    def tearDown(self):self.tmp.cleanup()
    def test_hash_bound_inputs_cannot_silently_change(self):
        checked_request(self.request,self.folder)
        self.video.write_bytes(self.video.read_bytes()+b'changed')
        with self.assertRaisesRegex(ValueError,'content hash mismatch'):checked_request(self.request,self.folder)
    def test_face_box_and_clock_request_are_bounded(self):
        for box in [[.5,.2,.4,.6],[0,0,1,float('nan')],[-.1,0,1,1]]:
            self.request['driver']['box']=box
            with self.assertRaisesRegex(ValueError,'face box'):checked_request(self.request,self.folder)
        self.request['driver']['box']=[0,0,1,1];self.request['frames']=True
        with self.assertRaisesRegex(ValueError,'frames'):checked_request(self.request,self.folder)
    def test_no_frame_is_held_to_cover_a_short_input(self):
        self.assertEqual(len(read_frames(self.video,3,24)),3)
        with self.assertRaisesRegex(ValueError,'cover every'):read_frames(self.video,4,24)
    def test_mismatched_driver_clock_rejects_instead_of_resampling(self):
        with self.assertRaisesRegex(ValueError,'constant frame clock'):read_frames(self.video,3,25)

if __name__=='__main__':unittest.main()
