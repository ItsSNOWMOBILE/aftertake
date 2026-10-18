import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import av
import numpy as np
import imageio_ffmpeg
import torch
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('aftertake_media', ROOT / 'custom_nodes/aftertake/__init__.py')
nodes = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = nodes
spec.loader.exec_module(nodes)
film_spec = importlib.util.spec_from_file_location('aftertake_film_assembler', ROOT / 'scripts/assemble-film.py')
film_assembler = importlib.util.module_from_spec(film_spec)
film_spec.loader.exec_module(film_assembler)


class MediaTests(unittest.TestCase):
    def test_exported_start_frame_matches_trimmed_render_including_the_final_display_interval(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            source, target = directory / 'timed.mp4', directory / 'frame.png'
            with av.open(str(source), 'w') as container:
                stream = container.add_stream('libx264', rate=8)
                stream.width, stream.height, stream.pix_fmt = 128, 96, 'yuv420p'
                for index in range(12):
                    image = Image.new('RGB', (128, 96), ['red', 'green', 'blue'][index // 4])
                    for packet in stream.encode(av.VideoFrame.from_image(image)): container.mux(packet)
                for packet in stream.encode(): container.mux(packet)
            for seconds in [0, .55, 1.05, 1.46]:
                with self.subTest(seconds=seconds):
                    subprocess.run([sys.executable, str(ROOT / 'scripts/extract-frame.py'), str(source), str(target), str(seconds)], check=True, capture_output=True)
                    with Image.open(target) as exported:
                        actual = nodes.decode_clip(source, 128, 96, 1, 16, seconds)[0].numpy()
                        self.assertLess(float(np.abs(actual * 255 - np.asarray(exported).astype(float)).mean()), .01)
            with self.assertRaises(ValueError): nodes.decode_clip(source, 128, 96, 1, 16, 1.7)

    def test_film_cuts_mix_frame_rates_aspect_ratios_audio_and_silence(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            first, second, result = [directory / name for name in ['red.mp4', 'blue.mp4', 'film.mp4']]
            binary = imageio_ffmpeg.get_ffmpeg_exe()
            subprocess.run([binary, '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=128x96:r=16:d=3.0625',
                '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=3.0625',
                '-c:v', 'libx264', '-c:a', 'aac', str(first)], check=True, capture_output=True)
            subprocess.run([binary, '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=96x128:r=24:d=4.04166667',
                '-c:v', 'libx264', str(second)], check=True, capture_output=True)
            manifest = {'format': 'aftertake-film/1', 'name': 'A cut with sound', 'largeWorkflowFixture': 'track\\#;=\n' * 10000}
            film_assembler.assemble({'width': 320, 'height': 180, 'output': str(result), 'manifest': manifest,
                'shots': [{'source': str(first), 'start': 0, 'end': 73 / 24}, {'source': str(second), 'start': 0, 'end': 97 / 24},
                          {'source': str(first), 'start': .5, 'end': 1.5}]})
            with av.open(str(result)) as container:
                self.assertEqual(json.loads(container.metadata['comment']), manifest)
                video = container.streams.video[0]
                self.assertEqual((video.width, video.height), (320, 180))
                frames = list(container.decode(video=0))
                self.assertEqual(len(frames), 194)
                # Cut boundaries are frame-exact, including 16-to-24 fps conversion.
                for index, color in [(0, 0), (72, 0), (73, 2), (169, 2), (170, 0), (193, 0)]:
                    pixel = frames[index].to_ndarray(format='rgb24')[90, 160]
                    self.assertGreater(pixel[color], 230)
                self.assertAlmostEqual(float(video.duration * video.time_base), 194 / 24, delta=.001)
            with av.open(str(result)) as container:
                audio = container.streams.audio[0]
                samples = np.concatenate([f.to_ndarray().mean(axis=0) for f in container.decode(audio=0)])
                def power(start, end): return float(np.square(samples[int(start * audio.rate):int(end * audio.rate)]).mean())
                self.assertGreater(power(.2, .8), .002)
                self.assertLess(power(3.2, 6.8), .000001)
                self.assertGreater(power(7.3, 7.9), .002)
                self.assertAlmostEqual(float(audio.duration * audio.time_base), 194 / 24, delta=.03)

    def test_all_eight_video_orientations_match_browser_style_autorotation(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            for degrees, horizontal, vertical in [(0, False, False), (90, False, False), (180, False, False),
                    (270, False, False), (0, True, False), (0, False, True), (90, True, False), (90, False, True)]:
                with self.subTest(degrees=degrees, horizontal=horizontal, vertical=vertical):
                    source, expected, thumbnail = [directory / name for name in ['phone.mp4', 'expected.png', 'thumb.jpg']]
                    with av.open(str(source), 'w') as container:
                        stream = container.add_stream('libx264', rate=24)
                        stream.width, stream.height, stream.pix_fmt = 128, 96, 'yuv420p'
                        stream.set_display_rotation(degrees, hflip=horizontal, vflip=vertical)
                        image = Image.new('RGB', (128, 96), 'red')
                        image.paste('green', (64, 0, 128, 48))
                        image.paste('blue', (0, 48, 64, 96))
                        image.paste('yellow', (64, 48, 128, 96))
                        for _ in range(24):
                            for packet in stream.encode(av.VideoFrame.from_image(image)): container.mux(packet)
                        for packet in stream.encode(): container.mux(packet)
                    subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-v', 'error', '-y', '-i', str(source),
                        '-frames:v', '1', str(expected)], check=True, capture_output=True)
                    reference = Image.open(expected).convert('RGB')
                    meta = json.loads(subprocess.run([sys.executable, str(ROOT / 'scripts/probe.py'), str(source)],
                        check=True, capture_output=True, text=True).stdout)
                    self.assertEqual((meta['width'], meta['height']), reference.size)
                    self.assertFalse(meta['hasAudio'])
                    frames = nodes.decode_clip(source, reference.width, reference.height, 1, 24, 0)
                    self.assertLess(float(np.abs(frames[0].numpy() * 255 - np.asarray(reference).astype(float)).mean()), 1)
                    subprocess.run([sys.executable, str(ROOT / 'scripts/thumbnail.py'), str(source), str(thumbnail), '0'],
                        check=True, capture_output=True)
                    with Image.open(thumbnail) as preview:
                        self.assertEqual(preview.size, reference.size)
                        self.assertLess(float(np.abs(np.asarray(preview).astype(float) - np.asarray(reference).astype(float)).mean()), 4)
                    exported = directory / 'full-frame.png'
                    subprocess.run([sys.executable, str(ROOT / 'scripts/extract-frame.py'), str(source), str(exported), '.25'],
                        check=True, capture_output=True)
                    with Image.open(exported) as image:
                        self.assertEqual(image.size, reference.size)
                        self.assertLess(float(np.abs(np.asarray(image).astype(float) - np.asarray(reference).astype(float)).mean()), 1)
                        self.assertFalse(image.getexif())

    def test_audio_trim_preserves_video_pixels_metadata_and_full_duration(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            source, result, silent = [directory / name for name in ['source.mp4', 'result.mp4', 'silent.mp4']]
            binary = imageio_ffmpeg.get_ffmpeg_exe()
            subprocess.run([binary, '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=128x96:r=24:d=4',
                '-f', 'lavfi', '-i', 'aevalsrc=sin(2*PI*if(lt(t\\,2)\\,440\\,880)*t):s=48000:d=4',
                '-c:v', 'libx264', '-c:a', 'aac', str(source)], check=True, capture_output=True)
            subprocess.run([binary, '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=128x96:r=12:d=0.75',
                '-metadata', 'comment=aftertake audio fixture', '-c:v', 'libx264', str(result)], check=True, capture_output=True)
            silent.write_bytes(result.read_bytes())
            with av.open(str(result)) as container:
                before = [frame.to_ndarray(format='rgb24') for frame in container.decode(video=0)]
            self.assertTrue(nodes.mux_source_audio(result, source, 1.8, .75))
            with av.open(str(result)) as container:
                self.assertEqual(container.metadata['comment'], 'aftertake audio fixture')
                after = [frame.to_ndarray(format='rgb24') for frame in container.decode(video=0)]
            self.assertEqual(len(after), 9)
            self.assertTrue(all(np.array_equal(a, b) for a, b in zip(before, after)))
            with av.open(str(result)) as container:
                track = container.streams.audio[0]
                self.assertAlmostEqual(float(track.duration * track.time_base), .75, delta=.03)
                audio = np.concatenate([f.to_ndarray().mean(axis=0) for f in container.decode(audio=0)])
                rate = track.rate
            def peak(start, end):
                segment = audio[int(start * rate):int(end * rate)]
                power = np.abs(np.fft.rfft(segment * np.hanning(len(segment))))
                return np.fft.rfftfreq(len(segment), 1 / rate)[power.argmax()]
            self.assertAlmostEqual(peak(.02, .16), 440, delta=12)
            self.assertAlmostEqual(peak(.35, .65), 880, delta=12)
            # A track ending before the generated shot does not truncate its picture.
            self.assertTrue(nodes.mux_source_audio(result, source, 3.8, .75))
            with av.open(str(result)) as container:
                self.assertEqual(len(list(container.decode(video=0))), 9)
            unchanged = silent.read_bytes()
            self.assertFalse(nodes.mux_source_audio(silent, silent, 0, .75))
            self.assertEqual(silent.read_bytes(), unchanged)

    def test_generated_audio_preserves_video_pixels_metadata_channels_and_full_duration(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            result = directory / 'generated.mp4'
            subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-v', 'error', '-y', '-f', 'lavfi',
                '-i', 'testsrc2=s=128x96:r=24:d=0.75', '-metadata', 'comment=generated audio fixture',
                '-c:v', 'libx264', str(result)], check=True, capture_output=True)
            with av.open(str(result)) as container:
                before = [f.to_ndarray(format='rgb24') for f in container.decode(video=0)]
            rate = 24000
            time = np.arange(int(rate * .3)) / rate
            waveform = np.stack([.2 * np.sin(2 * np.pi * frequency * time) for frequency in (440, 660)])[None].astype(np.float32)
            nodes.mux_generated_audio(result, {'waveform': waveform, 'sample_rate': rate}, .75)
            with av.open(str(result)) as container:
                self.assertEqual(container.metadata['comment'], 'generated audio fixture')
                after = [f.to_ndarray(format='rgb24') for f in container.decode(video=0)]
            self.assertEqual(len(after), 18)
            self.assertTrue(all(np.array_equal(a, b) for a, b in zip(before, after)))
            with av.open(str(result)) as container:
                track = container.streams.audio[0]
                self.assertAlmostEqual(float(track.duration * track.time_base), .75, delta=.01)
                audio = np.concatenate([f.to_ndarray() for f in container.decode(audio=0)], axis=1)
                self.assertEqual(audio.shape[0], 2)
                for channel, frequency in enumerate((440, 660)):
                    segment = audio[channel, int(rate * .03):int(rate * .25)]
                    power = np.abs(np.fft.rfft(segment * np.hanning(len(segment))))
                    actual = np.fft.rfftfreq(len(segment), 1 / rate)[power.argmax()]
                    self.assertAlmostEqual(actual, frequency, delta=8)
                self.assertLess(float(np.square(audio[:, int(rate * .4):int(rate * .7)]).mean()), 1e-6)
            stable = result.read_bytes()
            for invalid in [np.full((1, 2, 100), np.nan), np.zeros((2, 2, 100)), np.zeros((1, 3, 100))]:
                with self.assertRaisesRegex(ValueError, 'finite mono/stereo'):
                    nodes.mux_generated_audio(result, {'waveform': invalid, 'sample_rate': rate}, .75)
                self.assertEqual(result.read_bytes(), stable)
            self.assertFalse(list(directory.glob('aftertake-generated-audio-*')))

    def test_color_grade_is_temporally_consistent_and_preserves_the_untouched_mode(self):
        frame = torch.rand(1, 12, 16, 3)
        frames = frame.expand(4, -1, -1, -1)
        grade = nodes.AftertakeFilmGrade()
        self.assertIs(grade.execute(frames, 'source')[0], frames)
        mono = grade.execute(frames, 'monochrome')[0]
        self.assertTrue(torch.equal(mono[..., 0], mono[..., 1]))
        self.assertTrue(torch.equal(mono[..., 1], mono[..., 2]))
        self.assertTrue(torch.equal(mono[0], mono[3]))
        for palette in ['warm', 'cool']:
            result = grade.execute(frames, palette)[0]
            self.assertFalse(torch.equal(result, frames))
            self.assertTrue(torch.equal(result[0], result[3]))
            self.assertGreaterEqual(float(result.min()), 0)
            self.assertLessEqual(float(result.max()), 1)
        with self.assertRaises(ValueError):
            grade.execute(frames, 'unknown')

    def test_oriented_photo_conditions_the_same_frame_as_the_preview(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            photo, normalized, thumbnail = [directory / name for name in ['portrait.jpg', 'normalized.png', 'thumbnail.jpg']]
            image = Image.new('RGB', (96, 128), (30, 80, 160))
            image.paste((220, 70, 25), (0, 0, 48, 128))
            exif = Image.Exif()
            exif[274] = 6
            exif[270] = 'Metadata fixture; do not carry this into the normalized reference'
            image.save(photo, quality=98, exif=exif)
            imported = subprocess.run([sys.executable, str(ROOT / 'scripts/import-image.py'), str(photo), str(normalized)], check=True, capture_output=True, text=True)
            meta = json.loads(imported.stdout)
            self.assertEqual((meta['width'], meta['height']), (128, 96))
            self.assertEqual(meta['kind'], 'image')
            with Image.open(normalized) as cleaned:
                self.assertFalse(cleaned.getexif())
            normalized_again = directory / 'again.png'
            subprocess.run([sys.executable, str(ROOT / 'scripts/import-image.py'), str(normalized), str(normalized_again)], check=True, capture_output=True)
            self.assertEqual(normalized.read_bytes(), normalized_again.read_bytes())
            decoded = nodes.decode_clip(normalized, 128, 96, 1, 16, 0)
            self.assertEqual(tuple(decoded.shape), (1, 96, 128, 3))
            # Rotation moves the red half to the top, blue half to the bottom.
            self.assertGreater(decoded[0, 10, 64, 0], .8)
            self.assertGreater(decoded[0, 80, 64, 2], .5)
            subprocess.run([sys.executable, str(ROOT / 'scripts/thumbnail.py'), str(normalized), str(thumbnail), '0'], check=True, capture_output=True)
            with Image.open(thumbnail) as preview:
                self.assertGreater(preview.getpixel((64, 10))[0], 200)
                self.assertGreater(preview.getpixel((64, 80))[2], 125)

    def test_photo_import_rejects_unsupported_geometry_and_corrupt_data(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            source, target = directory / 'tiny.png', directory / 'normalized.png'
            Image.new('RGB', (32, 32)).save(source)
            command = [sys.executable, str(ROOT / 'scripts/import-image.py'), str(source), str(target)]
            self.assertNotEqual(subprocess.run(command, capture_output=True).returncode, 0)
            self.assertFalse(target.exists())
            source.write_bytes(b'not an image')
            self.assertNotEqual(subprocess.run(command, capture_output=True).returncode, 0)
            self.assertFalse(target.exists())


if __name__ == '__main__':
    unittest.main()
