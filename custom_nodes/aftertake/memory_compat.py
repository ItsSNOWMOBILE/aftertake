"""Opt-in workaround for Windows host-buffer reads; preserve upstream copy_. MIT."""
import logging
import os
import inspect
from functools import wraps

def install():
    if os.name!='nt' or os.environ.get('AFTERTAKE_SAFE_WEIGHT_COPIES')!='1':return
    import comfy.memory_management as memory
    original=getattr(memory,'read_tensor_file_slice_into',None)
    expected=inspect.Signature([
        inspect.Parameter('tensor',inspect.Parameter.POSITIONAL_OR_KEYWORD),
        inspect.Parameter('destination',inspect.Parameter.POSITIONAL_OR_KEYWORD),
        inspect.Parameter('stream',inspect.Parameter.POSITIONAL_OR_KEYWORD,default=None),
        inspect.Parameter('destination2',inspect.Parameter.POSITIONAL_OR_KEYWORD,default=None),
    ])
    try:
        signature=inspect.signature(original)
    except (TypeError,ValueError) as error:
        raise RuntimeError('Aftertake safe weight copies require the pinned ComfyUI transfer hook '
            '(tensor, destination, stream=None, destination2=None). Preserve this runtime and reinstall the pinned version.') from error
    if list(signature.parameters.values()) != list(expected.parameters.values()):
        raise RuntimeError('Aftertake safe weight copies cannot modify an unsupported ComfyUI transfer hook. '
            'Expected (tensor, destination, stream=None, destination2=None); preserve this runtime and reinstall the pinned version.')
    if getattr(original,'aftertake_safe_copies',False):return
    @wraps(original)
    def safe_copy(tensor,destination,stream=None,destination2=None):
        raw=getattr(tensor,'_qdata',tensor)
        if getattr(raw.untyped_storage(),'_comfy_tensor_file_slice',None) is not None:
            # Comfy's caller falls back to PyTorch copy_. Neither tensor bytes,
            # quantization metadata nor model math are changed here.
            return False
        return original(tensor,destination,stream=stream,destination2=destination2)
    safe_copy.aftertake_safe_copies=True
    memory.read_tensor_file_slice_into=safe_copy
    logging.info('Aftertake safe weight copies: PyTorch handles file-backed CPU/GPU transfers')
