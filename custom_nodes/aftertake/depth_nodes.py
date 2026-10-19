"""Optional still-image DA3 adapter. Native Comfy loaders, math and attention stay intact."""
import base64
import hashlib
import json
import os
import zlib

import numpy as np
from PIL import Image, PngImagePlugin
import torch

MODEL_NAME = 'depth_anything_3_small.safetensors'
MODEL_SHA = '9c0a53d157c5b315d4c82908a43d93eeaa3a9ac3de9d15c2b4242ef46b5508ad'


def depth_preflight(*, native_execution=False):
    from .hardware import HardwareConfig, HardwareConfigurationError, NvidiaExecutionBackend
    import comfy.model_management as management
    from comfy.cli_args import args
    config = HardwareConfig.from_environment()
    device = management.get_torch_device()
    if device.type != 'cuda' or device.index != config.device_index:
        raise HardwareConfigurationError('execution_device_mismatch', 'Depth estimation must run on the selected NVIDIA CUDA GPU.')
    if any(getattr(args, flag, False) for flag in ('force_fp32', 'fp32_unet')):
        raise HardwareConfigurationError('float32_execution_disabled', 'Depth estimation uses native BF16; remove forced FP32 execution flags.')
    backend = NvidiaExecutionBackend(config)
    measured = backend.inspect()
    from .character_nodes import _engine_idle
    from .vram import managed_reclaimable_vram_bytes
    # Native execution is serial: this adapter is the sole active stage and
    # has not loaded its model yet. Completed cached weights are evictable by
    # the unchanged native loader. Read-only readiness never assumes this.
    reclaimable = managed_reclaimable_vram_bytes(management, idle=native_execution or _engine_idle(), device=device,
        max_bytes=max(0, measured.total_vram_bytes - measured.free_vram_bytes))
    return backend.preflight(reclaimable_vram_bytes=reclaimable)


class AftertakeEstimateDepth:
    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {'images': ('IMAGE',), 'request_json': ('STRING', {'default': '{}', 'multiline': True})},
            'hidden': {'prompt': 'PROMPT'}}

    @classmethod
    def VALIDATE_INPUTS(cls, request_json):
        try:
            request = json.loads(request_json)
            if request.get('format') != 'aftertake-depth-effect/1' or request.get('clip', {}).get('kind') != 'image':
                return 'Depth effects currently accept a still image only.'
            depth_preflight()
            return True
        except Exception as error:
            return str(error)

    RETURN_TYPES = ()
    FUNCTION = 'execute'
    CATEGORY = 'Aftertake'
    OUTPUT_NODE = True

    def execute(self, images, request_json, prompt=None):
        # Admission precedes the native loader, including direct Comfy use.
        facts = depth_preflight(native_execution=True)
        request = json.loads(request_json)
        if images.ndim != 4 or images.shape[0] != 1 or images.shape[-1] != 3:
            raise ValueError('Depth effects currently estimate exactly one still image.')
        height, width = images.shape[1:3]
        if min(height, width) < 64 or max(height, width) > 4096 or width * height > 4194304:
            raise ValueError('Use a still image between 64 pixels per side and four megapixels.')
        if (request.get('format') != 'aftertake-depth-effect/1' or
                request.get('clip', {}).get('kind') != 'image' or
                request['clip'].get('width') != width or request['clip'].get('height') != height):
            raise ValueError('The depth request does not match its source canvas.')
        import folder_paths
        model_path = folder_paths.get_full_path_or_raise('geometry_estimation', MODEL_NAME)
        with open(model_path, 'rb') as handle:
            if hashlib.file_digest(handle, 'sha256').hexdigest() != MODEL_SHA:
                raise ValueError('Depth weights differ from the pinned DA3 Small checkpoint. Run the optional depth model download.')
        from comfy_extras.nodes_depth_anything_3 import LoadDA3Model, DA3Inference
        model = LoadDA3Model.execute(MODEL_NAME, 'bf16')[0]
        diffusion = model.model.diffusion_model
        if diffusion.dtype != torch.bfloat16:
            raise ValueError('The native DA3 loader did not preserve explicit BF16 execution.')
        geometry = DA3Inference.execute(model, images, 504, 'upper_bound_resize', {'mode': 'mono'})[0]
        depth = geometry['depth'].detach().cpu().numpy().astype('<f4', copy=False)
        if depth.shape != (1, height, width) or not np.isfinite(depth).all() or not (depth > 0).all():
            raise ValueError('The native model returned an invalid depth field.')
        raw = depth[0].tobytes()
        lo, hi = np.percentile(depth, (2, 98))
        if hi <= lo:
            raise ValueError('The model returned no usable depth variation.')
        preview = np.rint(np.clip((depth[0] - lo) / (hi - lo), 0, 1) * 255).astype(np.uint8)
        from . import export_prompt
        receipt = {'format': 'aftertake-raw-depth/1', 'request': request, 'workflow': export_prompt(prompt),
            'modelSha256': MODEL_SHA, 'width': width, 'height': height, 'inferenceDtype': 'bfloat16',
            'device': f'cuda:{facts.device_index}', 'rawSha256': hashlib.sha256(raw).hexdigest(),
            'encoding': 'zlib-base64-f32le', 'data': base64.b64encode(zlib.compress(raw)).decode('ascii')}
        metadata = PngImagePlugin.PngInfo()
        # Uncompressed iTXt avoids Pillow's small compressed-text chunk limit;
        # the raw numeric payload is independently compressed and hash bound.
        metadata.add_itxt('aftertake_depth', json.dumps(receipt, separators=(',', ':'), allow_nan=False))
        folder, name, counter, subfolder, _ = folder_paths.get_save_image_path('aftertake/depth', folder_paths.get_output_directory())
        filename = f'{name}_{counter:05}_.png'
        Image.fromarray(preview).save(os.path.join(folder, filename), pnginfo=metadata)
        return {'ui': {'images': [{'filename': filename, 'subfolder': subfolder, 'type': 'output'}]}}


DEPTH_NODES = {'AftertakeEstimateDepth': AftertakeEstimateDepth}
