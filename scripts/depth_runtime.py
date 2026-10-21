"""Depth Anything V2 Small through ONNX Runtime, on the best accelerator this computer has.

The order is Core ML (Apple Neural Engine and GPU), QNN (Snapdragon NPU), OpenVINO
(Intel NPU), DirectML (any DirectX 12 GPU), then the CPU. Only the ONNX Runtime
package that scripts/setup-depth.py installed is present. Automatic selection
reports failed accelerators before trying the CPU. An explicit
AFTERTAKE_DEPTH_PROVIDER choice never silently changes to another provider.
CPU graph nodes may still support an accelerated session; provider registration
alone is not proof of where the model's compute ran. For a measured run, set
AFTERTAKE_DEPTH_PROFILE_PREFIX to a private output prefix and call finish_profiling().
AFTERTAKE_DEPTH_DML_DEVICE_ID selects the DirectML DXGI adapter (default 0).

    python scripts/depth_runtime.py --status   prints what is installed, as JSON
"""
from pathlib import Path
import hashlib
import json
import os
import sys
import warnings

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
    if key == 'directml':
        value = os.environ.get('AFTERTAKE_DEPTH_DML_DEVICE_ID', '0').strip()
        if not value.isdecimal():
            raise ValueError('AFTERTAKE_DEPTH_DML_DEVICE_ID must be a nonnegative DXGI adapter index.')
        return {'device_id': str(int(value))}
    return {}


def preferred(available):
    """Provider keys to try, best first, limited to what the installed package offers."""
    chosen = os.environ.get('AFTERTAKE_DEPTH_PROVIDER', '').strip().lower()
    if chosen:
        if chosen not in PROVIDERS:
            raise ValueError(f'AFTERTAKE_DEPTH_PROVIDER must be one of {", ".join(PROVIDERS)}.')
        if PROVIDERS[chosen][0] not in available:
            raise ValueError(f'Requested depth provider {chosen} is not installed. Available providers: {", ".join(available)}.')
        return [chosen]
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

    def __init__(self, width, height, ort=None, model=MODEL_PATH, profile_prefix=None):
        if ort is None:
            try:
                ort = import_runtime()
            except ImportError as error:
                raise ValueError('Install the depth runtime: node scripts/aftertake.mjs setup-npu') from error
            verify_model(model)
        self.width, self.height = width, height
        self.size = input_size(width, height)
        self.requested_provider = os.environ.get('AFTERTAKE_DEPTH_PROVIDER', '').strip().lower() or 'auto'
        self.available_providers = list(ort.get_available_providers())
        self.failures = []
        self.profile_prefix = str(profile_prefix or os.environ.get('AFTERTAKE_DEPTH_PROFILE_PREFIX', ''))
        self.profile_result = None
        for key in preferred(self.available_providers):
            name = PROVIDERS[key][0]
            requested_options = provider_options(key, *self.size)
            providers = [(name, requested_options)]
            if key != 'cpu':
                providers.append(('CPUExecutionProvider', {}))
            options = ort.SessionOptions()
            if key == 'directml':
                options.enable_mem_pattern = False
                options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
            if self.profile_prefix:
                options.enable_profiling = True
                options.profile_file_prefix = self.profile_prefix
            try:
                session = ort.InferenceSession(str(model), sess_options=options,
                                               providers=providers, enable_fallback=False)
                registered = list(session.get_providers())
                if not registered or registered[0] != name:
                    raise RuntimeError(f'Requested {name}, but session registered {registered}.')
            except Exception as error:  # an accelerator can be listed yet unusable
                self.failures.append(f'{PROVIDERS[key][1]}: {error}')
                continue
            self.session = session
            self.provider = key
            self.registered_providers = registered
            self.requested_options = requested_options
            self.label = PROVIDERS[self.provider][1]
            self.input = self.session.get_inputs()[0].name
            if self.failures:
                warnings.warn('Depth automatic selection used ' + self.label + ' after: ' + '; '.join(self.failures),
                              RuntimeWarning, stacklevel=2)
            return
        raise ValueError('No ONNX Runtime accelerator could load the depth model. ' + '; '.join(self.failures))

    def diagnostics(self):
        """Session facts, distinct from the per-node execution evidence in a profile."""
        return {'requestedProvider': self.requested_provider, 'provider': self.provider,
                'accelerator': self.label, 'registeredProviders': list(self.session.get_providers()),
                'requestedProviderOptions': self.requested_options,
                'registeredProviderOptions': (self.session.get_provider_options()
                    if hasattr(self.session, 'get_provider_options') else {}),
                'availableProviders': self.available_providers, 'inputSize': list(self.size),
                'fallback': bool(self.failures), 'failedProviders': list(self.failures),
                'executionEvidence': self.profile_result or {'status': 'not-profiled',
                    'note': 'Registered providers do not prove model node placement.'}}

    def finish_profiling(self):
        """Close an opt-in ORT profile and summarize executed kernel providers, not device-only time."""
        if not self.profile_prefix:
            return None
        if self.profile_result is None:
            self.profile_result = summarize_profile(self.session.end_profiling())
        return self.profile_result

    def __call__(self, frame):
        from PIL import Image
        picture = Image.fromarray(frame).resize(self.size, Image.Resampling.BICUBIC)
        pixels = (np.asarray(picture, np.float32) / 255 - MEAN) / STD
        nearness = self.session.run(None, {self.input: pixels.transpose(2, 0, 1)[None]})[0][0]
        resized = Image.fromarray(nearness.astype(np.float32), mode='F').resize(
            (self.width, self.height), Image.Resampling.BILINEAR)
        return np.asarray(resized, np.float32)


def summarize_profile(path):
    """ORT kernel events provide node-provider evidence; host preprocessing is outside this trace."""
    events = json.loads(Path(path).read_text(encoding='utf-8'))
    providers = {}
    unassigned = 0
    for event in events:
        if event.get('cat') != 'Node' or not event.get('name', '').endswith('_kernel_time'):
            continue
        args = event.get('args', {})
        name = args.get('provider')
        if not name:
            unassigned += 1
            continue
        record = providers.setdefault(name, {'kernelEvents': 0, 'kernelMicroseconds': 0, 'ops': {}})
        record['kernelEvents'] += 1
        record['kernelMicroseconds'] += event.get('dur', 0)
        op = args.get('op_name', 'unknown')
        record['ops'][op] = record['ops'].get(op, 0) + 1
    return {'status': 'profiled' if providers else 'no-provider-events', 'path': str(path),
            'providers': providers, 'unassignedKernelEvents': unassigned,
            'note': 'ORT kernel-event durations include host scheduling/waiting; they are not isolated device compute times.'}


def status():
    """Installed packages and an uninitialized provider candidate, never an execution claim."""
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
            'verification': 'not-initialized',
            'note': 'Accelerator is a candidate. Model compilation and node placement have not been checked.',
            'fix': None if model else 'node scripts/aftertake.mjs setup-npu'}


if __name__ == '__main__':
    if sys.argv[1:] == ['--status']:
        print(json.dumps(status()))
    else:
        print(__doc__)
