import json,os,subprocess,sys,tempfile,unittest
from pathlib import Path
import av
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
class FilmReviewTest(unittest.TestCase):
    def test_real_review_preserves_unicode_metadata_through_a_legacy_windows_process_pipe(self):
        with tempfile.TemporaryDirectory() as folder:
            folder=Path(folder);source=folder/'source.mp4';manifest={'name':'Narration · café ☕','audio':[{'name':'珈琲'}]}
            with av.open(str(source),'w') as container:
                container.metadata['comment']=json.dumps(manifest,ensure_ascii=False)
                stream=container.add_stream('libx264',rate=24);stream.width=320;stream.height=180;stream.pix_fmt='yuv420p'
                for i in range(12):
                    for packet in stream.encode(av.VideoFrame.from_image(Image.new('RGB',(320,180),(i*15,20,30)))):container.mux(packet)
                for packet in stream.encode():container.mux(packet)
            request=folder/'request.json';request.write_text(json.dumps({'source':str(source),'output':str(folder/'review'),'times':[0,.2,.4]}),encoding='utf-8')
            result=subprocess.run([sys.executable,str(ROOT/'scripts/review-film.py'),str(request)],check=True,capture_output=True,env={**os.environ,'PYTHONIOENCODING':'cp1252'})
            report=json.loads(result.stdout.decode('utf-8'))
            self.assertEqual(report['manifest'],manifest);self.assertEqual(report['frameCount'],12);self.assertEqual(report['duration'],.5)
            self.assertLess(report['maxVideoTimestampDeviationSeconds'],1e-8)
            self.assertEqual(len(report['frames']),3);self.assertEqual(report['audio']['decodedValues'],0)
            for frame in report['frames']:self.assertTrue((folder/'review'/frame['file']).exists())

if __name__=='__main__':unittest.main()
