"""Keep objects in front of a replaced person from the original shot.

A character replacement may change the tracked person and a 32-pixel margin
around them, as in the native composite. Inside that margin, any pixel that is
not the person and is clearly nearer the camera than the person beside it is put
back from the prepared source, so a cup held in front of the body, a microphone
or a railing stays on top of the new character. Depth comes from depth_runtime:
the Neural Engine, an NPU, a GPU through DirectML, or the CPU. Pixels outside the
margin are never touched, so the take can only move back towards the source.

    python scripts/protect-foreground.py job.json

job.json: {"source", "mask", "take", "output", "margin"}. Progress lines go to
stderr as "progress <0-1>"; the result is printed as JSON.
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

sys.path.insert(0, str(Path(__file__).resolve().parent))
import depth_runtime  # noqa: E402

GROW = 32  # the native composite's margin around the tracked person
REACH = 48  # how far to look for the person's own depth beside a pixel
FEATHER = 2


def box_sum(values, radius):
    """Sum over the (2r+1)-square around each pixel, with zeros beyond the frame."""
    padded = np.pad(values.astype(np.float64), radius + 1)[:-1, :-1]
    total = padded.cumsum(0).cumsum(1)
    size = 2 * radius + 1
    return total[size:, size:] - total[:-size, size:] - total[size:, :-size] + total[:-size, :-size]


def grown(mask, radius):
    return box_sum(mask, radius) > 0.5


def protection(nearness, person, margin):
    """Pixels in the editable margin that sit clearly in front of the person beside them."""
    region = grown(person, GROW) & ~person
    weight = box_sum(person, REACH)
    local = box_sum(np.where(person, nearness, 0), REACH) / np.maximum(weight, 1)
    low, high = np.percentile(nearness, [1, 99])
    front = region & (weight > 0) & (nearness > local + margin * max(high - low, 1e-6))
    # Opening drops isolated pixels that depth noise can produce at edges.
    front = grown(box_sum(front, 1) > 8.5, 1) & front
    return front


def frames(path, kind='rgb24'):
    with av.open(str(path)) as container:
        for frame in container.decode(video=0):
            yield frame.to_ndarray(format=kind)


def mux_audio(video, take, output):
    """Copy the take's sound, which is the source performance's, onto the new picture."""
    import imageio_ffmpeg
    subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-v', 'error', '-y', '-i', str(video), '-i', str(take),
                    '-map', '0:v:0', '-map', '1:a:0?', '-c', 'copy', '-movflags', '+faststart', str(output)],
                   check=True, capture_output=True, timeout=300,
                   creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)


def protect(job, depth=None, report=lambda share: None):
    margin = float(job.get('margin', 0.1))
    if not 0.02 <= margin <= 0.5:
        raise ValueError('Choose a depth margin between 0.02 and 0.5.')
    with av.open(str(job['take'])) as container:
        stream = container.streams.video[0]
        total, width, height = stream.frames, stream.width, stream.height
    if depth is None:
        depth = depth_runtime.Depth(width, height)
    # Pass one: where to protect, per frame, packed eight pixels a byte.
    masks = []
    for index, (source, mask) in enumerate(zip(frames(job['source']), frames(job['mask'], 'gray'))):
        if source.shape[:2] != (height, width) or mask.shape != (height, width):
            raise ValueError('The take, prepared source and tracked mask must share one canvas.')
        masks.append(np.packbits(protection(depth(source), mask > 127, margin), axis=1))
        report(0.85 * (index + 1) / max(total, len(masks)))
    # A pixel stays protected when at least two of three neighbouring frames agree,
    # so depth noise cannot make an object flicker in and out.
    steady = []
    for index in range(len(masks)):
        window = masks[max(0, index - 1):index + 2]
        if len(window) == 3:
            steady.append((window[0] & window[1]) | (window[1] & window[2]) | (window[0] & window[2]))
        else:
            steady.append(masks[index])
    protected = [np.unpackbits(bits, axis=1, count=width).astype(bool) for bits in steady]
    # Report the masks that actually reach compositing, after the temporal vote.
    # Encoded before/after differences cannot recover this evidence reliably.
    pixels_by_frame = [int(mask.sum()) for mask in protected]
    protected_indices = [index for index, count in enumerate(pixels_by_frame) if count]
    pixels = sum(pixels_by_frame)
    receipt = {'frames': len(protected), 'protectedFrames': len(protected_indices),
               'protectedPixels': pixels, 'protectedFrameIndices': protected_indices,
               'protectedPixelsByFrame': pixels_by_frame, 'margin': margin, 'grow': GROW,
               'accelerator': getattr(depth, 'label', 'custom'),
               'model': {key: depth_runtime.MODEL[key] for key in ('name', 'repository', 'revision', 'sha256', 'license')}}
    if not pixels:
        return {'changed': False, **receipt}
    # Pass two: put the protected pixels back from the source, with a soft edge.
    output = Path(job['output'])
    handle, picture = tempfile.mkstemp(suffix='.mp4', prefix='aftertake-protect-', dir=output.parent)
    os.close(handle)
    try:
        with av.open(picture, 'w') as container:
            stream = container.add_stream('libx264', rate=24)
            stream.width, stream.height, stream.pix_fmt = width, height, 'yuv420p'
            stream.options = {'crf': '14', 'preset': 'medium', 'threads': '2'}
            count = 0
            for index, (take, source) in enumerate(zip(frames(job['take']), frames(job['source']))):
                mask = protected[index] if index < len(protected) else np.zeros((height, width), bool)
                size = 2 * FEATHER + 1
                alpha = np.minimum(box_sum(mask, FEATHER) / (size * size) * 2, 1)[..., None]
                pixels_out = (take * (1 - alpha) + source * alpha).round().astype(np.uint8)
                frame = av.VideoFrame.from_ndarray(pixels_out, format='rgb24')
                frame.pts, frame.time_base = index, Fraction(1, 24)
                for packet in stream.encode(frame):
                    container.mux(packet)
                count += 1
            for packet in stream.encode():
                container.mux(packet)
        if count != len(protected):
            raise ValueError('The take and its tracked mask have different lengths.')
        mux_audio(picture, job['take'], output)
    finally:
        Path(picture).unlink(missing_ok=True)
    report(1)
    return {'changed': True, **receipt}


if __name__ == '__main__':
    try:
        with open(sys.argv[1], encoding='utf-8') as file:
            result = protect(json.load(file), report=lambda share: print(f'progress {share:.3f}', file=sys.stderr, flush=True))
        print(json.dumps(result))
    except ValueError as failure:
        print(str(failure), file=sys.stderr)
        sys.exit(2)
