"""Plan a storyboard's shot list from one idea with the pinned local CPU language model.

usage: plan-shots.py REQUEST.json --models DIR
The request is {"idea", "shots", "variation", "moves"}; the result, printed as JSON,
is {"title", "look", "shots": [{"prompt", "movement", "seconds"}], "receipt"}.
"""
import argparse
import hashlib
import json
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SYSTEM = (
    'You are a film director planning a short video from one idea. Write a shot list of exactly N shots '
    'that tells the idea as a small story with a beginning, a middle and an end. Each shot prompt describes '
    'only what the camera sees: the subject, the action and the setting, in one or two vivid sentences of '
    'plain visual description. Keep the same characters, place and time of day in every shot so the shots '
    'match, and repeat what the main character looks like. Vary the framing: open wide, go closer, end on a '
    'strong final image. Choose one camera move per shot from the allowed list, and 3, 4 or 5 seconds per shot. '
    'Write the look as one or two sentences that name the main character exactly (age, gender, hair, clothes) '
    'and the shared visual style; it is added to every shot so the same person appears throughout. '
    'Give a short film title of two to four words. '
    'No text, logos or brand names in any shot. Return only the requested JSON.'
)


def sha256(path):
    value = hashlib.sha256()
    with path.open('rb') as file:
        while chunk := file.read(4 * 1024 * 1024):
            value.update(chunk)
    return value.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('request')
    parser.add_argument('--models', required=True)
    args = parser.parse_args()
    request = json.loads(Path(args.request).read_text(encoding='utf-8'))
    count, moves = request['shots'], request['moves']
    if not 3 <= count <= 5 or not 10 <= len(request['idea']) <= 600 or not moves:
        raise ValueError('Invalid storyboard request.')
    model = Path(args.models).resolve()
    manifest = json.loads((ROOT / 'docs/models-script.json').read_text(encoding='utf-8'))
    for file in manifest['files']:
        path = (model / file['path']).resolve()
        if model not in path.parents or path.stat().st_size != file['size'] or sha256(path) != file['sha256']:
            raise ValueError('The local script model differs from its pinned manifest. Run setup-script.py again.')
    import openvino_genai as genai
    import openvino as ov
    started = time.perf_counter()
    pipe = genai.LLMPipeline(model, 'CPU', INFERENCE_NUM_THREADS=8, PERFORMANCE_HINT='LATENCY')
    loaded = time.perf_counter()
    shot = {
        'type': 'object',
        'properties': {
            'prompt': {'type': 'string', 'minLength': 20, 'maxLength': 500},
            'movement': {'enum': moves},
            'seconds': {'enum': [3, 4, 5]},
        },
        'required': ['prompt', 'movement', 'seconds'],
        'additionalProperties': False,
    }
    schema = {
        'type': 'object',
        'properties': {
            'title': {'type': 'string', 'minLength': 2, 'maxLength': 40},
            'look': {'type': 'string', 'minLength': 10, 'maxLength': 290},
            'shots': {'type': 'array', 'items': shot, 'minItems': count, 'maxItems': count},
        },
        'required': ['title', 'look', 'shots'],
        'additionalProperties': False,
    }
    variation = request.get('variation', 0)
    history = genai.ChatHistory([
        {'role': 'system', 'content': SYSTEM},
        {'role': 'user', 'content': json.dumps({'idea': request['idea'], 'N': count}, ensure_ascii=False)},
    ])
    history.set_extra_context({'enable_thinking': False})
    config = genai.GenerationConfig(
        max_new_tokens=300 + 180 * count, do_sample=variation > 0, temperature=0.7, top_p=0.9,
        rng_seed=4090 + variation,
        structured_output_config=genai.StructuredOutputConfig(json_schema=json.dumps(schema)))
    plan = json.loads(pipe.generate(history, config).texts[0])
    finished = time.perf_counter()
    if len(plan['shots']) != count:
        raise ValueError('The local model returned the wrong number of shots. Plan again.')
    plan['receipt'] = {
        'model': 'Qwen3-4B / OpenVINO INT4',
        'revision': manifest['revision'],
        'runtime': 'OpenVINO ' + ov.get_version(),
        'device': 'CPU',
        'seconds': round(finished - started, 1),
        'loadSeconds': round(loaded - started, 1),
    }
    print(json.dumps(plan))


if __name__ == '__main__':
    main()
