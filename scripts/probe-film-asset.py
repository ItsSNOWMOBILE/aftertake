"""Inspect a film upload before admitting it to the local media library."""
import json
import math
from pathlib import Path
import sys
import time
import av
from PIL import Image, ImageOps

MAX_PIXELS = 3840 * 2160
MAX_DURATION = 600
MAX_PROBE_SECONDS = 20  # Leave headroom inside the upload route's 30-second timeout.
MAX_SCAN_PACKETS = 200_000
MAX_DECODE_PACKETS = 128


def check_budget(deadline, count, limit):
    if count > limit or time.monotonic() >= deadline:
        raise ValueError('Media timing probe exceeded its safe work limit.')


def check_video_size(width, height):
    if width <= 0 or height <= 0 or width * height > MAX_PIXELS:
        raise ValueError('Use video up to 4K.')


def check_duration(duration):
    if not math.isfinite(duration) or not .1 <= duration <= MAX_DURATION:
        raise ValueError('Use media between 0.1 seconds and ten minutes.')
    return duration


def primary_stream(container):
    if container.streams.video:
        stream = container.streams.video[0]
        check_video_size(stream.width, stream.height)
        return stream
    if container.streams.audio:
        return container.streams.audio[0]
    raise ValueError('Use media with a video or audio stream.')


def packet_duration(container, primary, deadline):
    """Measure unknown-header media from bounded demuxing, without decoding frames."""
    streams = [stream for stream in container.streams if stream.type in ('video', 'audio')]
    spans = {}
    for count, packet in enumerate(container.demux(*streams), 1):
        check_budget(deadline, count, MAX_SCAN_PACKETS)
        if not packet.size:  # Demuxer's empty decoder-flush packets have no timestamp.
            continue
        timestamp = packet.pts if packet.pts is not None else packet.dts
        if timestamp is None or packet.time_base is None:
            raise ValueError('Cannot measure media without packet timestamps.')
        stamp = float(timestamp * packet.time_base)
        length = float((packet.duration or 0) * packet.time_base)
        if not math.isfinite(stamp) or not math.isfinite(length) or length < 0:
            raise ValueError('Invalid media packet timing.')
        span = spans.setdefault(packet.stream.index, {
            'first': stamp, 'last': stamp, 'end': stamp, 'step': 0, 'last_length': length,
        })
        if stamp > span['last']:
            span['step'] = stamp - span['last']
        if stamp >= span['last']:
            span['last_length'] = length
        span['first'] = min(span['first'], stamp)
        span['last'] = max(span['last'], stamp)
        span['end'] = max(span['end'], stamp + length)
        # Bound every track and cross-track offsets, not just the preferred picture.
        if max(value['end'] for value in spans.values()) - min(
                value['first'] for value in spans.values()) > MAX_DURATION:
            raise ValueError('Use media between 0.1 seconds and ten minutes.')
    span = spans.get(primary.index)
    if span is None:
        raise ValueError('Media contains no timestamped packets.')
    # WebM video often omits the final packet duration. Use its measured cadence,
    # not a browser-supplied duration or a count of nominal-rate decoded frames.
    ends = {index: max(value['end'], value['last'] + (
        value['step'] if value['last_length'] == 0 else 0)) for index, value in spans.items()}
    if max(ends.values()) - min(value['first'] for value in spans.values()) > MAX_DURATION:
        raise ValueError('Use media between 0.1 seconds and ten minutes.')
    end = ends[primary.index]
    return check_duration(end - span['first'])


def validate_frame(container, stream, deadline):
    for count, packet in enumerate(container.demux(stream), 1):
        check_budget(deadline, count, MAX_DECODE_PACKETS)
        for frame in packet.decode():
            if stream.type == 'video':
                check_video_size(frame.width, frame.height)
            check_budget(deadline, count, MAX_DECODE_PACKETS)
            return
    raise ValueError('Media contains no decodable frames.')


def probe(source):
    source = Path(source)
    if source.suffix.lower() in ['.png', '.jpg', '.jpeg', '.webp']:
        with Image.open(source) as opened:
            if opened.width * opened.height > MAX_PIXELS:
                raise ValueError('Use an image up to 4K.')
            image = ImageOps.exif_transpose(opened).convert('RGB')
            image.load()
            return {'kind': 'image', 'width': image.width, 'height': image.height, 'duration': 30}
    deadline = time.monotonic() + MAX_PROBE_SECONDS
    with av.open(str(source)) as container:
        stream = primary_stream(container)
        duration = (float(stream.duration * stream.time_base) if stream.duration
                    else float(container.duration or 0) / av.time_base)
        unknown_duration = duration == 0
        if unknown_duration:
            duration = packet_duration(container, stream, deadline)
        else:
            check_duration(duration)
            validate_frame(container, stream, deadline)
        result = {'kind': stream.type, 'duration': duration}
        if stream.type == 'video':
            result.update(width=stream.width, height=stream.height)
    if unknown_duration:
        # Reopen rather than seeking a live WebM that has no seek/duration header.
        with av.open(str(source)) as container:
            validate_frame(container, primary_stream(container), deadline)
    return result


if __name__ == '__main__':
    print(json.dumps(probe(sys.argv[1])))
