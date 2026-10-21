from fractions import Fraction
import importlib.util
from pathlib import Path
import sys
import tempfile
import types
import unittest
import unittest.mock

import av
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
spec = importlib.util.spec_from_file_location('aftertake_protect', ROOT / 'scripts/protect-foreground.py')
protect = importlib.util.module_from_spec(spec)
spec.loader.exec_module(protect)
import depth_runtime  # noqa: E402

HEIGHT, WIDTH, FRAMES = 96, 128, 6
BACKGROUND, PERSON, CUP, NEW = (40, 60, 90), (200, 170, 150), (230, 30, 30), (30, 200, 60)


def scene():
    """A person with a red cup held in front of them, crossing the edge of their mask."""
    ys, xs = np.mgrid[:HEIGHT, :WIDTH]
    person = (abs(xs - 64) < 24) & (ys > 16)
    cup = (abs(xs - 92) < 9) & (abs(ys - 60) < 12)  # beside the person, inside the 32px margin
    source = np.empty((HEIGHT, WIDTH, 3), np.uint8)
    source[:] = BACKGROUND
    source[person] = PERSON
    source[cup] = CUP
    # The tracked mask excludes the cup, which is in front of the person.
    return source, person & ~cup, cup


def write(path, frames, pix_fmt='yuv420p'):
    with av.open(str(path), 'w') as container:
        stream = container.add_stream('ffv1' if pix_fmt == 'gray' else 'libx264', rate=24)
        stream.width, stream.height, stream.pix_fmt = WIDTH, HEIGHT, pix_fmt
        if pix_fmt != 'gray':
            stream.options = {'crf': '0'}
        for index, pixels in enumerate(frames):
            frame = av.VideoFrame.from_ndarray(pixels, format='gray' if pix_fmt == 'gray' else 'rgb24')
            frame.pts, frame.time_base = index, Fraction(1, 24)
            for packet in stream.encode(frame):
                container.mux(packet)
        for packet in stream.encode():
            container.mux(packet)


class FakeDepth:
    """Nearness read from the scene's colours: background far, person nearer, cup nearest."""
    label = 'test'

    def __call__(self, frame):
        red = (frame[..., 0] > 180) & (frame[..., 1] < 90)
        skin = (frame[..., 0] > 150) & (frame[..., 1] > 130)
        return np.where(red, 5.0, np.where(skin, 3.0, 1.0)).astype(np.float32)


class ProtectForegroundTest(unittest.TestCase):
    def run_protect(self, with_cup=True):
        folder = Path(self.enterContext(tempfile.TemporaryDirectory()))
        source, person, cup = scene()
        if not with_cup:
            source[cup] = BACKGROUND
        # The replacement redrew everything inside the person and its margin, cup included.
        region = protect.grown(person, protect.GROW)
        take = source.copy()
        take[region] = NEW
        write(folder / 'source.mp4', [source] * FRAMES)
        write(folder / 'take.mp4', [take] * FRAMES)
        write(folder / 'mask.mkv', [person.astype(np.uint8) * 255] * FRAMES, 'gray')
        job = {'source': folder / 'source.mp4', 'mask': folder / 'mask.mkv', 'take': folder / 'take.mp4',
               'output': folder / 'protected.mp4', 'margin': 0.1}
        result = protect.protect(job, depth=FakeDepth())
        output = list(protect.frames(folder / 'protected.mp4')) if result['changed'] else None
        # Compare with the decoded take: 4:2:0 chroma softens colour edges in both files.
        decoded = next(protect.frames(folder / 'take.mp4'))
        return result, output, source, decoded, person, cup

    def test_the_cup_comes_back_and_nothing_else_changes(self):
        result, output, source, take, person, cup = self.run_protect()
        self.assertTrue(result['changed'])
        self.assertEqual(result['frames'], FRAMES)
        self.assertEqual(result['protectedFrames'], FRAMES)
        self.assertEqual(result['accelerator'], 'test')
        frame = output[2].astype(int)
        inner = cup & ~protect.grown(~cup, 4)  # 4:2:0 chroma softens the edge rows
        self.assertLess(np.abs(frame[inner] - CUP).max(), 12)
        # The new character and the redrawn background beside it are kept.
        far = ~protect.grown(cup, protect.FEATHER + 2)
        self.assertLess(np.abs(frame[far] - take[far].astype(int)).max(), 12)

    def test_a_shot_with_nothing_in_front_is_left_alone(self):
        result, output, *_ = self.run_protect(with_cup=False)
        self.assertEqual(result, {'changed': False})
        self.assertIsNone(output)

    def test_the_margin_is_checked(self):
        with self.assertRaisesRegex(ValueError, 'margin'):
            protect.protect({'margin': 0.9, 'take': 'unused'}, depth=FakeDepth())


class DepthRuntimeTest(unittest.TestCase):
    def fake_ort(self, available, broken=()):
        made = []

        class Session:
            def __init__(self, model, providers):
                name = providers[0][0]
                if name in broken:
                    raise RuntimeError(f'{name} failed')
                made.append(providers)
                self.providers = [name]

            def get_providers(self):
                return self.providers

            def get_inputs(self):
                return [types.SimpleNamespace(name='pixel_values')]

            def run(self, _, feeds):
                pixels = feeds['pixel_values']
                return [np.ones((1, pixels.shape[2], pixels.shape[3]), np.float32)]

        return types.SimpleNamespace(get_available_providers=lambda: available, InferenceSession=Session), made

    def test_the_best_accelerator_is_used_and_a_broken_one_falls_back(self):
        ort, made = self.fake_ort(['OpenVINOExecutionProvider', 'CPUExecutionProvider'])
        depth = depth_runtime.Depth(1280, 720, ort=ort, model=Path('model.onnx'))
        self.assertEqual(depth.provider, 'openvino')
        self.assertEqual(depth.size, (644, 364))
        self.assertEqual(made[0][0][1]['reshape_input'], 'pixel_values[1,3,364,644]')
        self.assertEqual(made[0][1][0], 'CPUExecutionProvider')
        self.assertEqual(depth(np.zeros((720, 1280, 3), np.uint8)).shape, (720, 1280))
        ort, made = self.fake_ort(['CoreMLExecutionProvider', 'CPUExecutionProvider'], broken={'CoreMLExecutionProvider'})
        depth = depth_runtime.Depth(640, 480, ort=ort, model=Path('model.onnx'))
        self.assertEqual(depth.label, 'CPU')

    def test_the_choice_can_be_forced_and_is_validated(self):
        ort, _ = self.fake_ort(['DmlExecutionProvider', 'CPUExecutionProvider'])
        with unittest.mock.patch.dict('os.environ', {'AFTERTAKE_DEPTH_PROVIDER': 'cpu'}):
            self.assertEqual(depth_runtime.Depth(640, 360, ort=ort, model=Path('m')).provider, 'cpu')
        with unittest.mock.patch.dict('os.environ', {'AFTERTAKE_DEPTH_PROVIDER': 'tpu'}):
            with self.assertRaisesRegex(ValueError, 'AFTERTAKE_DEPTH_PROVIDER'):
                depth_runtime.Depth(640, 360, ort=ort, model=Path('m'))


class SetupDepthTest(unittest.TestCase):
    def test_each_computer_gets_its_own_accelerator(self):
        spec = importlib.util.spec_from_file_location('aftertake_setup_depth', ROOT / 'scripts/setup-depth.py')
        setup = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(setup)
        cases = [
            (('Darwin', 'arm64', 'Apple M3', (3, 12)), 'coreml'),
            (('Darwin', 'x86_64', 'Intel Core i9', (3, 12)), None),
            (('Windows', 'AMD64', 'Intel(R) Core(TM) Ultra 9 285K', (3, 12)), 'openvino'),
            (('Windows', 'AMD64', 'Intel(R) Core(TM) Ultra 9 285K', (3, 14)), 'directml'),
            (('Windows', 'AMD64', 'AMD Ryzen 9 7950X', (3, 12)), 'directml'),
            (('Windows', 'ARM64', 'Snapdragon X Elite', (3, 12)), 'qnn'),
            (('Linux', 'x86_64', 'Intel(R) Core(TM) Ultra 7 155H', (3, 13)), 'openvino'),
            (('Linux', 'x86_64', 'AMD EPYC', (3, 12)), 'cpu'),
            (('Linux', 'aarch64', 'Neoverse', (3, 12)), 'cpu'),
        ]
        for (system, machine, cpu, version), expected in cases:
            self.assertEqual(setup.automatic(system, machine, cpu, version), expected, (system, cpu))
        self.assertEqual(set(setup.PACKAGES), set(depth_runtime.PROVIDERS))

    def test_the_published_manifest_matches_the_pinned_model(self):
        import json
        manifest = json.loads((ROOT / 'docs/models-foreground-depth.json').read_text())[0]
        for key in ('repository', 'revision', 'path', 'size', 'sha256'):
            self.assertEqual(manifest[key], depth_runtime.MODEL[key], key)
        self.assertEqual(manifest['license'], depth_runtime.MODEL['license'].lower())


if __name__ == '__main__':
    unittest.main()
