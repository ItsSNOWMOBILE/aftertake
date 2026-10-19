"""CPU checks for phone-photo normalization and bounded image decoding."""
import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import MagicMock, patch

from PIL import Image, ImageOps


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('image_import_tests', ROOT / 'scripts/import-image.py')
image_import = importlib.util.module_from_spec(spec)
spec.loader.exec_module(image_import)


class ImageImportTests(unittest.TestCase):
    def test_eleven_megapixel_phone_photo_is_downscaled_without_changing_its_original(self):
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / 'phone.jpg'
            output = Path(temporary) / 'normalized.png'
            photo = Image.new('RGB', (2880, 3840), (20, 80, 160))
            photo.paste((220, 70, 25), (0, 0, 1440, 3840))
            photo.save(source, quality=95)
            before = hashlib.sha256(source.read_bytes()).hexdigest()
            metadata = image_import.normalize(source, output)
            self.assertEqual(metadata, {'width': 2160, 'height': 2880, 'duration': 1, 'kind': 'image'})
            self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(), before)
            with Image.open(output) as normalized:
                self.assertEqual(normalized.mode, 'RGB')
                self.assertFalse(normalized.getexif())
                self.assertGreater(normalized.getpixel((100, 1400))[0], 200)
                self.assertGreater(normalized.getpixel((2000, 1400))[2], 140)
                self.assertEqual(normalized.width / normalized.height, 2880 / 3840)
            repeated = Path(temporary) / 'again.png'
            image_import.normalize(output, repeated)
            self.assertEqual(output.read_bytes(), repeated.read_bytes())

    def test_exif_rotation_happens_before_fitting_the_phone_photo(self):
        with tempfile.TemporaryDirectory() as temporary:
            source, output = [Path(temporary) / name for name in ['rotated.jpg', 'normalized.png']]
            photo = Image.new('RGB', (2880, 3840), (20, 80, 160))
            photo.paste((220, 70, 25), (0, 0, 1440, 3840))
            exif = Image.Exif()
            exif[274] = 6
            exif[270] = 'Do not carry private photo metadata into conditioning.'
            photo.save(source, quality=95, exif=exif)
            metadata = image_import.normalize(source, output)
            self.assertEqual((metadata['width'], metadata['height']), (2880, 2160))
            with Image.open(output) as normalized:
                self.assertGreater(normalized.getpixel((1400, 100))[0], 200)
                self.assertGreater(normalized.getpixel((1400, 2000))[2], 140)
                self.assertFalse(normalized.getexif())

    def test_existing_small_normalization_is_byte_compatible_and_never_upscaled(self):
        with tempfile.TemporaryDirectory() as temporary:
            source, expected, output = [Path(temporary) / name for name in ['small.jpg', 'old.png', 'new.png']]
            exif = Image.Exif()
            exif[274] = 6
            Image.new('RGB', (64, 128), (35, 90, 150)).save(source, exif=exif)
            # The established normalization path, before phone-photo resizing.
            with Image.open(source) as original:
                image = ImageOps.exif_transpose(original).convert('RGB')
                image.load()
                image.info.clear()
                image.save(expected, format='PNG')
            self.assertEqual(image_import.normalize(source, output)['width'], 128)
            self.assertEqual(output.read_bytes(), expected.read_bytes())

    def test_oversized_headers_are_rejected_before_pixel_decode(self):
        for size in [(8001, 8000), (16385, 64), (63, 1000)]:
            with self.subTest(size=size):
                header = MagicMock(width=size[0], height=size[1], size=size)
                header.__enter__.return_value = header
                with patch.object(image_import.Image, 'open', return_value=header), \
                        patch.object(image_import.ImageOps, 'exif_transpose') as decode:
                    with self.assertRaisesRegex(ValueError, '64 megapixels'):
                        image_import.normalize('header-only.png', 'must-not-be-written.png')
                    decode.assert_not_called()

    def test_corrupt_and_extreme_photos_do_not_produce_an_output(self):
        with tempfile.TemporaryDirectory() as temporary:
            source, output = [Path(temporary) / name for name in ['source.png', 'normalized.png']]
            source.write_bytes(b'not an image')
            with self.assertRaises(Exception):
                image_import.normalize(source, output)
            self.assertFalse(output.exists())
            Image.new('RGB', (16384, 64)).save(source)
            with self.assertRaisesRegex(ValueError, 'aspect ratio'):
                image_import.normalize(source, output)
            self.assertFalse(output.exists())


if __name__ == '__main__':
    unittest.main()
