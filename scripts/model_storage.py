"""Remember an optional model disk; keep all existing Comfy model paths active."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / '.runtime' / 'model-storage.json'
CATEGORIES = ('diffusion_models', 'text_encoders', 'clip_vision', 'vae', 'loras', 'latent_upscale_models', 'checkpoints', 'geometry_estimation')


def model_root(directory=None):
    if directory is not None:
        target = Path(directory).expanduser().resolve()
        target.mkdir(parents=True, exist_ok=True)
        CONFIG.parent.mkdir(parents=True, exist_ok=True)
        CONFIG.write_text(json.dumps({'directory': str(target)}, indent=2) + '\n', encoding='utf-8')
        return target
    if CONFIG.exists():
        target = Path(json.loads(CONFIG.read_text(encoding='utf-8'))['directory'])
        if not target.is_absolute():
            raise ValueError('The saved model directory must be an absolute path.')
        if not target.is_dir():
            raise ValueError(f'The saved model disk is unavailable: {target}. Reconnect it or choose --models-dir.')
        return target
    return ROOT / '.runtime' / 'ComfyUI' / 'models'


def extra_model_config(directory):
    """JSON is valid YAML, which avoids another setup-time dependency."""
    target = ROOT / '.runtime' / 'extra-model-paths.yaml'
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps({'aftertake': {'base_path': str(directory), **{name: name for name in CATEGORIES}}}, indent=2) + '\n', encoding='utf-8')
    return target
