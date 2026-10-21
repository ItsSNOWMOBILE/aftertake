"""Repair a tracked person mask on the CPU: short tracking losses and flicker.

Repair only adds pixels, so it can never uncover part of the person. Frames where
tracking lost the person are filled from the nearest tracked frames, moved along
the person's motion, for gaps up to MAX_GAP frames. A pixel that drops out for
one or two frames between tracked frames is restored. The repaired mask and a
review preview are written beside the original; amber marks what repair added.

    python scripts/repair-character-mask.py job.json

job.json: {"mask", "source", "maskOut", "previewOut", "request"}; the result is
printed as JSON.
"""
from fractions import Fraction
import hashlib
import json
import sys

import av
import numpy as np

MAX_GAP = 12  # frames: half a second at 24 fps
FLICKER = 2  # longest dropout restored between two tracked frames
TRACKED, ADDED = np.array([70, 235, 150]), np.array([255, 176, 46])


def read_masks(path):
    """Packed masks (eight pixels a byte), pixel counts and centroids per frame."""
    packed, counts, centers, shape = [], [], [], None
    with av.open(path) as container:
        for frame in container.decode(video=0):
            mask = frame.to_ndarray(format='gray') > 127
            shape = mask.shape
            packed.append(np.packbits(mask, axis=1))
            counts.append(int(mask.sum()))
            ys, xs = np.nonzero(mask)
            centers.append((ys.mean(), xs.mean()) if len(ys) else None)
    if not packed:
        raise ValueError('The tracked mask has no frames.')
    return packed, counts, centers, shape


def unpack(packed, width):
    return np.unpackbits(packed, axis=1, count=width).astype(bool)


def shifted(mask, dy, dx):
    """The mask moved by whole pixels, with nothing wrapping around the frame."""
    dy, dx = int(round(dy)), int(round(dx))
    out = np.zeros_like(mask)
    height, width = mask.shape
    if abs(dy) >= height or abs(dx) >= width:
        return out
    out[max(dy, 0):height + min(dy, 0), max(dx, 0):width + min(dx, 0)] = \
        mask[max(-dy, 0):height + min(-dy, 0), max(-dx, 0):width + min(-dx, 0)]
    return out


def fill_lost_frames(packed, counts, centers, width):
    """Fill each run of empty frames up to MAX_GAP long from its tracked neighbours."""
    total = len(packed)
    recovered, still_lost, index = [], [], 0
    while index < total:
        if counts[index]:
            index += 1
            continue
        end = index
        while end + 1 < total and not counts[end + 1]:
            end += 1
        before = index - 1 if index > 0 else None
        after = end + 1 if end + 1 < total else None
        run = range(index, end + 1)
        if len(run) > MAX_GAP or (before is None and after is None):
            still_lost.extend(run)
        else:
            first = unpack(packed[before], width) if before is not None else None
            last = unpack(packed[after], width) if after is not None else None
            for frame in run:
                if first is not None and last is not None:
                    # Move both neighbours to where the person would be at this frame.
                    weight = (frame - before) / (after - before)
                    (y0, x0), (y1, x1) = centers[before], centers[after]
                    y, x = y0 + (y1 - y0) * weight, x0 + (x1 - x0) * weight
                    mask = shifted(first, y - y0, x - x0) | shifted(last, y - y1, x - x1)
                else:
                    mask = first if first is not None else last
                packed[frame] = np.packbits(mask, axis=1)
                recovered.append(frame)
        index = end + 1
    return recovered, still_lost


def close_flicker(packed):
    """Restore pixels missing for at most FLICKER frames between two frames that have them."""
    total, out = len(packed), list(packed)
    for frame in range(total):
        add = np.zeros_like(packed[frame])
        for back in range(1, FLICKER + 1):
            for ahead in range(1, FLICKER + 2 - back):
                if frame - back >= 0 and frame + ahead < total:
                    add |= packed[frame - back] & packed[frame + ahead]
        out[frame] = packed[frame] | add
    return out


def popcount(values):
    return int(np.unpackbits(values).sum())


def write_mask(path, packed, width, height):
    with av.open(path, 'w') as container:
        stream = container.add_stream('ffv1', rate=24)
        stream.width, stream.height, stream.pix_fmt = width, height, 'gray'
        stream.options = {'level': '3', 'threads': '2'}
        for index, frame_bits in enumerate(packed):
            pixels = unpack(frame_bits, width).astype(np.uint8) * 255
            frame = av.VideoFrame.from_ndarray(pixels, format='gray')
            frame.pts, frame.time_base = index, Fraction(1, 24)
            for packet in stream.encode(frame):
                container.mux(packet)
        for packet in stream.encode():
            container.mux(packet)
    with open(path, 'rb') as file:
        return hashlib.file_digest(file, 'sha256').hexdigest()


def write_preview(path, source, original, repaired, width, recipe):
    with av.open(source) as reader, av.open(path, 'w') as container:
        container.metadata['comment'] = json.dumps({'recipe': recipe}, allow_nan=False)
        stream = container.add_stream('libx264', rate=24)
        stream.width, stream.height = width, unpack(repaired[0], width).shape[0]
        stream.pix_fmt, stream.options = 'yuv420p', {'crf': '17', 'preset': 'fast', 'threads': '2'}
        frames = reader.decode(video=0)
        for index, (before, after) in enumerate(zip(original, repaired)):
            picture = next(frames).to_ndarray(format='rgb24')
            if picture.shape[:2] != (stream.height, width):
                raise ValueError('The prepared source does not match the tracked mask.')
            kept, added = unpack(before, width), unpack(after & ~before, width)
            picture[kept] = (picture[kept] * .58 + TRACKED * .42).round().astype(np.uint8)
            picture[added] = (picture[added] * .45 + ADDED * .55).round().astype(np.uint8)
            frame = av.VideoFrame.from_ndarray(picture, format='rgb24')
            frame.pts, frame.time_base = index, Fraction(1, 24)
            for packet in stream.encode(frame):
                container.mux(packet)
        for packet in stream.encode():
            container.mux(packet)


def repair(job):
    packed, counts, centers, (height, width) = read_masks(job['mask'])
    if not any(counts):
        raise ValueError('Tracking lost the person in every frame. Mark them again and track a new selection.')
    original = list(packed)
    recovered, still_lost = fill_lost_frames(packed, counts, centers, width)
    filled = list(packed)
    repaired = close_flicker(filled)
    recovered_pixels = sum(popcount(filled[frame]) for frame in recovered)
    restored_pixels = sum(popcount(after & ~before) for before, after in zip(filled, repaired))
    if not recovered and not restored_pixels:
        return {'changed': False}
    mask_hash = write_mask(job['maskOut'], repaired, width, height)
    info = {'width': width, 'height': height, 'frames': len(repaired), 'fps': 24,
            'emptyFrames': still_lost, 'maskSha256': mask_hash}
    details = {'processor': 'aftertake-mask-repair/1', 'maxGap': MAX_GAP, 'flicker': FLICKER,
               'framesRecovered': recovered, 'recoveredPixels': recovered_pixels,
               'restoredPixels': restored_pixels}
    write_preview(job['previewOut'], job['source'], original, repaired, width,
                  {'format': 'aftertake-character-selection-output/1', 'request': job['request'],
                   'selection': info, 'repair': details})
    return {'changed': True, 'selection': info, 'repair': details}


if __name__ == '__main__':
    try:
        with open(sys.argv[1], encoding='utf-8') as file:
            print(json.dumps(repair(json.load(file))))
    except ValueError as failure:
        print(str(failure), file=sys.stderr)
        sys.exit(2)
