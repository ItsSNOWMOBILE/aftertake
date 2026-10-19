"""Original Aftertake music/sound design. Pure CPU synthesis; no audio samples.

Generator: MIT. Newly synthesized music: CC0-1.0. Common chord voicings and
original event placement only; no recording or melody from the reference film.
Narration is measured to set a ducking envelope, never mixed into this WAV.
"""
from fractions import Fraction
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import wave

import imageio_ffmpeg
import numpy as np

FOLDER = Path(__file__).resolve().parent
ROOT = FOLDER.parents[1]
RATE, FPS, FRAMES, SEED = 48000, 24, 936, 20261019
DURATION = FRAMES / FPS
SAMPLES = round(DURATION * RATE)
TARGET_LUFS, MAX_PEAK_DBFS = -25.0, -12.25
EVENTS = []
RNG = np.random.default_rng(SEED)
WINDOWS = [
    ('01-one', 0.0), ('01-three', 0.7273333333333333), ('02-character', 7.0), ('03-finish', 11.375),
    ('04-create', 14.125), ('05-ad', 18.25), ('06-agent', 24.125),
    ('07-open', 28.125), ('08-reveal', 32.125), ('09-close', 35.125),
]
MARKERS = [
    ('three-dancer reveal', Fraction(18, 24)),
    ('brand card', Fraction(73, 24)),
    ('character result', Fraction(216, 24)),
    ('finishing result', Fraction(301, 24)),
    ('create result', Fraction(360, 24)),
    ('ad montage', Fraction(432, 24)),
    ('agent workspace', Fraction(576, 24)),
    ('open weights', Fraction(672, 24)),
    ('made in Aftertake reveal', Fraction(768, 24)),
    ('closing call to action', Fraction(840, 24)),
]


def digest(file):
    with Path(file).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def db(value):
    return 20 * math.log10(max(float(value), 1e-15))


def rms(signal):
    return float(np.sqrt(np.mean(np.square(signal))))


def frequency(midi):
    return 440 * 2**((midi - 69) / 12)


def stereo(mono, pan=0):
    angle = (np.clip(pan, -1, 1) + 1) * np.pi / 4
    if np.ndim(angle):
        return np.column_stack([mono * np.cos(angle), mono * np.sin(angle)])
    return np.column_stack([mono * np.cos(angle), mono * np.sin(angle)])


def add(stem, sound, when, kind, **metadata):
    start = round(float(when) * RATE)
    if start < 0:
        sound = sound[-start:]
        start = 0
    length = min(len(sound), len(stem) - start)
    if length > 0:
        stem[start:start + length] += sound[:length]
    EVENTS.append({'kind': kind, 'seconds': float(when), 'sample': round(float(when) * RATE), **metadata})


def taper(t, attack, release):
    envelope = (1 - np.exp(-t / attack)) ** 2
    tail = np.clip((t[-1] - t) / release, 0, 1)
    return envelope * (np.sin(tail * np.pi / 2) ** 2)


def felt(midi, duration, amplitude, pan):
    t = np.arange(round(duration * RATE)) / RATE
    f = frequency(midi)
    phase = RNG.uniform(0, 2 * np.pi)
    # Softly detuned, band-limited partials; slow attack avoids UI-like beeps.
    tone = (np.sin(2 * np.pi * f * t + phase) +
            .13 * np.sin(2 * np.pi * f * 2.001 * t + phase * .7) +
            .045 * np.sin(2 * np.pi * f * 3 * t + .4))
    envelope = taper(t, .024, .24) * np.exp(-t / 1.35)
    return stereo(tone * envelope * amplitude, pan)


def sub(midi, duration, amplitude):
    t = np.arange(round(duration * RATE)) / RATE
    tone = np.sin(2 * np.pi * frequency(midi) * t)
    envelope = taper(t, .018, .2) * np.exp(-t / .65)
    return stereo(tone * envelope * amplitude)


def filtered_noise(duration, low, high):
    size = round(duration * RATE)
    spectrum = np.fft.rfft(RNG.standard_normal(size))
    f = np.fft.rfftfreq(size, 1 / RATE)
    # Smooth Gaussian shoulders avoid narrow ringing or harsh brick-wall edges.
    center, spread = (low + high) / 2, (high - low) / 2
    weight = np.exp(-.5 * ((f - center) / spread) ** 4)
    weight[f < 200] = 0
    result = np.fft.irfft(spectrum * weight, n=size)
    return result / max(rms(result), 1e-9)


def kick(amplitude):
    t = np.arange(round(.19 * RATE)) / RATE
    phase = 2 * np.pi * (46 * t + 31 * .022 * (1 - np.exp(-t / .022)))
    envelope = (1 - np.exp(-t / .0017)) * np.exp(-t / .047)
    sound = np.sin(phase) * envelope
    sound *= np.sin(np.clip((t[-1] - t) / .018, 0, 1) * np.pi / 2) ** 2
    return stereo(sound * amplitude)


def hat(amplitude, pan):
    t = np.arange(round(.038 * RATE)) / RATE
    noise = filtered_noise(.038, 4300, 9200)
    envelope = (1 - np.exp(-t / .0008)) * np.exp(-t / .0067)
    envelope *= np.sin(np.clip((t[-1] - t) / .008, 0, 1) * np.pi / 2) ** 2
    return stereo(noise * envelope * amplitude, pan)


def swish(amplitude, duration=.21):
    t = np.arange(round(duration * RATE)) / RATE
    noise = filtered_noise(duration, 850, 4800)
    envelope = np.sin(np.pi * t / duration) ** 2.5
    return stereo(noise * envelope * amplitude, np.linspace(-.3, .3, len(t)))


def soft_space(signal):
    result = signal.copy()
    for seconds, gain, swap in [(.087, .14, True), (.159, .09, False), (.271, .045, True)]:
        delay = round(seconds * RATE)
        tail = signal[:-delay, ::-1] if swap else signal[:-delay]
        result[delay:] += tail * gain
    return result


def compose():
    keys = np.zeros((SAMPLES, 2), dtype=np.float64)
    rhythm, bass, air = np.zeros_like(keys), np.zeros_like(keys), np.zeros_like(keys)
    chords = {
        'Cmaj9': [48, 52, 55, 59, 62],
        'Am9': [45, 48, 52, 55, 59],
        'Fmaj9': [41, 45, 48, 52, 55],
        'G6': [43, 47, 50, 52, 57],
    }
    changes = [
        (.06, 'Cmaj9', .55), (.75, 'Cmaj9', .85), (73 / 24, 'Am9', .72),
        (6, 'Cmaj9', .75), (11 + 1 / 24, 'Fmaj9', .8), (14, 'G6', .7),
        (18, 'Cmaj9', .85), (21.5, 'Cmaj9', .45), (24, 'Am9', .72),
        (28, 'Fmaj9', .8), (32, 'G6', .75), (35, 'Cmaj9', .9),
    ]
    for when, name, strength in changes:
        for note, pan in zip(chords[name], [-.48, -.25, 0, .25, .48]):
            add(keys, felt(note, 3.4, .045 * strength, pan), when, 'warm chord', chord=name, midi=note)
        add(bass, sub(chords[name][0] - 12, 1.35, .022 * strength), when + .04, 'soft sub', chord=name)
    # Sparse, original two-note answers occur in gaps rather than a constant arp.
    for when, note in [(4.45, 64), (5.15, 62), (10.15, 59), (10.65, 55),
                       (16.4, 62), (17.2, 64), (26.8, 59), (31.1, 57), (37.05, 60)]:
        add(keys, felt(note, 1.05, .011, -.15 if note % 2 else .18), when, 'felt answer', midi=note)
    # Each section restarts a restrained 120-BPM half-note pulse at its actual
    # editorial anchor. Odd frame boundaries are retained instead of retiming cuts.
    sections = [(.75, 73 / 24, .75), (4, 6, .65), (6, 11 + 1 / 24, .7),
                (11 + 1 / 24, 14, .65), (14, 18, .65), (18, 22.5, .8),
                (24, 28, .55), (28, 32, .5), (32, 35, .65), (35, 37, .55)]
    for start, end, strength in sections:
        index = 0
        while start + index * .5 < end - .13:
            when = start + index * .5
            if index % 2 == 0:
                add(rhythm, kick(.045 * strength), when, 'muted kick', sectionStart=start)
            if index % 4 != 3 and when + .25 < end - .07:
                add(rhythm, hat(.012 * strength, -.12 if index % 2 else .12), when + .25,
                    'closed hat', sectionStart=start)
            index += 1
    for label, time in MARKERS:
        add(air, swish(.0075 if float(time) not in (.75, 18) else .011),
            float(time) - .10, 'short transition air', marker=label, peakAt=float(time))
    signal = soft_space(keys) + rhythm + bass + air
    # Remove numerical DC without aggressive filters or a dynamic mastering chain.
    signal -= np.mean(signal, axis=0, keepdims=True)
    return signal


def voice_windows():
    windows = []
    receipts = json.loads((FOLDER / 'voice-receipts.json').read_text(encoding='utf-8'))
    by_id = {receipt['id']: receipt for receipt in receipts}
    for identity, start in WINDOWS:
        file = FOLDER / 'voices' / f'{identity}.wav'
        with wave.open(str(file), 'rb') as source:
            assert source.getsampwidth() == 2
            signal = np.frombuffer(source.readframes(source.getnframes()), '<i2').astype(np.float64) / 32768
            duration = len(signal) / source.getnchannels() / source.getframerate()
        assert digest(file) == by_id[identity]['asset']['sha256']
        windows.append({'id': identity, 'start': start, 'end': start + duration,
                        'voiceRms': rms(signal), 'marginDb': 10, 'sha256': digest(file)})
    # This native Film export has its own intentionally retained voice. Its
    # already-mastered audio is measured at the producer's sourceVolume .3.
    source = ROOT / 'examples/spoken-type/result.mp4'
    result = subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-v', 'error', '-t', '1.5',
                             '-i', str(source), '-vn', '-af', 'volume=0.3', '-ac', '2', '-ar', str(RATE),
                             '-f', 'f32le', '-'], capture_output=True, check=True,
                            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
    native = np.frombuffer(result.stdout, '<f4').astype(np.float64)
    windows.append({'id': 'embedded-ad-voice', 'start': 22.5, 'end': 24.0,
                    'voiceRms': rms(native), 'marginDb': 15, 'sha256': digest(source),
                    'sourceVolume': .3})
    return windows


def ducked(signal, gain, windows):
    envelope = np.ones(SAMPLES)
    for window in windows:
        start, end = round(window['start'] * RATE), round(window['end'] * RATE)
        region = signal[start:end] * gain
        ceiling = window['voiceRms'] * 10**(-window['marginDb'] / 20)
        scale = min(1, ceiling / max(rms(region), 1e-15))
        # Brief transients may sit a little above average speech RMS, but stay
        # far below its speech peaks; the full-window energy margin dominates.
        scale = min(scale, window['voiceRms'] * 10**(3 / 20) / max(float(np.max(np.abs(region))), 1e-15))
        before, after = min(round(.12 * RATE), start), min(round(.24 * RATE), SAMPLES - end)
        if before:
            ramp = 1 - (1 - scale) * (.5 - .5 * np.cos(np.linspace(0, np.pi, before)))
            envelope[start - before:start] = np.minimum(envelope[start - before:start], ramp)
        envelope[start:end] = np.minimum(envelope[start:end], scale)
        if after:
            ramp = scale + (1 - scale) * (.5 - .5 * np.cos(np.linspace(0, np.pi, after)))
            envelope[end:end + after] = np.minimum(envelope[end:end + after], ramp)
    output = signal * gain * envelope[:, None]
    beginning, ending = round(.065 * RATE), round(1.75 * RATE)
    output[:beginning] *= np.sin(np.linspace(0, np.pi / 2, beginning))[:, None] ** 2
    output[-ending:] *= np.cos(np.linspace(0, np.pi / 2, ending))[:, None] ** 2
    output[-1] = 0
    return output, envelope


def write_wav(file, signal):
    # PCM24 keeps quiet ducked detail without dithering nondeterminism.
    integers = np.rint(np.clip(signal, -1, 1 - 2**-23) * (2**23)).astype('<i4')
    packed = integers.view(np.uint8).reshape(-1, 4)[:, :3].tobytes()
    with wave.open(str(file), 'wb') as target:
        target.setnchannels(2)
        target.setsampwidth(3)
        target.setframerate(RATE)
        target.writeframes(packed)


def loudness(file):
    result = subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-hide_banner', '-i', str(file),
                             '-af', 'loudnorm=I=-24:TP=-1.5:LRA=7:print_format=json', '-f', 'null', '-'],
                            capture_output=True, check=True, text=True,
                            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
    values = json.loads(result.stderr[result.stderr.rfind('{'):result.stderr.rfind('}') + 1])
    return {key: float(values[key]) for key in ('input_i', 'input_tp', 'input_lra')}


def main():
    signal, windows = compose(), voice_windows()
    # First leave generous peak headroom; then seek the loudness target with
    # scalar gain only, recomputing voice ceilings after every adjustment.
    maximum_gain = 10**(MAX_PEAK_DBFS / 20) / np.max(np.abs(signal))
    gain = maximum_gain * .7
    temporary = FOLDER / 'music-bed.preview.wav'
    for _ in range(5):
        music, envelope = ducked(signal, gain, windows)
        write_wav(temporary, music)
        measured = loudness(temporary)
        delta = TARGET_LUFS - measured['input_i']
        proposed = min(maximum_gain, gain * 10**(delta / 20))
        if abs(delta) < .15 or abs(proposed - gain) < 1e-7:
            break
        gain = proposed
    destination = FOLDER / 'music-bed.wav'
    os.replace(temporary, destination)
    report = []
    for window in windows:
        region = music[round(window['start'] * RATE):round(window['end'] * RATE)]
        margin = db(window['voiceRms']) - db(rms(region))
        assert margin >= window['marginDb'] - .02
        report.append({'id': window['id'], 'start': window['start'], 'end': window['end'],
                       'voiceRmsDbfs': db(window['voiceRms']), 'bedRmsDbfs': db(rms(region)),
                       'voiceToBedRmsMarginDb': margin,
                       'bedPeakDbfs': db(np.max(np.abs(region)))})
    assert len(music) == 39 * RATE and db(np.max(np.abs(music))) <= -12
    assert np.isfinite(music).all() and np.count_nonzero(np.abs(music) >= 1) == 0
    assert float(np.max(np.abs(music[-480:]))) < .0001
    markers = [{'label': label, 'frame': int(time * FPS), 'seconds': float(time),
                'sample': int(time * RATE)} for label, time in MARKERS]
    checks = {'format': 'aftertake-original-music/1', 'title': 'More possibilities — original demo bed',
              'generator': Path(__file__).name, 'generatorSha256': digest(__file__),
              'audio': destination.name, 'audioSha256': digest(destination),
              'musicLicense': 'CC0-1.0', 'generatorLicense': 'MIT',
              'provenance': 'Original CPU oscillator/noise synthesis and event arrangement created for Aftertake. No third-party samples, music recordings or reference-film audio used. Narration was only measured to set ducking; no narration is embedded.',
              'duration': DURATION, 'sampleRate': RATE, 'channels': 2, 'bitsPerSample': 24,
              'samplesPerChannel': SAMPLES, 'pictureFrames': FRAMES, 'pictureFPS': FPS, 'seed': SEED,
              'measuredLoudness': measured, 'samplePeakDbfs': db(np.max(np.abs(music))),
              'rmsDbfs': db(rms(music)), 'clippedSamples': int(np.count_nonzero(np.abs(music) >= 1)),
              'last10msMaximum': float(np.max(np.abs(music[-480:]))),
              'suggestedFilmVolume': 1, 'alreadyDuckedForSuppliedVoiceWindows': True,
              'voiceWindows': report, 'featureMarkers': markers,
              'reviewScope': 'Waveform, clipping, exact sample/frame grid, measured loudness and narration margins. No claim of human listening or full-film creative approval.'}
    (FOLDER / 'music-provenance.json').write_text(json.dumps(checks, indent=2), encoding='utf-8')
    (FOLDER / 'music-events.json').write_text(json.dumps({'featureMarkers': markers, 'events': EVENTS}, indent=2), encoding='utf-8')
    subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-v', 'error', '-y', '-i', str(destination),
                    '-filter_complex', '[0:a]volume=4,showwavespic=s=1560x360:split_channels=1:colors=0xd5e991|0xa6bddd:scale=lin[wave]',
                    '-map', '[wave]', '-frames:v', '1', str(FOLDER / 'music-waveform.png')],
                   check=True, capture_output=True,
                   creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
    print(json.dumps({'audio': str(destination), 'duration': DURATION, 'measured': measured,
                      'peakDbfs': checks['samplePeakDbfs'], 'voiceMinimumMarginDb': min(r['voiceToBedRmsMarginDb'] for r in report),
                      'sha256': checks['audioSha256']}))


if __name__ == '__main__':
    main()
