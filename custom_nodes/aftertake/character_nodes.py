"""Small media/coordinate adapters. Native SAM3 and H3 perform inference. MIT."""
import hashlib
import json
import math
import os
import threading
from fractions import Fraction
import av
import numpy as np
import torch
from .vram import host_tensor


GENERATION_PROFILES = frozenset(('structure', 'inpaint', 'cinema', 'motion-transfer',
    'motion', 'frame-edit', 'image-gen', 'text-video', 'character-selection', 'character-swap'))
_KITCHEN_PROBES = set()
_KITCHEN_PROBE_LOCK = threading.RLock()


def _runtime_device_policy(config, profile='structure'):
    """Check execution devices only; CPU storage, offload and media outputs are valid."""
    from .hardware import HardwareConfigurationError
    import comfy.model_management as management
    from comfy.cli_args import args
    device = management.get_torch_device()
    def selected_cuda(stage, execution_device):
        if (getattr(execution_device, 'type', None) != 'cuda' or
                getattr(execution_device, 'index', None) != config.device_index):
            raise HardwareConfigurationError('execution_device_mismatch',
                f'The {stage} stage must execute on the selected NVIDIA CUDA device. '
                'Remove CPU execution overrides or restart on the matching GPU; CPU storage and offload remain allowed.')
    selected_cuda('SAM3' if profile == 'character-selection' else 'diffusion', device)
    uses_vae = profile != 'character-selection'
    if uses_vae:
        selected_cuda('VAE', management.vae_device())
    if profile == 'character-swap':
        # The pinned H3 graph explicitly retargets CLIP with SelectCLIPDevice.
        # Its GPU selection overrides a CPU default caused by --novram; use
        # the same native resolver without changing the graph or its patcher.
        selected_cuda('H3 reference encoder', management.resolve_gpu_device_option('gpu:0'))
    else:
        selected_cuda('text encoder', management.text_encoder_device())
    if any(getattr(args, name, False) for name in
            ('force_fp32', 'fp32_unet', 'fp32_text_enc')) or (uses_vae and getattr(args, 'fp32_vae', False)):
        raise HardwareConfigurationError('float32_execution_disabled',
            'Remove forced FP32 execution flags before starting this generation profile. No FP32 fallback is enabled.')
    return management, device


def _engine_idle():
    try:
        from server import PromptServer
        running, pending = PromptServer.instance.prompt_queue.get_current_queue()
        return isinstance(running, list) and isinstance(pending, list) and not running and not pending
    except (ImportError, AttributeError, TypeError, ValueError):
        return False


def _kitchen_attention_probe(facts):
    """Check the compiled INT8 attention actually selected by the pinned H3 graph."""
    from .hardware import HardwareConfigurationError
    try:
        import comfy_kitchen as kitchen
        device = torch.device(f'cuda:{facts.device_index}')
        if not kitchen.int8_attention_is_available(device):
            raise RuntimeError('Compiled INT8 attention is unavailable')
        key = (id(kitchen), facts.device_index, facts.device_uuid or facts.name,
            facts.torch_version, facts.cuda_version)
        with _KITCHEN_PROBE_LOCK:
            if key not in _KITCHEN_PROBES:
                with torch.cuda.device(facts.device_index), torch.inference_mode():
                    query = torch.ones((1, 1, 16, 128), device=device, dtype=torch.bfloat16)
                    result = kitchen.int8_attention(query, query, query)
                    if (result.device != device or result.dtype != torch.bfloat16 or
                            not bool(torch.isfinite(result).all().item()) or
                            not torch.allclose(result, torch.ones_like(result), rtol=.03, atol=.03)):
                        raise RuntimeError('INT8 attention did not preserve the CUDA BF16 result')
                    torch.cuda.synchronize(facts.device_index)
                _KITCHEN_PROBES.add(key)
        return 'comfy-kitchen-int8-attention'
    except (ImportError, AttributeError, RuntimeError, TypeError, OSError) as error:
        raise HardwareConfigurationError('h3_attention_unavailable',
            'H3 requires the pinned Comfy Kitchen compiled INT8 attention on the selected CUDA GPU. '
            'Update the runtime packages and check the NVIDIA driver; no alternate attention or precision fallback was attempted.') from error


def runtime_hardware_report(profile):
    """Refresh capacity and validate cached tiny kernels without loading a model."""
    from dataclasses import asdict
    from .hardware import HardwareConfig, HardwareConfigurationError, NvidiaExecutionBackend
    if profile not in GENERATION_PROFILES:
        raise ValueError('Choose a supported Aftertake generation profile.')
    report = {'format': 'aftertake-hardware-status/1', 'profile': profile,
        'ready': False, 'backend': 'cuda', 'facts': None, 'config': None, 'checks': [],
        'policy': {'cpuInference': False, 'float32Fallback': False}}
    try:
        config = HardwareConfig.from_environment()
        report['config'] = asdict(config)
        from .vram import managed_reclaimable_vram_bytes
        management, device = _runtime_device_policy(config, profile)
        backend = NvidiaExecutionBackend(config)
        measured = backend.inspect()
        reclaimable = managed_reclaimable_vram_bytes(management, device=device, idle=_engine_idle(),
            max_bytes=max(0, measured.total_vram_bytes - measured.free_vram_bytes))
        report['facts'] = {**measured.as_dict(), 'reclaimable_vram_bytes': reclaimable}
        facts = backend.preflight(reclaimable_vram_bytes=reclaimable)
        report['facts'] = facts.as_dict()
        probes = list(facts.kernel_probes)
        if profile == 'character-swap':
            probes.append(_kitchen_attention_probe(facts))
            report['checks'].append({'id': 'h3-attention', 'state': 'pass',
                'message': 'The selected CUDA GPU executes Comfy Kitchen INT8 attention.'})
        report['facts']['kernel_probes'] = probes
        report['checks'].extend([
            {'id': 'cuda', 'state': 'pass', 'message': 'The selected execution device is NVIDIA CUDA.'},
            {'id': 'native-bf16', 'state': 'pass', 'message': 'Native BF16 execution is available.'},
            {'id': 'memory', 'state': 'pass', 'message': 'Current free VRAM and verified idle model residency cover the configured reserve and workspace budget.'},
            {'id': 'kernel-probe', 'state': 'pass', 'message': 'Tiny CUDA BF16 and optimized attention probes passed.'},
        ])
        report['ready'] = True
    except HardwareConfigurationError as error:
        report['checks'].append({'id': error.code, 'state': 'blocked', 'message': str(error)})
    except Exception:
        report['checks'].append({'id': 'runtime-hardware-unavailable', 'state': 'blocked',
            'message': 'Aftertake could not validate this engine hardware. Update the Aftertake node pack and restart ComfyUI.'})
    return report


def validate_generation_recipe(recipe_json, *, selection=False):
    """Run during native prompt validation, before any linked model executes."""
    try:
        value = json.loads(recipe_json)
        if not isinstance(value, dict):
            return 'Use a JSON object for the output recipe.'
        kind = value.get('format')
        if selection and kind == 'aftertake-character-selection/1':
            profile = 'character-selection'
        elif not selection and kind == 'aftertake-character-output/1':
            profile = 'character-swap'
        elif not selection and kind == 'aftertake-text-video/1':
            profile = 'text-video'
        elif not selection and kind == 'aftertake/1':
            profile = value.get('pipeline', 'structure')
            if profile == 'motion-transfer' and isinstance(value.get('transfer'), dict) and value['transfer'].get('finish'):
                return True  # Existing frames and matte only; no diffusion or SAM3.
            if profile == 'cinema' and isinstance(value.get('cinema'), dict) and value['cinema'].get('guidance') == 'tracks':
                profile = 'motion'
            if profile not in GENERATION_PROFILES:
                return 'Choose a supported Aftertake generation profile.'
        else:
            return True  # CPU media encoding and film/compositor exports remain available.
        report = runtime_hardware_report(profile)
        if report['ready']:
            return True
        return next((check['message'] for check in report['checks'] if check['state'] == 'blocked'),
            'The selected generation hardware is not ready.')
    except (TypeError, ValueError, json.JSONDecodeError):
        return 'Use valid JSON for the output recipe.'


def install_runtime_hardware_route():
    try:
        from aiohttp import web
        from server import PromptServer
    except ImportError:
        return  # Standalone CPU media tests do not start a Comfy server.
    server = getattr(PromptServer, 'instance', None)
    if server is None or getattr(server, '_aftertake_hardware_route', False):
        return
    @server.routes.get('/aftertake/runtime')
    async def runtime_status(request):
        import asyncio
        profile = request.query.get('profile', 'structure')
        if profile not in GENERATION_PROFILES:
            return web.json_response({'error': 'Choose a supported Aftertake generation profile.'}, status=400)
        report = await asyncio.to_thread(runtime_hardware_report, profile)
        return web.json_response(report, headers={'Cache-Control': 'no-store'})
    server._aftertake_hardware_route = True


class AftertakeSubjectPoints:
    @classmethod
    def INPUT_TYPES(cls):
        return {'required':{'images':('IMAGE',),'points_json':('STRING',{'default':'{}'}),
            'source_width':('INT',{'default':1920,'min':1}),'source_height':('INT',{'default':1080,'min':1})}}
    RETURN_TYPES=('STRING','STRING')
    FUNCTION='execute'
    CATEGORY='Aftertake/Character'
    def execute(self,images,points_json,source_width,source_height):
        h,w=images.shape[1:3];scale=max(w/source_width,h/source_height)
        dx=(source_width*scale-w)/2;dy=(source_height*scale-h)/2
        value=json.loads(points_json)
        def points(kind):
            result=[]
            for p in value.get(kind,[]):
                x=float(p['x'])*source_width*scale-dx;y=float(p['y'])*source_height*scale-dy
                if not math.isfinite(x+y):raise ValueError('Subject point must be finite')
                if not 0<=x<=w or not 0<=y<=h:
                    if kind=='positive':raise ValueError('That subject point is outside the prepared frame. Select a point farther inside the picture.')
                    continue
                result.append({'x':min(w-1,round(x)),'y':min(h-1,round(y))})
            return json.dumps(result)
        return points('positive'),points('negative')


class AftertakeSelectCharacterMask:
    @classmethod
    def INPUT_TYPES(cls):
        return {'required':{'masks':('MASK',),'positive_coords':('STRING',{'default':'[]'}),
            'negative_coords':('STRING',{'default':'[]'})}}
    RETURN_TYPES=('MASK',)
    FUNCTION='execute'
    CATEGORY='Aftertake/Character'
    def execute(self,masks,positive_coords,negative_coords):
        positive=json.loads(positive_coords);negative=json.loads(negative_coords)
        if not positive or not len(masks):raise ValueError('No person was detected at that point. Choose a clear point on the person.')
        h,w=masks.shape[-2:];rank=[]
        for index,mask in enumerate(masks):
            def hits(points):return sum(bool(mask[min(h-1,max(0,p['y'])),min(w-1,max(0,p['x']))]>.5)for p in points)
            included=hits(positive);excluded=hits(negative)
            if included:rank.append((included/len(positive)-2*excluded/max(1,len(negative)),index))
        rank.sort(reverse=True)
        if not rank or rank[0][0]<=0:raise ValueError('No detected person matches those selection and exclusion points.')
        if len(rank)>1 and rank[0][0]==rank[1][0]:raise ValueError('Those points match more than one person. Add a point on the intended person or exclude the other person.')
        return (masks[rank[0][1]:rank[0][1]+1],)


class AftertakeSaveCharacterSelection:
    @classmethod
    def VALIDATE_INPUTS(cls, request_json):
        return validate_generation_recipe(request_json, selection=True)

    @classmethod
    def INPUT_TYPES(cls):
        return {'required':{'images':('IMAGE',),'masks':('MASK',),
            'filename_prefix':('STRING',{'default':'aftertake/character-selection'}),
            'request_json':('STRING',{'default':'{}'})},'hidden':{'prompt':'PROMPT'}}
    RETURN_TYPES=()
    FUNCTION='execute'
    OUTPUT_NODE=True
    CATEGORY='Aftertake/Character'
    def execute(self,images,masks,filename_prefix,request_json,prompt=None):
        import folder_paths
        from . import export_prompt
        n,h,w=images.shape[:3]
        request=json.loads(request_json);resolution=request.get('resolution','480')
        if resolution not in ('480','768'):raise ValueError('Choose a supported character working resolution')
        pixel_limit=1000000 if resolution=='768' else 500000
        if not 24<=n<=360 or h%32 or w%32 or w*h>pixel_limit or tuple(masks.shape)!=(n,h,w):
            raise ValueError('Character selection must match a 1–15s, 24 fps prepared source')
        if not torch.isfinite(masks).all():raise ValueError('Selection contains non-finite values')
        folder,name,counter,subfolder,_=folder_paths.get_save_image_path(filename_prefix,folder_paths.get_output_directory())
        mask_name=f'{name}_{counter:05}_mask.mkv';mask_path=os.path.join(folder,mask_name)
        empty=[]
        with av.open(mask_path,'w')as container:
            stream=container.add_stream('ffv1',rate=24);stream.width=w;stream.height=h;stream.pix_fmt='gray'
            stream.options={'level':'3','threads':'2'}
            for i,mask in enumerate(masks):
                with host_tensor(mask.detach()) as host_mask:
                    pixels=(host_mask.numpy()>.5).astype(np.uint8)*255
                if not pixels.any():empty.append(i)
                frame=av.VideoFrame.from_ndarray(pixels,format='gray');frame.pts=i;frame.time_base=Fraction(1,24)
                for packet in stream.encode(frame):container.mux(packet)
            for packet in stream.encode():container.mux(packet)
        with open(mask_path,'rb')as file:mask_hash=hashlib.file_digest(file,'sha256').hexdigest()
        info={'width':w,'height':h,'frames':n,'fps':24,'emptyFrames':empty,'maskSha256':mask_hash}
        preview_name=f'{name}_{counter:05}_preview.mp4'
        with av.open(os.path.join(folder,preview_name),'w')as container:
            container.metadata['comment']=json.dumps({'recipe':{'format':'aftertake-character-selection-output/1',
                'request':json.loads(request_json),'selection':info},'workflow':export_prompt(prompt)},allow_nan=False)
            stream=container.add_stream('libx264',rate=24);stream.width=w;stream.height=h;stream.pix_fmt='yuv420p'
            stream.options={'crf':'17','preset':'fast','threads':'2'}
            for i,(image,mask) in enumerate(zip(images,masks)):
                with host_tensor(image[...,:3].detach()) as host_image:
                    pixels=(host_image.clamp(0,1).numpy()*255).round().astype(np.uint8)
                with host_tensor(mask.detach()) as host_mask:
                    inside=host_mask.numpy()>.5
                pixels[inside]=(pixels[inside]*.58+np.array([70,235,150])*.42).round().astype(np.uint8)
                frame=av.VideoFrame.from_ndarray(pixels,format='rgb24');frame.pts=i;frame.time_base=Fraction(1,24)
                for packet in stream.encode(frame):container.mux(packet)
            for packet in stream.encode():container.mux(packet)
        return {'ui':{'gifs':[
            {'filename':mask_name,'subfolder':subfolder,'type':'output','format':'video/x-matroska'},
            {'filename':preview_name,'subfolder':subfolder,'type':'output','format':'video/mp4'}]}}


class AftertakeAlignCharacterMask:
    @classmethod
    def INPUT_TYPES(cls):
        return {'required':{'masks':('MASK',),'images':('IMAGE',),'source_frames':('INT',{'default':56,'min':1})}}
    RETURN_TYPES=('MASK',)
    FUNCTION='execute'
    CATEGORY='Aftertake/Character'
    def execute(self,masks,images,source_frames):
        if len(masks)!=source_frames or len(images)<source_frames or masks.shape[1:3]!=images.shape[1:3]:
            raise ValueError('The reviewed selection does not match this source timeline and canvas')
        if not torch.isfinite(masks).all():raise ValueError('Selection contains non-finite values')
        masks=(masks>.5).float()
        if not masks.flatten(1).any(dim=1).all():raise ValueError('The person was lost in some frames. Review the selection before generating.')
        if len(images)>source_frames:masks=torch.cat((masks,masks[-1:].expand(len(images)-source_frames,-1,-1)))
        return (masks,)


class AftertakeRuntimeInfo:
    @classmethod
    def INPUT_TYPES(cls):
        import shutil
        enabled=os.name=='nt' and os.environ.get('AFTERTAKE_SAFE_WEIGHT_COPIES')=='1'
        return {'required':{'weight_copy_backend':(['pytorch' if enabled else 'native'],),
            'ffmpeg_tools':(['ready' if shutil.which('ffmpeg') and shutil.which('ffprobe') else 'missing'],)}}
    RETURN_TYPES=('STRING',)
    FUNCTION='execute'
    CATEGORY='Aftertake/Runtime'
    def execute(self,weight_copy_backend,ffmpeg_tools):return (weight_copy_backend,)


CHARACTER_NODES={c.__name__:c for c in (AftertakeSubjectPoints,AftertakeSelectCharacterMask,AftertakeSaveCharacterSelection,AftertakeAlignCharacterMask,AftertakeRuntimeInfo)}
