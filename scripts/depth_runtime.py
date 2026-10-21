"""Depth Anything V2 Small through ONNX Runtime, on the best accelerator this computer has.

The order is Core ML (Apple Neural Engine and GPU), QNN (Snapdragon NPU), OpenVINO
(Intel NPU), DirectML (any DirectX 12 GPU), then the CPU. Only the ONNX Runtime
package that scripts/setup-depth.py installed is present, so in practice the
order picks that package's accelerator and keeps the CPU as the fallback. Set
AFTERTAKE_DEPTH_PROVIDER to coreml, qnn, openvino, directml or cpu to choose.

    python scripts/depth_runtime.py --status   prints what is installed, as JSON
"""
from pathlib import Path
import hashlib
import json
import os
import sys

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
MODEL = {
    'name': 'Depth Anything V2 Small',
    'repository': 'onnx-community/depth-anything-v2-small',
    'revision': '4472b7362082ad9968fee890ca0f1e5aca36b93d',
    'path': 'onnx/model.onnx',
    'sha256': 'afb6a5c28f3b6bf1618c6e43f02073ef9dfdc70e937502d51603e57b0a1df10c',
    'size': 99060839,
    'license': 'Apache-2.0',
}
MODEL_PATH = ROOT / '.runtime/models/depth-anything-v2-small.onnx'
# Depth only has to order objects, so a modest input keeps NPUs and CPUs quick.
SHORT_SIDE = 364
MEAN, STD = np.array([0.485, 0.456, 0.406], np.float32), np.array([0.229, 0.224, 0.225], np.float32)
PROVIDERS = {
    'coreml': ('CoreMLExecutionProvider', 'Apple Neural Engine (Core ML)'),
    'qnn': ('QNNExecutionProvider', 'Qualcomm NPU (QNN)'),
    'openvino': ('OpenVINOExecutionProvider', 'Intel NPU (OpenVINO)'),
    'directml': ('DmlExecutionProvider', 'GPU (DirectML)'),
    'cpu': ('CPUExecutionProvider', 'CPU'),
}


def input_size(width, height):
    """The model input for a frame: the short side at SHORT_SIDE, both sides multiples of 14."""
    scale = SHORT_SIDE / min(width, height)
    return max(14, round(width * scale / 14) * 14), max(14, round(height * scale / 14) * 14)


def provider_options(key, width, height):
    if key == 'coreml':
        return {'MLComputeUnits': 'ALL', 'ModelFormat': 'MLProgram'}
    if key == 'qnn':
        return {'backend_path': 'QnnHtp.dll' if os.name == 'nt' else 'libQnnHtp.so'}
    if key == 'openvino':
        # NPUs compile a fixed shape; each video keeps one input size.
        return {'device_type': 'NPU', 'reshape_input': f'pixel_values[1,3,{height},{width}]'}
    return {}


def preferred(available):
    """Provider keys to try, best first, limited to what the installed package offers."""
    chosen = os.environ.get('AFTERTAKE_DEPTH_PROVIDER', '').strip().lower()
    if chosen:
        if chosen not in PROVIDERS:
            raise ValueError(f'AFTERTAKE_DEPTH_PROVIDER must be one of {", ".join(PROVIDERS)}.')
        return [chosen] if chosen == 'cpu' else [chosen, 'cpu']
    return [key for key, (name, _) in PROVIDERS.items() if name in available]


def import_runtime():
    import onnxruntime as ort
    if os.name == 'nt' and 'OpenVINOExecutionProvider' in ort.get_available_providers():
        try:  # Windows wheels load OpenVINO's libraries from the separate openvino package.
            import onnxruntime.tools.add_openvino_win_libs as libraries
            libraries.add_openvino_libs_to_path()
        except Exception:
            pass
    return ort


def verify_model(path=MODEL_PATH):
    if not path.is_file() or path.stat().st_size != MODEL['size']:
        raise ValueError('Install the depth model: node scripts/aftertake.mjs setup-npu')
    with open(path, 'rb') as file:
        if hashlib.file_digest(file, 'sha256').hexdigest() != MODEL['sha256']:
            raise ValueError('The depth model differs from the pinned file. Run node scripts/aftertake.mjs setup-npu again.')


class Depth:
    """One session for frames of one size; call it with an RGB uint8 frame for relative nearness."""

    def __init__(self, width, height, ort=None, model=MODEL_PATH):
        if ort is None:
            try:
                ort = import_runtime()
            except ImportError as error:
                raise ValueError('Install the depth runtime: node scripts/aftertake.mjs setup-npu') from error
            verify_model(model)
        self.width, self.height = width, height
        self.size = input_size(width, height)
        failures = []
        for key in preferred(ort.get_available_providers()):
            name = PROVIDERS[key][0]
            providers = [(name, provider_options(key, *self.size))]
            if key != 'cpu':
                providers.append(('CPUExecutionProvider', {}))
            try:
                self.session = ort.InferenceSession(str(model), providers=providers)
            except Exception as error:  # an accelerator can be listed yet unusable
                failures.append(f'{PROVIDERS[key][1]}: {error}')
                continue
            active = self.session.get_providers()[0]
            self.provider = next(k for k, (n, _) in PROVIDERS.items() if n == active)
            self.label = PROVIDERS[self.provider][1]
            self.input = self.session.get_inputs()[0].name
            return
        raise ValueError('No ONNX Runtime accelerator could load the depth model. ' + '; '.join(failures))

    def __call__(self, frame):
        from PIL import Image
        picture = Image.fromarray(frame).resize(self.size, Image.Resampling.BICUBIC)
        pixels = (np.asarray(picture, np.float32) / 255 - MEAN) / STD
        nearness = self.session.run(None, {self.input: pixels.transpose(2, 0, 1)[None]})[0][0]
        resized = Image.fromarray(nearness.astype(np.float32), mode='F').resize(
            (self.width, self.height), Image.Resampling.BILINEAR)
        return np.asarray(resized, np.float32)


def status():
    """What is installed and which accelerator depth would use, without loading the model."""
    try:
        ort = import_runtime()
    except ImportError:
        return {'runtime': None, 'model': MODEL_PATH.is_file(), 'accelerator': None,
                'fix': 'node scripts/aftertake.mjs setup-npu'}
    try:
        keys = preferred(ort.get_available_providers())
    except ValueError as error:
        return {'runtime': ort.__version__, 'model': MODEL_PATH.is_file(), 'accelerator': None,
                'fix': str(error)}
    model = MODEL_PATH.is_file() and MODEL_PATH.stat().st_size == MODEL['size']
    return {'runtime': ort.__version__, 'model': model,
            'accelerator': PROVIDERS[keys[0]][1] if keys else None,
            'providers': [PROVIDERS[key][1] for key in keys],
            'fix': None if model else 'node scripts/aftertake.mjs setup-npu'}


if __name__ == '__main__':
    if sys.argv[1:] == ['--status']:
        print(json.dumps(status()))
    else:
        print(__doc__)
