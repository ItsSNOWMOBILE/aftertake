"""Decode an actual export to verify title timing, cuts, sound and provenance."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import wave
import av
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('film_renderer', ROOT / 'scripts/render-film.py')
renderer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(renderer)


class FilmRenderTest(unittest.TestCase):
    def test_trimmed_soundtrack_starts_on_its_timeline_without_mastering_delay(self):
        with tempfile.TemporaryDirectory(prefix='aftertake-audio-alignment-') as temporary:
            folder=Path(temporary);Image.new('RGB',(160,90),'#123456').save(folder/'picture.png')
            rate=48000;t=np.arange(2*rate)/rate
            # A changing frequency makes a few milliseconds of lookahead delay
            # observable; a periodic tone could accidentally correlate after it.
            signal=.22*np.sin(2*np.pi*(370*t+730*t*t))*(.7+.3*np.sin(2*np.pi*3.7*t))
            pcm=(signal*32767).astype('<i2')
            with wave.open(str(folder/'source.wav'),'wb') as audio:
                audio.setparams((2,2,rate,0,'NONE','not compressed'))
                audio.writeframes(np.column_stack([pcm,pcm]).astype('<i2').tobytes())
            gain=10**(-1/20);target=folder/'aligned.mp4'
            renderer.assemble({'output':str(target),'width':160,'height':90,
                'shots':[{'source':str(folder/'picture.png'),'kind':'image','start':0,'end':2}],
                'titles':[],'fonts':str(ROOT/'public/fonts'),'sourceVolume':0,'normalizeAudio':False,
                'audio':[{'source':str(folder/'source.wav'),'start':.25,'sourceStart':.1,'sourceEnd':1.1,'volume':gain}],
                'manifest':{}})
            with av.open(str(target)) as movie:
                self.assertEqual(sum(1 for _ in movie.decode(video=0)),48)
            with av.open(str(target)) as movie:
                stream=movie.streams.audio[0]
                self.assertEqual(stream.rate,rate)
                self.assertAlmostEqual(float(stream.duration*stream.time_base),2,delta=1/rate)
                sound=np.concatenate([f.to_ndarray() for f in movie.decode(audio=0)],axis=1).mean(axis=0)
            # Compare an interior window at the authored clock, with no lag
            # search that could conceal a timing error in the exported movie.
            first,last=round(.3*rate),round(1.2*rate)
            reference=pcm[round(.15*rate):round(1.05*rate)].astype(float)/32768
            actual=sound[first:last].astype(float)
            correlation=float(np.dot(reference,actual)/np.sqrt(np.dot(reference,reference)*np.dot(actual,actual)))
            self.assertGreater(correlation,.995,'The continuous soundtrack moved off its authored timeline.')
            measured_gain=float(np.dot(reference,actual)/np.dot(reference,reference))
            self.assertAlmostEqual(measured_gain,gain,delta=.01)
            self.assertLess(float(np.abs(sound[:round(.2*rate)]).max()),.001)
            self.assertLess(float(np.abs(sound[round(1.3*rate):]).max()),.001)

    def test_spoken_highlights_follow_word_times_and_phrase_changes_across_a_cut(self):
        with tempfile.TemporaryDirectory(prefix='aftertake-spoken-') as temporary:
            folder=Path(temporary);Image.new('RGB',(640,360),'#123456').save(folder/'picture.png')
            title={'text':'Make it yours. Now.','start':.13,'end':2.9,'style':'headline','position':'center',
                'animation':'spoken','fontSize':90,'color':'#d5e991','words':[
                    {'text':'Make','start':.1,'end':.45,'phrase':0},{'text':'it','start':.6,'end':.85,'phrase':0},
                    {'text':'yours.','start':1.1,'end':1.4,'phrase':0},{'text':'Now.','start':1.7,'end':2,'phrase':1}]}
            target=folder/'spoken.mp4'
            renderer.assemble({'output':str(target),'width':640,'height':360,
                'shots':[{'source':str(folder/'picture.png'),'kind':'image','start':0,'end':length}for length in [1,2]],
                'titles':[title],'audio':[],'sourceVolume':0,'fonts':str(ROOT/'public/fonts'),'manifest':{'titles':[title]}})
            with av.open(str(target))as movie:
                self.assertEqual(json.loads(movie.metadata['comment'])['titles'],[title])
                frames=[frame.to_ndarray(format='rgb24').astype(float)for frame in movie.decode(video=0)]
            self.assertEqual(len(frames),72)
            def green(frame):return (frame[:,:,1]>frame[:,:,0]+8)&(frame[:,:,1]>frame[:,:,2]+40)
            layout=renderer.speech_layout(title,640,360,str(ROOT/'public/fonts'))
            for word in title['words']:
                frame=frames[round((title['start']+(word['start']+word['end'])/2)*24)]
                ys,xs=np.where(green(frame));self.assertGreater(len(xs),100)
                part=layout['phrases'][word['phrase']];at=part['timings'].index(word);left,top,right,bottom=part['layout']['words'][at]['rect']
                self.assertAlmostEqual(float(xs.mean()),(left+right)/2,delta=4)
                self.assertAlmostEqual(float(ys.mean()),(top+bottom)/2,delta=4)
            self.assertLess(int(green(frames[round((title['start']+.52)*24)]).sum()),15)

    def test_normalized_mix_preserves_a_quieter_lines_envelope_after_a_mastered_clip(self):
        with tempfile.TemporaryDirectory(prefix='aftertake-levels-') as temporary:
            folder=Path(temporary);Image.new('RGB',(320,180),'#123456').save(folder/'picture.png')
            rate=48000;t=np.arange(8*rate)/rate
            carrier=np.sin(t*2*np.pi*311)+.3*np.sin(t*2*np.pi*719)
            envelope=np.where((t>=3)&(t<6),.045,.19)
            signal=carrier*envelope*(.75+.25*np.sin(t*2*np.pi*1.1))
            with wave.open(str(folder/'voice.wav'),'wb') as voice:
                voice.setparams((1,2,rate,0,'NONE','not compressed'))
                voice.writeframes((signal*32767).astype('<i2').tobytes())
            target=folder/'levels.mp4'
            renderer.assemble({'output':str(target),'width':320,'height':180,
                'shots':[{'source':str(folder/'picture.png'),'kind':'image','start':0,'end':8}],
                'titles':[],'fonts':str(ROOT/'public/fonts'),'sourceVolume':0,'normalizeAudio':True,
                'audio':[{'source':str(folder/'voice.wav'),'start':0,'sourceStart':0,'sourceEnd':8,'volume':1}],
                'manifest':{}})
            with av.open(str(target)) as movie:
                sound=np.concatenate([f.to_ndarray() for f in movie.decode(audio=0)],axis=1).mean(axis=0)
            # Compare the entire quieter line. An automatic gain ramp can keep
            # 100 ms windows intact while audibly changing the line as a whole.
            reference=signal[round(3.1*rate):round(5.9*rate)]
            correlations=[]
            for lag in range(0,481):
                actual=sound[round(3.1*rate)+lag:round(5.9*rate)+lag]
                correlations.append(float(np.dot(reference,actual)/np.sqrt(np.dot(reference,reference)*np.dot(actual,actual))))
            self.assertGreater(max(correlations),.995)
            lag=int(np.argmax(correlations));gains=[]
            for start in [3.2,4.2,5.2]:
                a=round(start*rate);b=round((start+.4)*rate)
                gains.append(float(np.sqrt(np.square(sound[a+lag:b+lag]).mean()/np.square(signal[a:b]).mean())))
            self.assertLess(max(gains)/min(gains),1.025)
            self.assertLess(float(np.abs(sound).max()),.9)

    def test_titles_touching_a_computed_dissolve_boundary_have_no_empty_float_overlap(self):
        import math
        title={'text':'NEXT LINE','start':math.nextafter(82/24,0),'end':5.75,'style':'headline','position':'center','animation':'impact','fontSize':96,'color':'#ff00ff'}
        self.assertIsNone(renderer.title_window(title,37,45))
        self.assertEqual(renderer.title_window(title,79,64),(3,59,0,56))
        with tempfile.TemporaryDirectory(prefix='aftertake-title-frame-boundary-') as temporary:
            folder=Path(temporary);Image.new('RGB',(320,180),'#123456').save(folder/'blue.png')
            target=folder/'boundary.mp4'
            renderer.assemble({'output':str(target),'width':320,'height':180,
                'shots':[{'source':str(folder/'blue.png'),'kind':'image','start':0,'end':count/24,'dissolve':.125 if index else 0} for index,count in enumerate([40,45,64])],
                'titles':[title],'audio':[],'sourceVolume':0,'fonts':str(ROOT/'public/fonts'),'manifest':{'titles':[title]}})
            with av.open(str(target)) as container:
                frames=[frame.to_ndarray(format='rgb24') for frame in container.decode(video=0)]
            self.assertEqual(len(frames),143)
            def magenta(index):
                pixels=frames[index];return int(((pixels[:,:,0]>170)&(pixels[:,:,2]>170)&(pixels[:,:,1]<100)).sum())
            self.assertLess(magenta(81),5)
            self.assertGreater(magenta(90),100)
            self.assertLess(magenta(139),5)

    def test_title_fade_keeps_its_global_phase_across_cut_boundaries(self):
        with tempfile.TemporaryDirectory(prefix='aftertake-film-title-phase-') as temporary:
            folder = Path(temporary)
            Image.new('RGB',(640,360),'#123456').save(folder/'blue.png')
            title={'text':'Across the cut','start':.35,'end':1.15,'style':'headline','position':'center','animation':'fade','color':'#ffffff'}
            target=folder/'crossing.mp4'
            renderer.assemble({'output':str(target),'width':640,'height':360,
                'shots':[{'source':str(folder/'blue.png'),'kind':'image','start':0,'end':.5} for _ in range(3)],
                'titles':[title],'audio':[],'sourceVolume':0,'fonts':str(ROOT/'public/fonts'),'manifest':{}})
            with av.open(str(target)) as container:
                frames=[frame.to_ndarray(format='rgb24') for frame in container.decode(video=0)]
            self.assertEqual(len(frames),36)
            glyph=np.asarray(renderer.title_image(title,640,360,ROOT/'public/fonts'))
            mask=(glyph[:,:,3]>245)&(glyph[:,:,0]>250)
            brightness=[float(frame[:,:,0][mask].mean()) for frame in frames]
            self.assertLess(brightness[11],brightness[12])
            self.assertLess(brightness[12],brightness[16]-15)
            self.assertGreater(brightness[16],220)
            self.assertLess(brightness[30],25)

    def test_framing_enlarges_the_chosen_detail_over_the_whole_shot(self):
        with tempfile.TemporaryDirectory(prefix='aftertake-film-framing-') as temporary:
            folder = Path(temporary)
            picture = np.zeros((360, 640, 3), dtype=np.uint8)
            picture[140:220, 280:360] = [240, 10, 10]
            Image.fromarray(picture).save(folder / 'detail.png')
            target = folder / 'zoom.mp4'
            renderer.assemble({'output':str(target),'width':640,'height':360,
                'shots':[{'source':str(folder/'detail.png'),'kind':'image','start':0,'end':1,
                    'framing':{'zoom':1,'endZoom':2,'x':.5,'y':.5}}],
                'titles':[],'audio':[],'sourceVolume':0,'fonts':str(ROOT/'public/fonts'),'manifest':{}})
            with av.open(str(target)) as container:
                frames = [frame.to_ndarray(format='rgb24') for frame in container.decode(video=0)]
            self.assertEqual(len(frames),24)
            areas = [int(((frame[:,:,0]>150)&(frame[:,:,1]<50)).sum()) for frame in frames]
            self.assertGreater(areas[-1],areas[0]*3.8)
            self.assertLess(areas[-1],areas[0]*4.2)
            self.assertTrue(all(b >= a-100 for a,b in zip(areas,areas[1:])))

    def test_slow_off_center_framing_has_no_pixel_step_shake(self):
        with tempfile.TemporaryDirectory(prefix='aftertake-film-smooth-') as temporary:
            folder = Path(temporary)
            picture = np.full((360, 640, 3), 24, dtype=np.uint8)
            picture[80:120, 110:150] = [240, 24, 24]
            Image.fromarray(picture).save(folder / 'marker.png')
            target = folder / 'slow.mp4'
            renderer.assemble({'output':str(target),'width':640,'height':360,
                'shots':[{'source':str(folder/'marker.png'),'kind':'image','start':0,'end':3,
                    'framing':{'zoom':1,'endZoom':1.04,'x':.7,'y':.4}}],
                'titles':[],'audio':[],'sourceVolume':0,'fonts':str(ROOT/'public/fonts'),'manifest':{}})
            with av.open(str(target)) as container:
                frames = [frame.to_ndarray(format='rgb24').astype(float) for frame in container.decode(video=0)]
            yy, xx = np.indices((360,640))
            centers = []
            for frame in frames:
                # A color-weighted centroid retains subpixel motion after the
                # actual H.264 encode; a hard threshold would quantize it again.
                weight = np.maximum(0,frame[:,:,0]-np.maximum(frame[:,:,1],frame[:,:,2])-15)
                centers.append([(weight*xx).sum()/weight.sum(),(weight*yy).sum()/weight.sum()])
            centers = np.asarray(centers)
            self.assertEqual(len(centers),72)
            self.assertLess(float(np.linalg.norm(np.diff(centers,n=2,axis=0),axis=1).max()),.2)
            # The movement must still reach the requested scale and anchor.
            expected = (centers[0]-np.array([640*.7,360*.4]))*1.04+np.array([640*.7,360*.4])
            np.testing.assert_allclose(centers[-1],expected,atol=.2)

    def test_normalized_narration_keeps_every_opening_burst_across_many_cuts(self):
        with tempfile.TemporaryDirectory(prefix='aftertake-film-clock-') as temporary:
            folder = Path(temporary)
            Image.new('RGB', (640, 360), '#123456').save(folder / 'picture.png')
            rate = 24000
            signal = np.zeros(8 * rate, dtype=np.float32)
            for second in range(8):
                n = np.arange(rate // 4)
                signal[second*rate:second*rate+len(n)] = np.sin(n*2*np.pi*(300+second*70)/rate) * .1
            with wave.open(str(folder / 'voice.wav'), 'wb') as audio:
                audio.setparams((1, 2, rate, 0, 'NONE', 'not compressed'))
                audio.writeframes((signal*32767).astype('<i2').tobytes())
            target = folder / 'normalized.mp4'
            renderer.assemble({'output': str(target), 'width': 640, 'height': 360,
                'shots': [{'source': str(folder / 'picture.png'), 'kind': 'image', 'start': 0, 'end': 2} for _ in range(6)],
                'titles': [{'text': 'Keep the whole voice.', 'start': .1+index*.4, 'end': .4+index*.4,
                    'style': 'caption', 'position': 'bottom', 'animation': 'fade', 'color': '#d5e991'} for index in range(25)],
                'fonts': str(ROOT / 'public/fonts'), 'sourceVolume': 0, 'normalizeAudio': True,
                'audio': [{'source': str(folder / 'voice.wav'), 'start': .5, 'sourceStart': 0, 'sourceEnd': 8, 'volume': 1}],
                'manifest': {'format': 'aftertake-film/2', 'normalizeAudio': True}})
            with av.open(str(target)) as container:
                frames = list(container.decode(audio=0))
            for previous, current in zip(frames, frames[1:]):
                self.assertAlmostEqual(current.time, previous.time + previous.samples/previous.sample_rate, delta=1/48000)
            sound = np.concatenate([frame.to_ndarray() for frame in frames], axis=1)
            self.assertLess(np.abs(sound[:,:int(.45*48000)]).max(), .001)
            for second in range(8):
                start = round((second+.55)*48000); end = round((second+.7)*48000)
                self.assertGreater(float(np.sqrt(np.square(sound[:,start:end]).mean())), .04, f'Lost burst {second}')
            self.assertLess(np.abs(sound[:,int(8.9*48000):]).max(), .001)
            self.assertLess(abs(sound.shape[1]/48000-12), .025)

    def test_kinetic_motion_is_present_in_the_export_with_a_readable_hold(self):
        with tempfile.TemporaryDirectory(prefix='aftertake-kinetic-') as temporary:
            folder=Path(temporary);Image.new('RGB',(640,360),'#123456').save(folder/'blue.png')
            titles=[{'text':'Make it\nyours.','start':index*2.5+.1,'end':index*2.5+2.4,'style':'headline',
                'position':'center','animation':animation,'motionDuration':1,'fontSize':96,'color':'#ffffff'}
                for index,animation in enumerate(['build','typewriter','impact','wipe'])]
            target=folder/'kinetic.mp4'
            renderer.assemble({'output':str(target),'width':640,'height':360,
                'shots':[{'source':str(folder/'blue.png'),'kind':'image','start':0,'end':2.5} for _ in range(4)],
                'titles':titles,'audio':[],'sourceVolume':0,'fonts':str(ROOT/'public/fonts'),'manifest':{'titles':titles}})
            with av.open(str(target)) as container:
                frames=[frame.to_ndarray(format='rgb24') for frame in container.decode(video=0)]
                self.assertEqual(json.loads(container.metadata['comment'])['titles'],titles)
            self.assertEqual(len(frames),240)
            for index in range(4):
                early=frames[index*60+5];settled=frames[index*60+36]
                self.assertGreater(float(np.abs(early.astype(float)-settled).mean()),.5)
                self.assertGreater(int((settled.min(axis=2)>190).sum()),1500)
                self.assertLess(float(np.abs(frames[index*60].astype(float)-frames[0]).mean()),1)

    def test_kinetic_layer_keeps_its_motion_phase_when_a_cut_crosses_it(self):
        with tempfile.TemporaryDirectory(prefix='aftertake-kinetic-cut-') as temporary:
            folder=Path(temporary);Image.new('RGB',(640,360),'#123456').save(folder/'blue.png')
            title={'text':'Motion across cuts.','start':.13,'end':2.83,'style':'headline','position':'center',
                'animation':'build','motionDuration':1.6,'color':'#ffffff'}
            decoded=[]
            for label,lengths in [('whole',[3]),('cuts',[1,1,1])]:
                target=folder/f'{label}.mp4'
                renderer.assemble({'output':str(target),'width':640,'height':360,
                    'shots':[{'source':str(folder/'blue.png'),'kind':'image','start':0,'end':length} for length in lengths],
                    'titles':[title],'audio':[],'sourceVolume':0,'fonts':str(ROOT/'public/fonts'),'manifest':{}})
                with av.open(str(target)) as container:
                    decoded.append([frame.to_ndarray(format='rgb24') for frame in container.decode(video=0)])
            for frame in [23,24,25,47,48,49]:
                a,b=[pictures[frame].min(axis=2)>170 for pictures in decoded]
                self.assertGreater(float((a&b).sum()/max(1,(a|b).sum())),.96,f'Motion phase changed at frame {frame}')

    def test_real_frames_audio_timing_and_embedded_project(self):
        with tempfile.TemporaryDirectory(prefix='aftertake-film-render-') as temporary:
            folder = Path(temporary)
            Image.new('RGB', (640, 360), '#123456').save(folder / 'blue.png')
            Image.new('RGB', (640, 360), '#652314').save(folder / 'red.png')
            signal = (np.sin(np.arange(24000) * 2 * np.pi * 440 / 24000) * 8000).astype('<i2')
            with wave.open(str(folder / 'voice.wav'), 'wb') as audio:
                audio.setparams((1, 2, 24000, 0, 'NONE', 'not compressed'))
                audio.writeframes(signal.tobytes())
            title = {'text': 'Made here.\nVoice + type #1', 'start': .25, 'end': .875, 'style': 'headline',
                'position': 'center', 'animation': 'fade', 'color': '#d5e991'}
            manifest = {'format': 'aftertake-film/2', 'name': 'Type = picture; sound #1', 'titles': [title]}
            target = folder / 'result.mp4'
            renderer.assemble({'output': str(target), 'width': 640, 'height': 360,
                'shots': [{'source': str(folder / name), 'kind': 'image', 'start': 0, 'end': 1} for name in ['blue.png', 'red.png']],
                'titles': [title], 'fonts': str(ROOT / 'public/fonts'), 'sourceVolume': 0,
                'audio': [{'source': str(folder / 'voice.wav'), 'start': 1, 'sourceStart': 0, 'sourceEnd': 1, 'volume': .7}],
                'manifest': manifest})
            with av.open(str(target)) as container:
                self.assertEqual(json.loads(container.metadata['comment']), manifest)
                frames = [frame.to_ndarray(format='rgb24') for frame in container.decode(video=0)]
            self.assertEqual(len(frames), 48)
            # The title appears only within its interval; the second shot is red.
            self.assertGreater(np.abs(frames[13].astype(float)-frames[0]).mean(), 2.5)
            self.assertLess(np.abs(frames[23].astype(float)-frames[0]).mean(), 2)
            self.assertGreater(frames[30][:,:,0].mean(), frames[30][:,:,2].mean()+40)
            with av.open(str(target)) as container:
                sound = np.concatenate([frame.to_ndarray() for frame in container.decode(audio=0)], axis=1)
            self.assertLess(np.abs(sound[:,:40000]).max(), .001)
            self.assertGreater(np.abs(sound[:,60000:80000]).mean(), .03)
            # Mastering is an actual render option, and must retain the movie
            # length and audio layout while increasing this quiet test signal.
            normalized = folder / 'normalized.mp4'
            renderer.assemble({'output': str(normalized), 'width': 640, 'height': 360,
                'shots': [{'source': str(folder / 'blue.png'), 'kind': 'image', 'start': 0, 'end': 2}],
                'titles': [], 'fonts': str(ROOT / 'public/fonts'), 'sourceVolume': 0, 'normalizeAudio': True,
                'audio': [{'source': str(folder / 'voice.wav'), 'start': 1, 'sourceStart': 0, 'sourceEnd': 1, 'volume': .15}],
                'manifest': {**manifest, 'normalizeAudio': True}})
            with av.open(str(normalized)) as container:
                self.assertEqual(container.streams.audio[0].rate, 48000)
                mastered = np.concatenate([frame.to_ndarray() for frame in container.decode(audio=0)], axis=1)
            self.assertGreater(np.abs(mastered[:,60000:80000]).mean(), .04)
            self.assertLess(np.abs(mastered).max(), .9)
            with av.open(str(normalized)) as container:
                self.assertEqual(sum(1 for _ in container.decode(video=0)), 48)


    def test_matching_motion_remains_continuous_through_dissolves_and_hard_cuts(self):
        from fractions import Fraction
        with tempfile.TemporaryDirectory(prefix='aftertake-motion-joins-') as temporary:
            folder=Path(temporary);source=folder/'moving.mp4'
            with av.open(str(source),'w') as c:
                stream=c.add_stream('libx264',rate=24);stream.width=320;stream.height=180;stream.pix_fmt='yuv420p';stream.options={'crf':'0'}
                for i in range(90):
                    pixels=np.zeros((180,320,3),dtype=np.uint8);pixels[30:150,10+i:22+i,0]=240
                    f=av.VideoFrame.from_ndarray(pixels,format='rgb24');f.pts=i;f.time_base=Fraction(1,24)
                    for packet in stream.encode(f):c.mux(packet)
                for packet in stream.encode():c.mux(packet)
            target=folder/'joined.mp4'
            renderer.assemble({'output':str(target),'width':320,'height':180,
                'shots':[{'source':str(source),'start':a,'end':b,**({'dissolve':fade} if fade else {})}
                    for a,b,fade in [(0,1,0),(.75,1.75,.25),(1.75,2.75,0),(2.625,3.75,.125)]],
                'titles':[],'audio':[],'sourceVolume':0,'fonts':str(ROOT/'public/fonts'),'manifest':{}})
            with av.open(str(target)) as c:frames=list(c.decode(video=0))
            self.assertEqual(len(frames),90)
            xx=np.arange(320)[None,:]
            for i,f in enumerate(frames):
                p=f.to_ndarray(format='rgb24').astype('float32');weight=np.maximum(0,p[:,:,0]-np.maximum(p[:,:,1],p[:,:,2])-20)
                center=float((weight*xx).sum()/weight.sum())
                self.assertAlmostEqual(center,15.5+i,delta=.2,msg=f'Motion jumps or holds at frame {i}')

    def test_dissolves_preserve_frame_clock_narration_and_intervening_hard_cuts(self):
        with tempfile.TemporaryDirectory(prefix='aftertake-dissolve-') as temporary:
            folder=Path(temporary)
            for name,color in [('red','#e02020'),('blue','#2020e0'),('green','#20e020')]:
                Image.new('RGB',(320,180),color).save(folder/f'{name}.png')
            rate=24000
            signal=(np.sin(np.arange(rate)*2*np.pi*440/rate)*8000).astype('<i2')
            with wave.open(str(folder/'voice.wav'),'wb') as audio:
                audio.setparams((1,2,rate,0,'NONE','not compressed'));audio.writeframes(signal.tobytes())
            target=folder/'dissolve.mp4'
            shots=[{'source':str(folder/f'{name}.png'),'kind':'image','start':0,'end':1,
                **({'dissolve':.25} if name=='blue' else {})} for name in ['red','blue','green']]
            shots.append({'source':str(folder/'red.png'),'kind':'image','start':0,'end':1,'dissolve':.125})
            renderer.assemble({'output':str(target),'width':320,'height':180,'shots':shots,'titles':[],
                'fonts':str(ROOT/'public/fonts'),'sourceVolume':0,'audio':[{'source':str(folder/'voice.wav'),
                    'start':.75,'sourceStart':0,'sourceEnd':1,'volume':.7}], 'manifest':{'shots':shots}})
            with av.open(str(target)) as container:
                frames=list(container.decode(video=0))
                self.assertEqual(json.loads(container.metadata['comment'])['shots'],shots)
            self.assertEqual(len(frames),87)
            for index,frame in enumerate(frames):
                self.assertAlmostEqual(frame.time,index/24,places=6)
            colors=np.asarray([frame.to_ndarray(format='rgb24').mean(axis=(0,1)) for frame in frames])
            # Six actual blended frames replace the outgoing tail, with clean
            # endpoints and an ordinary cut into green at precisely 1.75s.
            self.assertGreater(colors[17,0]-colors[17,2],150)
            self.assertLess(abs(colors[21,0]-colors[21,2]),12)
            self.assertGreater(colors[24,2]-colors[24,0],150)
            self.assertGreater(colors[41,2]-colors[41,1],150)
            self.assertGreater(colors[42,1]-colors[42,2],150)
            self.assertGreater(colors[62,1]-colors[62,0],150)
            self.assertGreater(colors[66,0]-colors[66,1],150)
            with av.open(str(target)) as container:
                decoded=list(container.decode(audio=0))
            self.assertTrue(all(abs(b.time-a.time-a.samples/a.sample_rate)<1/48000 for a,b in zip(decoded,decoded[1:])))
            sound=np.concatenate([frame.to_ndarray() for frame in decoded],axis=1)
            self.assertLess(abs(sound[:,:int(.7*48000)]).max(),.001)
            self.assertGreater(abs(sound[:,int(.8*48000):int(1.7*48000)]).mean(),.03)
            self.assertLess(abs(sound[:,int(1.8*48000):]).max(),.001)


if __name__ == '__main__':
    unittest.main()
