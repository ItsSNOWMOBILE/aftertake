"""Prepare a source for a Comfy Cloud job and finish its result on this computer.

Comfy Cloud runs only its own nodes, so Aftertake's loader, grade and saver run
here instead. `prepare` decodes a source onto the job's frame clock exactly as
AftertakeLoadClip does and writes it for upload. `finish` grades Cloud's WebM
frames, adds the sound and writes the same MP4 as AftertakeSaveVideo, with its
recipe and workflow in the comment tag. Each mode reads one JSON job file:

    python scripts/cloud-media.py prepare job.json
    python scripts/cloud-media.py finish job.json
"""
from fractions import Fraction
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

import av
import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'custom_nodes/aftertake'))
from media_utils import display_transform, mux_source_audio, oriented_image  # noqa: E402

PALETTES = ('source', 'warm', 'cool', 'monochrome')


def select_frames(path, width, height, frames, fps, trim_start):
    """AftertakeLoadClip's frame clock (composite_math.decode_clip) as uint8 RGB."""
    def pixels(frame):
        if display_transform(frame) is None:
            return frame.reformat(width=width, height=height, format='rgb24').to_ndarray()
        return np.asarray(oriented_image(frame).resize((width, height), Image.Resampling.BICUBIC))

    selected, next_time, last, last_decoded = [], trim_start, None, None
    with av.open(str(path)) as container:
        stream = container.streams.video[0]
        origin = float(stream.start_time * stream.time_base) if stream.start_time else 0
        duration = (float(stream.duration * stream.time_base) if stream.duration
                    else float(container.duration or 0) / av.time_base)
        if trim_start > 0:
            container.seek(int((trim_start + origin) * av.time_base), backward=True)
        for frame in container.decode(video=0):
            last_decoded = frame
            timestamp = float(frame.time or 0) - origin
            if timestamp + 1e-6 < next_time:
                continue
            last = pixels(frame)
            while timestamp + 1e-6 >= next_time and len(selected) < frames:
                selected.append(last)
                next_time = trim_start + len(selected) / fps
            if len(selected) == frames:
                break
        if last is None and last_decoded is not None and trim_start < duration:
            last = pixels(last_decoded)
    if last is None:
        raise ValueError('No decodable frames in the selected source range')
    while len(selected) < frames:
        selected.append(last)
    return selected


def encode(path, frames, fps, comment=None, pix_fmt='yuv420p', options=None):
    with av.open(str(path), 'w') as container:
        if comment is not None:
            container.metadata['comment'] = comment
        stream = container.add_stream('libx264', rate=Fraction(str(fps)))
        stream.height, stream.width = frames[0].shape[:2]
        stream.pix_fmt = pix_fmt
        stream.options = options or {'crf': '17', 'preset': 'fast'}
        for pixels in frames:
            for packet in stream.encode(av.VideoFrame.from_ndarray(np.ascontiguousarray(pixels), format='rgb24')):
                container.mux(packet)
        for packet in stream.encode():
            container.mux(packet)


def grade(pixels, palette):
    """AftertakeFilmGrade on decoded 8-bit frames."""
    if palette == 'source':
        return pixels
    image = pixels.astype(np.float32) / 255
    luma = (image * np.array([.2126, .7152, .0722], np.float32)).sum(-1, keepdims=True)
    if palette == 'monochrome':
        graded = np.repeat(luma, 3, axis=-1)
    else:
        red, green, blue, shadow = image[..., 0], image[..., 1], image[..., 2], 1 - luma[..., 0]
        if palette == 'warm':
            graded = np.stack((red * 1.04 + .025 * shadow, green, blue * .92), -1)
        else:
            graded = np.stack((red * .92, green, blue * 1.04 + .02 * shadow), -1)
    return (np.clip(graded, 0, 1) * 255).round().astype(np.uint8)


def mux_audio_file(destination, audio, duration):
    """mux_generated_audio for a saved track: video copied, sound padded or cut to the clock."""
    import imageio_ffmpeg

    destination = Path(destination)
    handle, temporary = tempfile.mkstemp(suffix='.mp4', prefix='aftertake-audio-', dir=destination.parent)
    os.close(handle)
    try:
        subprocess.run([
            imageio_ffmpeg.get_ffmpeg_exe(), '-v', 'error', '-y', '-i', str(destination), '-i', str(audio),
            '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy',
            '-af', 'apad', '-c:a', 'aac', '-b:a', '192k', '-t', str(duration),
            '-map_metadata', '0', '-movflags', '+faststart', temporary,
        ], check=True, capture_output=True, timeout=180,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        os.replace(temporary, destination)
    finally:
        Path(temporary).unlink(missing_ok=True)


def prepare(job):
    for key in ('width', 'height', 'frames'):
        if not isinstance(job[key], int) or not 1 <= job[key] <= 16384:
            raise ValueError(f'Choose a valid {key} for the Cloud source.')
    frames = select_frames(job['source'], job['width'], job['height'], job['frames'], float(job['fps']),
                           float(job.get('trim_start', 0)))
    # Full-chroma, near-lossless H.264: Cloud's LoadVideo decodes it to the same pixels.
    encode(job['output'], frames, job['fps'], pix_fmt='yuv444p', options={'crf': '8', 'preset': 'fast'})
    return {'frames': len(frames), 'width': job['width'], 'height': job['height']}


def finish(job):
    palette = job.get('palette', 'source')
    if palette not in PALETTES:
        raise ValueError('Unknown film grade')
    if job.get('generated_audio') and job.get('source_audio'):
        raise ValueError('Choose either source sound or generated audio for this output.')
    with av.open(str(job['frames'])) as container:
        frames = [grade(frame.to_ndarray(format='rgb24'), palette) for frame in container.decode(video=0)]
    if not frames:
        raise ValueError('Comfy Cloud returned no frames.')
    expected = job.get('frame_count')
    if expected is not None and len(frames) != expected:
        raise ValueError(f'Comfy Cloud returned {len(frames)} frames instead of {expected}.')
    output, fps = Path(job['output']), float(job['fps'])
    encode(output, frames, job['fps'], comment=json.dumps(job['comment'], allow_nan=False))
    duration = len(frames) / fps
    if job.get('generated_audio'):
        mux_audio_file(output, job['generated_audio'], duration)
    elif job.get('source_audio'):
        source = job['source_audio']
        mux_source_audio(output, source['path'], float(source.get('start', 0)), duration)
    return {'frames': len(frames), 'width': frames[0].shape[1], 'height': frames[0].shape[0]}


def main():
    if len(sys.argv) != 3 or sys.argv[1] not in ('prepare', 'finish'):
        raise SystemExit('Usage: cloud-media.py prepare|finish job.json')
    job = json.loads(Path(sys.argv[2]).read_text(encoding='utf-8'))
    print(json.dumps((prepare if sys.argv[1] == 'prepare' else finish)(job)))


if __name__ == '__main__':
    main()
