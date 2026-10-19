"""Offline deployment-inventory checks; no installed engine, models or network required."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('cloud_profile_tests', ROOT / 'scripts/prepare-cloud-profile.py')
profile = importlib.util.module_from_spec(spec)
spec.loader.exec_module(profile)


class CloudProfileTests(unittest.TestCase):
    def fixture(self, root):
        for name in profile.REQUIRED_SOURCES:
            target = root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / name, target)

    def test_inventory_binds_current_pins_models_nodes_and_exact_code_bytes(self):
        with tempfile.TemporaryDirectory(prefix='aftertake-cloud-inventory-') as directory:
            root = Path(directory)
            self.fixture(root)
            # No runtime, account, private data or model directory is needed.
            (root / '.env').write_text('COMFY_API_KEY=private-key-must-not-appear')
            (root / 'personal-photo.png').write_bytes(b'private photo not inspected')
            result = profile.prepare_inventory(root)
            self.assertEqual(result['format'], 'aftertake-cloud-profile-inventory/1')
            self.assertEqual(result['runtime']['python'], '3.12')
            self.assertEqual(len(result['repositories']), 4)
            self.assertTrue(all(len(item['revision']) == 40 for item in result['repositories']))
            manifest = json.loads((root / 'docs/models-character-swap.json').read_text())
            self.assertEqual({item['expectedSha256'] for item in result['models']}, {item['sha256'] for item in manifest})
            self.assertEqual(result['modelBytesExpected'], sum(item['size'] for item in manifest))
            self.assertEqual({item['filename'] for item in result['workflowContract']['modelMenus']}, {Path(item['path']).name for item in manifest})
            self.assertIn('ImageCompositeMasked', result['workflowContract']['requiredNodes'])
            self.assertIn('AftertakeLoadClip', result['workflowContract']['requiredNodes'])
            self.assertIn('AftertakeSaveVideo', result['workflowContract']['requiredNodes'])
            for item in result['sourceFiles']:
                self.assertEqual(item['sha256'], hashlib.sha256((root / item['path']).read_bytes()).hexdigest())
            self.assertEqual(len(result['customNodeFiles']), 5)
            self.assertTrue(result['validation']['sourceFilesComplete'])
            self.assertFalse(result['validation']['modelContentHashesVerified'])
            self.assertFalse(result['deployment']['ready'])
            self.assertFalse(result['deployment']['linuxValidated'])
            self.assertEqual(result['deployment']['actionsPerformed'], [])
            encoded = json.dumps(result)
            for private in (directory, 'private-key-must-not-appear', 'personal-photo.png'):
                self.assertNotIn(private, encoded)

    def test_missing_code_and_model_presence_are_honest_without_reading_large_models(self):
        with tempfile.TemporaryDirectory(prefix='aftertake-cloud-inventory-') as directory:
            root = Path(directory)
            self.fixture(root)
            (root / 'custom_nodes/aftertake/media_utils.py').unlink()
            models = root / 'optional-model-disk'
            models.mkdir()
            manifest_path = root / 'docs/models-character-swap.json'
            manifest = json.loads(manifest_path.read_text())
            first = manifest[0]
            first['size'] = 12
            manifest_path.write_text(json.dumps(manifest))
            target = models / first['category'] / Path(first['path']).name
            target.parent.mkdir(parents=True)
            target.write_bytes(b'not a model!')
            original = Path.read_bytes
            def read_small_sources(path):
                if path.is_relative_to(models):
                    self.fail('The inventory must not read or hash model contents.')
                return original(path)
            with patch.object(Path, 'read_bytes', read_small_sources):
                result = profile.prepare_inventory(root, models)
            self.assertFalse(result['validation']['sourceFilesComplete'])
            self.assertIn('custom_nodes/aftertake/media_utils.py', result['validation']['missingSourceFiles'])
            self.assertEqual(result['models'][0]['local'], {'state': 'present-unhashed', 'size': 12, 'sha256': None})
            self.assertTrue(all(item['local']['state'] == 'missing' for item in result['models'][1:]))
            self.assertNotIn(str(models), json.dumps(result))
            target.write_bytes(b'wrong size')
            self.assertEqual(profile.prepare_inventory(root, models)['models'][0]['local']['state'], 'size-mismatch')

    def test_unpinned_corrupt_or_path_escaping_manifests_are_rejected(self):
        manifest = json.loads((ROOT / 'docs/models-character-swap.json').read_text())
        for field, value in [('revision', 'main'), ('sha256', 'unknown'), ('path', '../private.png'), ('path', 'C:/private/model'), ('category', '../escape'), ('size', -1), ('repository', 'https://key@example.test')]:
            bad = copy.deepcopy(manifest)
            bad[0][field] = value
            with self.subTest(field=field, value=value), self.assertRaises(profile.InventoryError):
                profile.model_inventory(bad, None)
        with self.assertRaisesRegex(profile.InventoryError, 'Duplicate'):
            profile.model_inventory([manifest[0], manifest[0]], None)

    def test_mismatched_profile_and_missing_or_dynamic_pins_fail_before_export(self):
        with tempfile.TemporaryDirectory(prefix='aftertake-cloud-inventory-') as directory:
            root = Path(directory)
            self.fixture(root)
            target = root / 'server/character-profile.ts'
            target.write_text(target.read_text().replace('h3_character_swap_v1.5.safetensors', 'unlisted.safetensors'))
            with self.assertRaisesRegex(profile.InventoryError, 'disagree'):
                profile.prepare_inventory(root)
            (root / 'docs/models-character-swap.json').unlink()
            with self.assertRaisesRegex(profile.InventoryError, 'Missing inventory source: docs/models-character-swap.json'):
                profile.prepare_inventory(root)
        with self.assertRaises(profile.InventoryError):
            profile.setup_pins('REPOS = dynamic_repositories()')

    def test_paths_cannot_follow_symlinks_outside_the_package(self):
        with tempfile.TemporaryDirectory(prefix='aftertake-cloud-inventory-') as directory:
            root = Path(directory)
            outside = root / 'outside'
            package = root / 'package'
            outside.mkdir()
            package.mkdir()
            link = package / 'linked'
            try:
                link.symlink_to(outside, target_is_directory=True)
            except OSError:
                self.skipTest('Symlink creation unavailable on this host.')
            with self.assertRaisesRegex(profile.InventoryError, 'escapes'):
                profile.source_file(package, 'linked/private.py')


if __name__ == '__main__':
    unittest.main()
