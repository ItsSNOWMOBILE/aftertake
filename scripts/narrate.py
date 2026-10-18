"""Local, open-weight Kokoro narration. No network calls or voice cloning."""
import hashlib
import json
import os
from pathlib import Path
import sys
from speech_timing import spoken_words

MODEL_HASH = 'beb0d1848dee9a49da392cc3df26958d46cfa35d321edf434f52949153f0df3a'
VOICES_HASH = 'bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d'


def narrate(settings):
    import onnxruntime as rt
    import soundfile as sf
    from kokoro_onnx import Kokoro
    model = Path(settings['models']) / 'kokoro-v1.0.onnx'
    voices = model.with_name('voices-v1.0.bin')
    for filename, expected in [(model, MODEL_HASH), (voices, VOICES_HASH)]:
        if hashlib.file_digest(filename.open('rb'), 'sha256').hexdigest() != expected:
            raise ValueError('Narration weights do not match the pinned open-weight release.')
    options = rt.SessionOptions()
    options.intra_op_num_threads = 2
    options.inter_op_num_threads = 1
    session = rt.InferenceSession(str(model), sess_options=options, providers=['CPUExecutionProvider'])
    kokoro = Kokoro.from_session(session, str(voices))
    voice = settings['voice']
    language='en-gb' if voice.startswith('b') else 'en-us'
    samples, rate, timings = kokoro.create_timed(settings['text'], voice=voice, speed=float(settings['speed']), lang=language)
    extra={}
    if settings.get('timedWords'):
        extra['wordTimingMapper']='phoneme-boundaries/2'
        try:
            extra['wordTiming']={'method':'kokoro-phoneme-durations/1',
                'words':spoken_words(settings['text'],timings,lambda text:kokoro.tokenizer.phonemize(text,language),len(samples)/rate)}
        except ValueError as error:
            extra['wordTimingError']=str(error)
    target = Path(settings['output'])
    temporary = target.with_suffix('.tmp.wav')
    sf.write(str(temporary), samples, rate, subtype='PCM_16')
    os.replace(temporary, target)
    print(json.dumps({'duration': len(samples) / rate, 'model': 'Kokoro-82M v1.0 (Apache-2.0)',
        'modelSha256': MODEL_HASH, 'voicesSha256': VOICES_HASH, 'runner': 'kokoro-onnx 0.6.1 / CPUExecutionProvider',**extra}))


if __name__ == '__main__':
    narrate(json.loads(Path(sys.argv[1]).read_text(encoding='utf-8')))
