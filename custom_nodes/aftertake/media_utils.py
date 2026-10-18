"""Shared CPU media handling for import, previews and Comfy output nodes."""
import os
from pathlib import Path
import subprocess
import tempfile

import av
import numpy as np
from PIL import Image


def display_transform(frame):
    """Read all eight orthogonal phone orientations, including mirrored video."""
    data = frame.side_data.get('DISPLAYMATRIX')
    if data is None:
        return None
    matrix = np.frombuffer(data, dtype=np.int32).reshape(3, 3)
    linear = matrix[:2, :2].astype(float) / 65536
    key = tuple(np.rint(linear).astype(int).flat)
    transforms = {
        (1, 0, 0, 1): None,
        (-1, 0, 0, 1): Image.Transpose.FLIP_LEFT_RIGHT,
        (1, 0, 0, -1): Image.Transpose.FLIP_TOP_BOTTOM,
        (-1, 0, 0, -1): Image.Transpose.ROTATE_180,
        (0, -1, 1, 0): Image.Transpose.ROTATE_90,
        (0, 1, -1, 0): Image.Transpose.ROTATE_270,
        (0, 1, 1, 0): Image.Transpose.TRANSPOSE,
        (0, -1, -1, 0): Image.Transpose.TRANSVERSE,
    }
    if key not in transforms or not np.allclose(linear, np.rint(linear), atol=.001):
        raise ValueError('Use video with a standard 90-degree display orientation.')
    return transforms[key]


def oriented_image(frame):
    image = frame.to_image()
    transform = display_transform(frame)
    return image if transform is None else image.transpose(transform)


def mux_source_audio(destination, source, trim_start, duration):
    """Keep the encoded result pixels, trim source sound, and pad a short track.

    Source trim is relative to the first video timestamp, as in decode_clip.
    FFmpeg's input seek is relative to the container start instead.
    """
    import imageio_ffmpeg

    destination, source = Path(destination), Path(source)
    with av.open(str(source)) as container:
        if not container.streams.audio:
            return False
        video = container.streams.video[0]
        video_origin = float(video.start_time * video.time_base) if video.start_time is not None else 0
        container_origin = float(container.start_time or 0) / av.time_base
    offset = max(0, trim_start + video_origin - container_origin)
    handle, temporary = tempfile.mkstemp(suffix='.mp4', prefix='aftertake-audio-', dir=destination.parent)
    os.close(handle)
    try:
        subprocess.run([
            imageio_ffmpeg.get_ffmpeg_exe(), '-v', 'error', '-y',
            '-i', str(destination), '-ss', str(offset), '-i', str(source),
            '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy',
            '-af', 'apad', '-c:a', 'aac', '-b:a', '192k', '-t', str(duration),
            '-map_metadata', '0', '-movflags', '+faststart', temporary,
        ], check=True, capture_output=True, timeout=180,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        os.replace(temporary, destination)
    finally:
        Path(temporary).unlink(missing_ok=True)
    return True


def mux_generated_audio(destination, audio, duration):
    """Mux a native Comfy AUDIO tensor without changing encoded video pixels.

    The generated track starts at video time zero. Crop excess decoder context
    or pad a short track to the exact video duration, as for source audio.
    """
    import imageio_ffmpeg

    waveform = audio['waveform']
    if hasattr(waveform, 'detach'):
        waveform = waveform.detach().cpu().float().numpy()
    waveform = np.asarray(waveform, dtype=np.float32)
    rate = audio['sample_rate']
    if (not isinstance(rate, int) or not 8000 <= rate <= 192000 or
            waveform.ndim != 3 or waveform.shape[0] != 1 or waveform.shape[1] not in (1, 2) or
            not 0 < waveform.shape[2] <= rate * 60 or not np.isfinite(waveform).all()):
        raise ValueError('Generated audio needs one finite mono/stereo track and a valid sample rate.')
    destination = Path(destination)
    with tempfile.TemporaryDirectory(prefix='aftertake-generated-audio-', dir=destination.parent) as temporary:
        raw, muxed = Path(temporary) / 'audio.f32', Path(temporary) / 'muxed.mp4'
        waveform[0].T.astype('<f4').tofile(raw)
        subprocess.run([
            imageio_ffmpeg.get_ffmpeg_exe(), '-v', 'error', '-y', '-i', str(destination),
            '-f', 'f32le', '-ar', str(rate), '-ac', str(waveform.shape[1]), '-i', str(raw),
            '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy',
            '-af', 'apad', '-c:a', 'aac', '-b:a', '192k', '-t', str(duration),
            '-map_metadata', '0', '-movflags', '+faststart', str(muxed),
        ], check=True, capture_output=True, timeout=180,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        os.replace(muxed, destination)
