import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import torch
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('aftertake_media', ROOT / 'custom_nodes/aftertake/__init__.py')
nodes = importlib.util.module_from_spec(spec)
spec.loader.exec_module(nodes)


class MediaTests(unittest.TestCase):
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
            image.save(photo, quality=98, exif=exif)
            imported = subprocess.run([sys.executable, str(ROOT / 'scripts/import-image.py'), str(photo), str(normalized)], check=True, capture_output=True, text=True)
            meta = json.loads(imported.stdout)
            self.assertEqual((meta['width'], meta['height']), (128, 96))
            self.assertEqual(meta['kind'], 'image')
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
