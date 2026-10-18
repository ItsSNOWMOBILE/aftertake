"""Opt-in workaround for Windows host-buffer reads; preserve upstream copy_. MIT."""
import logging
import os

def install():
    if os.name!='nt' or os.environ.get('AFTERTAKE_SAFE_WEIGHT_COPIES')!='1':return
    import comfy.memory_management as memory
    original=memory.read_tensor_file_slice_into
    if getattr(original,'aftertake_safe_copies',False):return
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
