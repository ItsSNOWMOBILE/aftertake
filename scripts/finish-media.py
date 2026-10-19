"""Deterministic, streaming CPU finishing. No model or inference dependency.

The preview and export share apply_finishing. Video timestamps are copied as
exact rational offsets from the first decoded frame; no rate conversion occurs.
An identity export copies the original file, including its original audio bytes.
"""
from fractions import Fraction
from hashlib import sha256
import argparse
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import sys

import av
import numpy as np
from PIL import Image, ImageFilter, ImageOps

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'custom_nodes/aftertake'))
from media_utils import mux_source_audio, oriented_image

PROCESSOR = 'aftertake-cpu-finishing/1'
OPTICAL_DEFAULTS = dict(glowStrength=0, glowRadius=8, halationStrength=0,
                        halationRadius=6, chromaticStrength=0, chromaticOffset=1.5)
DEFAULTS = dict(exposureEV=0, contrast=0, saturation=0, temperature=0, tint=0,
                sharpen=0, vignette=0, grain=0, preset='clean', lookStrength=0, seed=42,
                **OPTICAL_DEFAULTS)
PRESETS = {'clean', 'warm-film', 'cool-film', 'noir', 'vintage'}
SIGNED = ('contrast', 'saturation', 'temperature', 'tint')
AMOUNTS = ('sharpen', 'vignette', 'grain', 'lookStrength')
MAX_PIXELS = 3840 * 2160


def file_hash(path):
    digest = sha256()
    with Path(path).open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def validate_settings(settings):
    if (not isinstance(settings, dict) or set(settings) - set(DEFAULTS) or
            set(DEFAULTS) - set(OPTICAL_DEFAULTS) - set(settings)):
        raise ValueError('Use a complete finishing settings object.')
    settings = {**OPTICAL_DEFAULTS, **settings}
    for name in ('exposureEV',) + SIGNED + AMOUNTS:
        value = settings[name]
        lower, upper = (-3, 3) if name == 'exposureEV' else ((-1, 1) if name in SIGNED else (0, 1))
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not lower <= value <= upper:
            raise ValueError('A finishing control is outside its supported range.')
    if settings['preset'] not in PRESETS or type(settings['seed']) is not int or not 0 <= settings['seed'] < 2**32:
        raise ValueError('Use a supported film look and unsigned 32-bit seed.')
    for name, maximum in {'glowStrength': 1, 'glowRadius': 32, 'halationStrength': 1,
                          'halationRadius': 32, 'chromaticStrength': 1, 'chromaticOffset': 8}.items():
        value = settings[name]
        if (isinstance(value, bool) or not isinstance(value, (int, float)) or
                not math.isfinite(value) or not 0 <= value <= maximum):
            raise ValueError('An optical finishing control is outside its supported range.')
    return settings


def is_identity(settings):
    return all(settings[name] == 0 for name in ('exposureEV',) + SIGNED + ('sharpen', 'vignette', 'grain')) and (
        settings['preset'] == 'clean' or settings['lookStrength'] == 0) and all(
            settings.get(name, 0) == 0 for name in ('glowStrength', 'halationStrength', 'chromaticStrength'))


def blur_highlights(values, radius):
    """Bounded RGB/L blur with replicated edges; never wrap an edge to its opposite.

    The diffusion-free optics work at the export canvas resolution. Pillow's
    bounded eight-bit blur is intentional; it is not a model precision change.
    """
    if radius == 0:
        return values.copy()
    padding = math.ceil(3 * radius)
    pixels = np.rint(np.clip(values, 0, 1) * 255).astype(np.uint8)
    axes = ((padding, padding), (padding, padding)) + (((0, 0),) if pixels.ndim == 3 else ())
    padded = Image.fromarray(np.pad(pixels, axes, mode='edge'))
    blurred = padded.filter(ImageFilter.GaussianBlur(radius))
    cropped = blurred.crop((padding, padding, padding + pixels.shape[1], padding + pixels.shape[0]))
    return np.asarray(cropped, dtype=np.float32) / 255


def displace_channel(channel, offset):
    """Subpixel horizontal sampling with edge clamping and no canvas-size change."""
    coordinates = np.clip(np.arange(channel.shape[1], dtype=np.float32) - offset,
                          0, channel.shape[1] - 1)
    left = np.floor(coordinates).astype(np.intp)
    right = np.minimum(left + 1, channel.shape[1] - 1)
    fraction = coordinates - left
    return channel[:, left] * (1 - fraction) + channel[:, right] * fraction


def apply_optics(rgb, settings):
    """Highlight-driven light spread, a warm outside halo, then optional RGB split."""
    if settings['glowStrength'] or settings['halationStrength']:
        bounded = np.clip(rgb, 0, 1)
        linear = np.where(bounded <= .04045, bounded / 12.92, ((bounded + .055) / 1.055) ** 2.4)
        luminance = np.sum(linear * np.array([.2126, .7152, .0722], dtype=np.float32), axis=2)
        highlights = np.clip((luminance - .65) / .35, 0, 1)
        if highlights.any():
            if settings['glowStrength']:
                spread = blur_highlights(linear * highlights[..., None], settings['glowRadius'])
                linear += np.float32(.75 * settings['glowStrength']) * spread
            if settings['halationStrength']:
                spread = blur_highlights(highlights, settings['halationRadius'])
                halo = np.maximum(spread - highlights, 0)
                warmth = np.array([1, .22, .04], dtype=np.float32)
                linear += np.float32(.5 * settings['halationStrength']) * halo[..., None] * warmth
            rgb = np.where(linear <= .0031308, linear * 12.92,
                           1.055 * np.maximum(linear, 0)**(1 / 2.4) - .055)
    if settings['chromaticStrength'] and settings['chromaticOffset']:
        strength = np.float32(settings['chromaticStrength'])
        separated = rgb.copy()
        separated[..., 0] = displace_channel(rgb[..., 0], settings['chromaticOffset'])
        separated[..., 2] = displace_channel(rgb[..., 2], -settings['chromaticOffset'])
        rgb = rgb * (1 - strength) + separated * strength
    return rgb


def apply_finishing(image, settings, frame_index=0):
    """Apply the documented RGB pipeline. Preview and final call this function."""
    settings = validate_settings(settings)
    image = image.convert('RGB')
    if is_identity(settings):
        return image.copy()
    rgb = np.asarray(image, dtype=np.float32) / 255
    linear = np.where(rgb <= .04045, rgb / 12.92, ((rgb + .055) / 1.055) ** 2.4)
    # White balance is a bounded linear-light channel gain, not a metadata edit.
    temperature, tint = settings['temperature'], settings['tint']
    gains = np.array([2**(.35 * temperature + .15 * tint), 2**(-.3 * tint),
                      2**(-.35 * temperature + .15 * tint)], dtype=np.float32)
    linear *= np.float32(2**settings['exposureEV']) * gains
    rgb = np.where(linear <= .0031308, linear * 12.92,
                   1.055 * np.maximum(linear, 0)**(1 / 2.4) - .055)
    rgb = (rgb - .5) * np.float32(2**settings['contrast']) + .5
    luma = np.sum(rgb * np.array([.2126, .7152, .0722], dtype=np.float32), axis=2, keepdims=True)
    rgb = luma + (rgb - luma) * np.float32(1 + settings['saturation'])
    strength, preset = settings['lookStrength'], settings['preset']
    if strength and preset != 'clean':
        if preset == 'warm-film':
            look = rgb * np.array([1.055, 1.01, .94], dtype=np.float32)
            look = .025 + .95 * look
        elif preset == 'cool-film':
            look = rgb * np.array([.95, 1.01, 1.055], dtype=np.float32)
            look = luma + .88 * (look - luma)
        elif preset == 'noir':
            look = np.repeat((luma - .5) * 1.2 + .5, 3, axis=2)
        else:
            muted = luma + .68 * (rgb - luma)
            look = .06 + .88 * muted * np.array([1.04, 1.0, .93], dtype=np.float32)
        rgb = rgb * np.float32(1 - strength) + look * np.float32(strength)
    if any(settings[name] for name in ('glowStrength', 'halationStrength', 'chromaticStrength')):
        rgb = apply_optics(rgb, settings)
    if settings['sharpen']:
        quantized = Image.fromarray(np.rint(np.clip(rgb, 0, 1) * 255).astype(np.uint8))
        rgb = np.asarray(quantized.filter(ImageFilter.UnsharpMask(
            radius=1, percent=round(200 * settings['sharpen']), threshold=2)), dtype=np.float32) / 255
    if settings['vignette']:
        height, width = rgb.shape[:2]
        y = ((np.arange(height, dtype=np.float32) + .5) / height * 2 - 1)[:, None]
        x = ((np.arange(width, dtype=np.float32) + .5) / width * 2 - 1)[None, :]
        radial = np.clip((x*x + y*y) / 2, 0, 1).astype(np.float32)
        rgb *= (1 - .65 * settings['vignette'] * radial**1.4)[..., None]
    if settings['grain']:
        rng = np.random.Generator(np.random.PCG64(np.random.SeedSequence([settings['seed'], frame_index])))
        noise = rng.standard_normal((*rgb.shape[:2], 1), dtype=np.float32) * np.float32(.035 * settings['grain'])
        rgb += noise
    return Image.fromarray(np.rint(np.clip(rgb, 0, 1) * 255).astype(np.uint8))


def preflight():
    import imageio_ffmpeg
    av.Codec('libx264', 'w')
    result = subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-version'], capture_output=True,
                            timeout=15, check=True,
                            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
    if not result.stdout.startswith(b'ffmpeg version'):
        raise ValueError('FFmpeg is unavailable.')
    return {'ready': True, 'processor': PROCESSOR, 'av': av.__version__}


def image_source(source):
    try:
        with Image.open(source) as original:
            if getattr(original, 'n_frames', 1) != 1:
                raise ValueError('Import animated images as a video before finishing.')
            if original.width * original.height > MAX_PIXELS:
                raise ValueError('Finish images no larger than 4K.')
            image = ImageOps.exif_transpose(original).convert('RGB')
        return image
    except (Image.UnidentifiedImageError, OSError):
        return None


def check_dimensions(image, clip):
    if image.width * image.height > MAX_PIXELS or image.size != (clip['width'], clip['height']):
        raise ValueError('The source dimensions changed or exceed the 4K finishing limit.')


def video_frames(source, clip, callback):
    """Decode at most one frame at a time and record its exact source clock."""
    digest, origin, last, previous_delta = sha256(), None, None, None
    count, final_duration, time_base = 0, None, None
    with av.open(str(source)) as container:
        if len(container.streams.video) != 1 or len(container.streams.audio) > 1:
            raise ValueError('Use one video track and at most one original audio track.')
        stream = container.streams.video[0]
        if stream.width * stream.height > MAX_PIXELS:
            raise ValueError('Finish video no larger than 4K.')
        stream_origin = Fraction(stream.start_time or 0) * stream.time_base
        rate = stream.average_rate or stream.guessed_rate
        if rate is None or not 0 < float(rate) <= 120:
            raise ValueError('Use video with a supported frame clock (up to 120 fps).')
        time_base = Fraction(stream.time_base)
        for frame in container.decode(stream):
            if frame.pts is None:
                raise ValueError('The source needs explicit frame timestamps.')
            absolute = Fraction(frame.pts) * frame.time_base
            if origin is None:
                origin = absolute
            timestamp = absolute - origin
            if last is not None:
                if timestamp <= last:
                    raise ValueError('The source frame timestamps must increase.')
                previous_delta = timestamp - last
            if timestamp > 600 or count >= 72000:
                raise ValueError('Finish clips up to ten minutes and 72000 frames.')
            image = oriented_image(frame)
            check_dimensions(image, clip)
            duration = Fraction(frame.duration or 0) * frame.time_base
            final_duration = duration if duration > 0 else (previous_delta or 1 / rate)
            digest.update(f'{timestamp.numerator}/{timestamp.denominator}\n'.encode())
            callback(image, count, timestamp, final_duration, time_base, rate)
            count += 1
            last = timestamp
        if count == 0:
            raise ValueError('The source has no video frames.')
        duration = last + final_duration
        if duration > 600 or abs(float(duration) - clip['duration']) > max(.1, 2 / float(rate)):
            raise ValueError('The source duration changed. Import the original clip again.')
        return ({'frames': count, 'timeBase': f'{time_base.numerator}/{time_base.denominator}',
                 'timestampsSha256': digest.hexdigest(), 'duration': float(duration)},
                bool(container.streams.audio), max(0, float(origin - stream_origin)))


def verify_output_clock(output, expected):
    digest, count, first, last, duration = sha256(), 0, None, None, None
    with av.open(str(output)) as container:
        stream = container.streams.video[0]
        if stream.width * stream.height > MAX_PIXELS:
            raise ValueError('Finish video no larger than 4K.')
        for frame in container.decode(stream):
            if frame.pts is None:
                raise ValueError('The exported video lost its frame timestamps.')
            timestamp = Fraction(frame.pts) * frame.time_base
            if first is None:
                first = timestamp
            timestamp -= first
            digest.update(f'{timestamp.numerator}/{timestamp.denominator}\n'.encode())
            count += 1
            last = timestamp
            duration = Fraction(frame.duration or 0) * frame.time_base
        if count != expected['frames'] or digest.hexdigest() != expected['timestampsSha256']:
            raise ValueError('The exported video did not retain the exact source frame clock.')
        if last is None or duration is None or abs(float(last + duration) - expected['duration']) > .001:
            raise ValueError('The exported video did not retain the source duration.')


def preview_video(source, clip, seconds):
    """Decode only through the chosen frame, retaining its global grain index.

    Seeking cannot recover a variable-rate source's exact frame index. Sequential
    decode preserves that index, but an early preview need not decode the tail.
    """
    selected, selected_index = None, None
    with av.open(str(source)) as container:
        if len(container.streams.video) != 1 or len(container.streams.audio) > 1:
            raise ValueError('Use one video track and at most one original audio track.')
        stream = container.streams.video[0]
        if stream.width * stream.height > MAX_PIXELS:
            raise ValueError('Finish video no larger than 4K.')
        rate = stream.average_rate or stream.guessed_rate
        if rate is None or not 0 < float(rate) <= 120 or clip['duration'] > 600:
            raise ValueError('Finish clips up to ten minutes and 120 fps.')
        origin = Fraction(stream.start_time or 0) * stream.time_base
        end = Fraction(0)
        for index, frame in enumerate(container.decode(stream)):
            if index >= 72000 or frame.pts is None:
                raise ValueError('The source needs a supported explicit frame clock.')
            timestamp = Fraction(frame.pts) * frame.time_base - origin
            if timestamp > 600:
                raise ValueError('Finish clips up to ten minutes.')
            selected, selected_index = frame, index
            end = timestamp + (Fraction(frame.duration) * frame.time_base if frame.duration else 1 / rate)
            if float(timestamp) + 1e-6 >= seconds:
                break
        if selected is None or seconds >= float(end):
            raise ValueError('Choose a preview time inside the source clip.')
        image = oriented_image(selected)
        check_dimensions(image, clip)
        return image, selected_index


def process(work):
    source, output = Path(work['source']), Path(work['output'])
    request = work['request']
    if request['format'] != 'aftertake-finishing/1':
        raise ValueError('Use an Aftertake finishing request.')
    settings, clip = validate_settings(request['settings']), request['clip']
    if file_hash(source) != clip['sha256']:
        raise ValueError('The original media changed. Import it again.')
    mode = work.get('mode', 'finish')
    if mode not in ('finish', 'preview'):
        raise ValueError('Use a finishing export or preview.')
    preview_time = work.get('time', 0)
    if mode == 'preview' and (isinstance(preview_time, bool) or not isinstance(preview_time, (float, int)) or
                              not math.isfinite(preview_time) or preview_time < 0 or preview_time >= clip['duration']):
        raise ValueError('Choose a preview time inside the source clip.')
    image = image_source(source)
    clock, has_audio = None, False
    if image is not None:
        check_dimensions(image, clip)
        if mode == 'preview' and preview_time != 0:
            raise ValueError('A still image has a single frame at time zero.')
        if mode == 'finish' and is_identity(settings):
            shutil.copyfile(source, output)
        else:
            apply_finishing(image, settings).save(output, format='PNG')
        kind, duration = 'image', 1
    else:
        kind = 'video'
        if mode == 'finish' and not is_identity(settings) and (clip['width'] % 2 or clip['height'] % 2):
            raise ValueError('Import video with even dimensions for H.264 finishing.')
        encoder, encoded_stream = None, None
        pending_durations = {}
        try:
            if mode == 'finish' and not is_identity(settings):
                encoder = av.open(str(output), 'w', format='mp4')
            def mux_packet(packet):
                # Encoders infer the final packet duration from average_rate,
                # which can differ from a variable-rate source's last frame.
                # Keep only the small encoder-delay window of timing metadata.
                timestamp = Fraction(packet.pts) * packet.time_base
                frame_duration = pending_durations.pop(timestamp)
                ticks = frame_duration / packet.time_base
                if ticks.denominator != 1:
                    raise ValueError('The encoded packet lost the source time base.')
                packet.duration = int(ticks)
                encoder.mux(packet)
            def consume(frame_image, index, timestamp, frame_duration, time_base, rate):
                nonlocal encoded_stream
                if encoder is None:
                    return
                if encoded_stream is None:
                    encoded_stream = encoder.add_stream('libx264', rate=rate)
                    encoded_stream.width, encoded_stream.height = frame_image.size
                    encoded_stream.pix_fmt = 'yuv420p'
                    encoded_stream.time_base = time_base
                    encoded_stream.codec_context.time_base = time_base
                    encoded_stream.options = {'crf': '17', 'preset': 'fast', 'bf': '0'}
                rendered = av.VideoFrame.from_image(apply_finishing(frame_image, settings, index))
                pts, ticks = timestamp / time_base, frame_duration / time_base
                if pts.denominator != 1 or ticks.denominator != 1:
                    raise ValueError('The source frame clock cannot be represented exactly.')
                rendered.pts, rendered.time_base, rendered.duration = int(pts), time_base, int(ticks)
                pending_durations[timestamp] = frame_duration
                for packet in encoded_stream.encode(rendered):
                    mux_packet(packet)
            if mode == 'preview':
                selected, selected_index = preview_video(source, clip, preview_time)
                duration = clip['duration']
                apply_finishing(selected, settings, selected_index).save(output, format='PNG')
            else:
                clock, has_audio, audio_trim_start = video_frames(source, clip, consume)
                duration = clock['duration']
            if mode == 'finish' and encoder is not None:
                for packet in encoded_stream.encode():
                    mux_packet(packet)
                encoder.close()
                encoder = None
                # Exactly one mux from the original; no duplicate audio or generated audio.
                mux_source_audio(output, source, audio_trim_start, duration)
                verify_output_clock(output, clock)
            elif mode == 'finish':
                shutil.copyfile(source, output)
        finally:
            if encoder is not None:
                encoder.close()
        if mode == 'finish':
            with av.open(str(output)) as finished:
                if len(finished.streams.audio) != int(has_audio):
                    raise ValueError('The export did not preserve its original audio track.')
    if file_hash(source) != clip['sha256']:
        output.unlink(missing_ok=True)
        raise ValueError('The original media changed during finishing. Import it again.')
    return {'processor': PROCESSOR, 'sourceSha256': clip['sha256'], 'outputSha256': file_hash(output),
            'width': clip['width'], 'height': clip['height'], 'kind': kind,
            'duration': duration, 'hasAudio': has_audio if mode == 'finish' else False,
            'identity': is_identity(settings), **({'clock': clock} if clock is not None else {})}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('work', nargs='?')
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    if args.check:
        print(json.dumps(preflight()))
        return
    if not args.work:
        parser.error('Supply a private finishing work file.')
    work = json.loads(Path(args.work).read_text(encoding='utf-8'))
    receipt = process(work)
    Path(work['receipt']).write_text(json.dumps(receipt), encoding='utf-8')


if __name__ == '__main__':
    main()
