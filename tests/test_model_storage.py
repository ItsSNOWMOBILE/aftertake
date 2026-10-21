"""CPU-only external-model discovery contracts; no engine or model execution."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('aftertake_model_storage_tests', ROOT / 'scripts/model_storage.py')
storage = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(storage)


class ExternalModelPathsTests(unittest.TestCase):
    def test_external_disk_exposes_every_native_enhance_model_category(self):
        required = set()
        for manifest in ('models-upscale.json', 'models-interpolation.json', 'models-song.json'):
            entries = json.loads((ROOT / 'docs' / manifest).read_text(encoding='utf-8'))
            required.update(entry['category'] for entry in entries)
        self.assertIn('frame_interpolation', required)
        with tempfile.TemporaryDirectory(prefix='aftertake-model-paths-') as directory:
            root = Path(directory)
            models = root / 'separate model disk'
            rife = models / 'frame_interpolation/rife_v4.26.safetensors'
            rife.parent.mkdir(parents=True)
            rife.write_bytes(b'fixture-model-left-untouched')
            with patch.object(storage, 'ROOT', root):
                config = storage.extra_model_config(models)
            mapping = json.loads(config.read_text(encoding='utf-8'))['aftertake']
            self.assertEqual(mapping['base_path'], str(models))
            for category in required:
                self.assertEqual(mapping.get(category), category, f'Expose {category} to native Comfy loaders.')
            self.assertEqual(rife.read_bytes(), b'fixture-model-left-untouched')
            self.assertFalse((root / '.runtime/ComfyUI/models').exists())


if __name__ == '__main__':
    unittest.main()
