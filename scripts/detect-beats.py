"""Estimate tempo and beat times in a music track for cutting Film shots to the beat."""
import json
import math
from pathlib import Path
import sys
import av
import numpy as np

RATE = 22050
FFT = 2048
HOP = 512
METHOD = 'spectral-flux-dp/1'


def decode(path):
    """Mono float samples at 22.05 kHz, at most ten minutes."""
    chunks = []
    with av.open(str(path)) as container:
        if not container.streams.audio:
            raise ValueError('This media has no audio track.')
        resampler = av.AudioResampler(format='flt', layout='mono', rate=RATE)
        for frame in container.decode(audio=0):
            for converted in resampler.resample(frame):
                chunks.append(converted.to_ndarray().reshape(-1))
        for converted in resampler.resample(None):
            chunks.append(converted.to_ndarray().reshape(-1))
    samples = np.concatenate(chunks).astype(np.float32) if chunks else np.zeros(0, np.float32)
    if not RATE * .5 <= len(samples) <= RATE * 600:
        raise ValueError('Use audio between half a second and ten minutes.')
    return samples


def onset_envelope(samples):
    """Half-wave rectified log-spectral flux, one value per 512-sample hop."""
    padded = np.pad(samples, FFT // 2)
    count = 1 + (len(padded) - FFT) // HOP
    window = np.hanning(FFT).astype(np.float32)
    previous = None
    envelope = np.zeros(count, np.float32)
    for first in range(0, count, 512):
        frames = np.lib.stride_tricks.sliding_window_view(padded, FFT)[first * HOP:(first + 512) * HOP:HOP]
        spectrum = np.log1p(100 * np.abs(np.fft.rfft(frames * window, axis=1)))
        if previous is not None:
            spectrum_with_previous = np.vstack([previous, spectrum])
        else:
            spectrum_with_previous = np.vstack([spectrum[:1], spectrum])
        flux = np.maximum(0, np.diff(spectrum_with_previous, axis=0)).mean(axis=1)
        envelope[first:first + len(flux)] = flux
        previous = spectrum[-1:]
    # Remove the slowly varying loudness so beats in quiet passages still count.
    width = max(1, round(.5 * RATE / HOP))
    local = np.convolve(envelope, np.ones(width) / width, mode='same')
    envelope = np.maximum(0, envelope - local)
    peak = envelope.max()
    return envelope / peak if peak > 0 else envelope


def estimate_period(envelope):
    """Beat period in hops from the onset autocorrelation, weighted toward ~120 BPM."""
    centered = envelope - envelope.mean()
    size = 1 << (2 * len(centered) - 1).bit_length()
    spectrum = np.fft.rfft(centered, size)
    correlation = np.fft.irfft(spectrum * np.conj(spectrum), size)[:len(centered)]
    fps = RATE / HOP
    low, high = math.floor(fps * 60 / 200), math.ceil(fps * 60 / 60)
    if high + 1 >= len(correlation):
        raise ValueError('The audio is too short to estimate a tempo.')
    lags = np.arange(low, high + 1)
    bpm = 60 * fps / lags
    prior = np.exp(-.5 * (np.log2(bpm / 120) / .9) ** 2)
    scores = correlation[lags] * prior
    best = int(np.argmax(scores))
    # Alternating kick/snare patterns favor twice the period. Prefer the faster
    # pulse when it is still clearly periodic: a grid that is too fast is fixed by
    # cutting every second beat, while a missing half-beat cannot be recovered.
    half = round(lags[best] / 2)
    peak = lambda lag: np.maximum(correlation[lag - 1:lag + 2], 0).sum()
    if half - 1 >= low and peak(half) >= .3 * peak(int(lags[best])):
        best = int(np.argmax(np.where(np.abs(lags - lags[best] / 2) <= 1, scores, -np.inf)))
    lag = float(lags[best])
    if 0 < best < len(scores) - 1:
        left, middle, right = scores[best - 1:best + 2]
        divisor = left - 2 * middle + right
        if divisor:
            lag += .5 * (left - right) / divisor
    return lag


def track(envelope, period, tightness=100):
    """Dynamic-programming beat tracker (Ellis, 2007) on a fixed tempo."""
    count = len(envelope)
    score = envelope.astype(np.float64).copy()
    backlink = np.full(count, -1)
    offsets = np.arange(-round(2 * period), -round(period / 2) + 1)
    penalty = -tightness * np.log(-offsets / period) ** 2
    for index in range(count):
        candidates = index + offsets
        valid = candidates >= 0
        if not valid.any():
            continue
        options = score[candidates[valid]] + penalty[valid]
        best = int(np.argmax(options))
        if options[best] > 0:
            score[index] += options[best]
            backlink[index] = candidates[valid][best]
    tail = max(0, count - round(period))
    beat = tail + int(np.argmax(score[tail:]))
    beats = []
    while beat >= 0:
        beats.append(beat)
        beat = backlink[beat]
    return np.array(beats[::-1])


def analyse(path):
    samples = decode(path)
    envelope = onset_envelope(samples)
    period = estimate_period(envelope)
    frames = track(envelope, period)
    times = frames * HOP / RATE
    duration = len(samples) / RATE
    times = times[(times >= 0) & (times <= duration)]
    strengths = envelope[frames[:len(times)]]
    # The strongest of the four bar phases is a likely downbeat grid.
    phase = int(np.argmax([strengths[offset::4].sum() for offset in range(min(4, len(times)))])) if len(times) else 0
    return {
        'method': METHOD,
        'tempo': round(60 * RATE / HOP / period, 3),
        'duration': round(duration, 6),
        'beats': [round(float(time), 4) for time in times],
        'downbeats': [round(float(time), 4) for time in times[phase::4]],
    }


if __name__ == '__main__':
    print(json.dumps(analyse(Path(sys.argv[1]))))
