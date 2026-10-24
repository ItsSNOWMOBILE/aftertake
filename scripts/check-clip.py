"""Measure a finished clip for one-tap output checks: length, brightness and motion.

Prints one JSON object. src/one-tap.ts judges it, so the thresholds live in one place.
"""
import json
import sys
import av
import numpy as np

SAMPLES = 24


def luma(frame, size=96):
    """A small grayscale picture is enough to tell a blank or frozen clip."""
    picture = frame.to_image().convert('L')
    picture.thumbnail((size, size))
    return np.asarray(picture, dtype=np.float32)


def measure(path):
    with av.open(str(path)) as container:
        stream = container.streams.video[0]
        rate = float(stream.average_rate or stream.guessed_rate or 24)
        pictures = [luma(frame) for frame in container.decode(video=0)]
        width, height = stream.width, stream.height
    count = len(pictures)
    if not count:
        return {'duration': 0, 'frames': 0, 'width': width, 'height': height,
                'meanLuma': 0, 'lumaSpread': 0, 'motion': 0}
    picks = sorted({round(index * (count - 1) / (SAMPLES - 1)) for index in range(SAMPLES)})
    sampled = [pictures[index] for index in picks]
    changes = [float(np.abs(after - before).mean()) for before, after in zip(sampled, sampled[1:])]
    return {
        'duration': count / rate,
        'frames': count,
        'width': width,
        'height': height,
        'meanLuma': float(np.mean([picture.mean() for picture in sampled])),
        # The typical spread inside a frame: a flat field has none.
        'lumaSpread': float(np.median([picture.std() for picture in sampled])),
        'motion': float(np.mean(changes)) if changes else 0.0,
    }


if __name__ == '__main__':
    print(json.dumps(measure(sys.argv[1])))
