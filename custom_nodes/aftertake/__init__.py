"""Aftertake: editable spatial/temporal cues for open-weight VFX workflows. MIT."""
import hashlib
import json
import math
import os
from fractions import Fraction

import av
import numpy as np
import torch
import torch.nn.functional as F
from .media_utils import display_transform, oriented_image, mux_source_audio, mux_generated_audio
from .composite_math import (smoothstep, decode_clip, camera_flow, track_spatial_mask,
    temporal_envelope, build_cue_mask, match_boundary_color, composite_images)


def export_prompt(prompt):
    """Comfy adds NaN cache sentinels beside node inputs during native loops.

    Cache invalidation is not part of the executable recipe. Preserve the
    actual class/inputs and other graph metadata; reject non-finite inputs.
    """
    if prompt is None:return None
    return {key:{name:value for name,value in node.items() if name!='is_changed'}
            for key,node in prompt.items()}


class AftertakeCueMask:
    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {
            'width': ('INT', {'default': 512, 'min': 64, 'max': 4096}),
            'height': ('INT', {'default': 320, 'min': 64, 'max': 4096}),
            'frames': ('INT', {'default': 49, 'min': 1, 'max': 257}),
            'fps': ('FLOAT', {'default': 16, 'min': 1, 'max': 60}),
            'cue_json': ('STRING', {'multiline': True, 'default': '{}'}),
        }, 'optional': {'images': ('IMAGE',)}}
    RETURN_TYPES = ('MASK', 'MASK', 'MASK')
    RETURN_NAMES = ('edit_mask', 'preserve_attention_mask', 'spatial_region')
    FUNCTION = 'execute'
    CATEGORY = 'Aftertake'

    def execute(self, width, height, frames, fps, cue_json, images=None):
        cue = json.loads(cue_json)
        spatial = build_cue_mask(width, height, frames, fps, cue, images, apply_envelope=False)
        mask = temporal_envelope(frames, fps, cue)[:, None, None] * spatial
        return mask, 1 - mask, spatial


class AftertakeLoadClip:
    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {
            'filename': ('STRING', {'default': 'source.mp4'}),
            'width': ('INT', {'default': 512, 'min': 64, 'max': 4096}),
            'height': ('INT', {'default': 320, 'min': 64, 'max': 4096}),
            'frames': ('INT', {'default': 49, 'min': 1, 'max': 257}),
            'fps': ('FLOAT', {'default': 16, 'min': 1, 'max': 60}),
            'trim_start': ('FLOAT', {'default': 0, 'min': 0, 'max': 3600}),
        }}
    RETURN_TYPES = ('IMAGE', 'STRING')
    RETURN_NAMES = ('frames', 'source_audio')
    FUNCTION = 'execute'
    CATEGORY = 'Aftertake'

    @classmethod
    def IS_CHANGED(cls, filename, **kwargs):
        import folder_paths
        digest = hashlib.sha256()
        with open(folder_paths.get_annotated_filepath(filename), 'rb') as stream:
            while chunk := stream.read(1024 * 1024):
                digest.update(chunk)
        return digest.hexdigest()

    def execute(self, filename, width, height, frames, fps, trim_start):
        import folder_paths
        path = os.path.realpath(folder_paths.get_annotated_filepath(filename))
        input_root = os.path.realpath(folder_paths.get_input_directory())
        if os.path.commonpath([path, input_root]) != input_root:
            raise ValueError('Source must be in the ComfyUI input directory')
        return decode_clip(path, width, height, frames, fps, trim_start), path


class AftertakeCropRegion:
    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {'images': ('IMAGE',), **{name: ('INT', {'default': 0 if name in ('x','y') else 64, 'min': 0 if name in ('x','y') else 1, 'max': 16384}) for name in ('x','y','width','height','target_width','target_height')}}}
    RETURN_TYPES = ('IMAGE',)
    FUNCTION = 'execute'
    CATEGORY = 'Aftertake'

    def execute(self, images, x, y, width, height, target_width, target_height):
        if min(x,y)<0 or min(width,height,target_width,target_height)<1 or x+width>images.shape[2] or y+height>images.shape[1]:
            raise ValueError('Keep the complete focus region inside the source frame')
        cropped=images[:,y:y+height,x:x+width]
        return (F.interpolate(cropped.movedim(-1,1),size=(target_height,target_width),mode='bicubic',align_corners=False).movedim(1,-1).clamp(0,1),)


class AftertakeRestoreRegion:
    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {'original': ('IMAGE',), 'generated': ('IMAGE',), **{name: ('INT', {'default': 0 if name in ('x','y') else 64, 'min': 0 if name in ('x','y') else 1, 'max': 16384}) for name in ('x','y','width','height')}}}
    RETURN_TYPES = ('IMAGE',)
    FUNCTION = 'execute'
    CATEGORY = 'Aftertake'

    def execute(self, original, generated, x, y, width, height):
        if min(x,y)<0 or min(width,height)<1 or x+width>original.shape[2] or y+height>original.shape[1]:
            raise ValueError('Keep the complete focus region inside the source frame')
        if original.shape[0]!=generated.shape[0]:raise ValueError('Focused generation must retain the complete source frame clock')
        restored=original.clone()
        region=F.interpolate(generated.movedim(-1,1),size=(height,width),mode='bicubic',align_corners=False).movedim(1,-1).to(original).clamp(0,1)
        restored[:,y:y+height,x:x+width]=region
        return (restored,)


class AftertakeComposite:
    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {'original': ('IMAGE',), 'generated': ('IMAGE',), 'mask': ('MASK',)},
            'optional': {'match_color': ('BOOLEAN', {'default': False}), 'spatial_mask': ('MASK',)}}
    RETURN_TYPES = ('IMAGE',)
    FUNCTION = 'execute'
    CATEGORY = 'Aftertake'

    def execute(self, original, generated, mask, match_color=False, spatial_mask=None):
        return (composite_images(original, generated, mask, match_color, spatial_mask),)

class AftertakeFilmGrade:
    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {'images': ('IMAGE',), 'palette': (['source', 'warm', 'cool', 'monochrome'],)}}
    RETURN_TYPES = ('IMAGE',)
    FUNCTION = 'execute'
    CATEGORY = 'Aftertake'

    def execute(self, images, palette):
        if palette == 'source':
            return (images,)
        luma = (images[..., :3] * images.new_tensor([.2126, .7152, .0722])).sum(-1, keepdim=True)
        if palette == 'monochrome':
            return (luma.expand_as(images),)
        red, green, blue = images[..., 0], images[..., 1], images[..., 2]
        shadow = 1 - luma[..., 0]
        if palette == 'warm':
            graded = torch.stack((red * 1.04 + .025 * shadow, green, blue * .92), -1)
        elif palette == 'cool':
            graded = torch.stack((red * .92, green, blue * 1.04 + .02 * shadow), -1)
        else:
            raise ValueError('Unknown film grade')
        return (graded.clamp(0, 1),)


class AftertakeSaveVideo:
    @classmethod
    def VALIDATE_INPUTS(cls, recipe_json):
        from .character_nodes import validate_generation_recipe
        return validate_generation_recipe(recipe_json)

    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {
            'images': ('IMAGE',), 'fps': ('FLOAT', {'default': 16, 'min': 1, 'max': 60}),
            'filename_prefix': ('STRING', {'default': 'aftertake/shot'}),
            'recipe_json': ('STRING', {'default': '{}', 'multiline': True}),
        }, 'optional': {
            'source_audio': ('STRING', {'default': ''}),
            'generated_audio': ('AUDIO',),
            'audio_start': ('FLOAT', {'default': 0, 'min': 0, 'max': 3600}),
            'display_width': ('INT', {'default': 0, 'min': 0, 'max': 4096}),
            'display_height': ('INT', {'default': 0, 'min': 0, 'max': 4096}),
        }, 'hidden': {'prompt': 'PROMPT'}}
    RETURN_TYPES = ()
    FUNCTION = 'execute'
    CATEGORY = 'Aftertake'
    OUTPUT_NODE = True

    def execute(self, images, fps, filename_prefix, recipe_json, prompt=None, source_audio='', audio_start=0, display_width=0, display_height=0, generated_audio=None):
        import folder_paths
        if source_audio and generated_audio is not None:
            raise ValueError('Choose either source sound or generated audio for this output.')
        if bool(display_width) != bool(display_height) or display_width%2 or display_height%2:
            raise ValueError('Display geometry needs two even dimensions')
        if display_width and (images.shape[2]!=display_width or images.shape[1]!=display_height):
            images=F.interpolate(images.movedim(-1,1),size=(display_height,display_width),mode='bicubic',align_corners=False).movedim(1,-1)
        folder, name, counter, subfolder, _ = folder_paths.get_save_image_path(filename_prefix, folder_paths.get_output_directory())
        filename = f'{name}_{counter:05}_.mp4'
        with av.open(os.path.join(folder, filename), 'w') as container:
            container.metadata['comment'] = json.dumps({'recipe': json.loads(recipe_json), 'workflow': export_prompt(prompt)},allow_nan=False)
            stream = container.add_stream('libx264', rate=Fraction(str(fps)))
            stream.width, stream.height = images.shape[2], images.shape[1]
            stream.pix_fmt = 'yuv420p'
            stream.options = {'crf': '17', 'preset': 'fast'}
            for image in images:
                pixels = (image[..., :3].detach().cpu().clamp(0, 1).numpy() * 255).round().astype(np.uint8)
                for packet in stream.encode(av.VideoFrame.from_ndarray(pixels, format='rgb24')):
                    container.mux(packet)
            for packet in stream.encode():
                container.mux(packet)
        if source_audio:
            source = os.path.realpath(source_audio)
            input_root = os.path.realpath(folder_paths.get_input_directory())
            if os.path.commonpath([source, input_root]) != input_root:
                raise ValueError('Audio source must be in the ComfyUI input directory')
            mux_source_audio(os.path.join(folder, filename), source, audio_start, len(images) / fps)
        elif generated_audio is not None:
            mux_generated_audio(os.path.join(folder, filename), generated_audio, len(images) / fps)
        # Comfy's v2 proxy recognizes video outputs under the established gifs key.
        return {'ui': {'gifs': [{'filename': filename, 'subfolder': subfolder, 'type': 'output', 'format': 'video/mp4'}]}}


NODE_CLASS_MAPPINGS = {cls.__name__: cls for cls in [AftertakeCueMask, AftertakeLoadClip, AftertakeCropRegion, AftertakeRestoreRegion, AftertakeComposite, AftertakeFilmGrade, AftertakeSaveVideo]}
from .character_nodes import CHARACTER_NODES, install_runtime_hardware_route
from .memory_compat import install as install_safe_weight_copies
install_safe_weight_copies()
install_runtime_hardware_route()
NODE_CLASS_MAPPINGS.update(CHARACTER_NODES)
from .depth_nodes import DEPTH_NODES
NODE_CLASS_MAPPINGS.update(DEPTH_NODES)
NODE_DISPLAY_NAME_MAPPINGS = {key: key.replace('Aftertake', 'Aftertake · ') for key in NODE_CLASS_MAPPINGS}
