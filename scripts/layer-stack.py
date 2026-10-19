"""Independent, bounded still-image layer compositor.

Blend equations follow W3C Compositing and Blending Level 1, not another
editor's implementation. Pixel math only; no inference or Torch dependency.
"""

import argparse
import importlib.util
import json
import math
from pathlib import Path
from hashlib import sha256
import warnings

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageOps

PROCESSOR = "aftertake-cpu-layer-stack/1"
MAX_SOURCE = 16777216
MAX_CANVAS = 4194304
Image.MAX_IMAGE_PIXELS = MAX_SOURCE
MODES = {
    "normal",
    "dissolve",
    "darken",
    "multiply",
    "color-burn",
    "linear-burn",
    "darker-color",
    "lighten",
    "screen",
    "color-dodge",
    "linear-dodge",
    "lighter-color",
    "overlay",
    "soft-light",
    "hard-light",
    "vivid-light",
    "linear-light",
    "pin-light",
    "hard-mix",
    "difference",
    "exclusion",
    "subtract",
    "divide",
    "hue",
    "saturation",
    "color",
    "luminosity",
}
spec = importlib.util.spec_from_file_location(
    "aftertake_finishing", Path(__file__).with_name("finish-media.py")
)
finishing = importlib.util.module_from_spec(spec)
spec.loader.exec_module(finishing)


def digest(path):
    result = sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def inspect_image(path):
    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        with Image.open(path) as image:
            width, height = image.size
            if image.format not in ("PNG", "JPEG", "WEBP") or getattr(image, "n_frames", 1) != 1:
                raise ValueError("Use a single PNG, JPEG or WebP still image.")
            if not (1 <= width <= 16384 and 1 <= height <= 16384 and width * height <= MAX_SOURCE):
                raise ValueError(
                    "Source images must be at most sixteen megapixels and 16384 pixels per side."
                )
            orientation = image.getexif().get(274, 1)
            if orientation in (5, 6, 7, 8):
                width, height = height, width
            return {"width": width, "height": height, "sha256": digest(path)}


def load_image(path):
    inspect_image(path)  # inspect dimensions before any full decoder allocation
    with Image.open(path) as image:
        return ImageOps.exif_transpose(image).convert("RGBA")


def luminosity(rgb):
    return np.sum(rgb * np.array([0.3, 0.59, 0.11], dtype=np.float32), axis=-1, keepdims=True)


def set_luminosity(rgb, target):
    moved = rgb + target - luminosity(rgb)
    center = luminosity(moved)
    low, high = moved.min(axis=-1, keepdims=True), moved.max(axis=-1, keepdims=True)
    moved = np.where(
        low < 0, center + (moved - center) * center / np.maximum(center - low, 1e-12), moved
    )
    return np.where(
        high > 1, center + (moved - center) * (1 - center) / np.maximum(high - center, 1e-12), moved
    )


def set_saturation(rgb, target):
    low, high = rgb.min(axis=-1, keepdims=True), rgb.max(axis=-1, keepdims=True)
    return np.where(high > low, (rgb - low) * target / np.maximum(high - low, 1e-12), 0)


def blend_rgb(backdrop, source, mode):
    """Straight encoded-sRGB blend colors, with explicit finite edge behavior."""
    b, s = backdrop, source
    if mode in ("normal", "dissolve"):
        return s
    if mode == "multiply":
        return b * s
    if mode == "screen":
        return 1 - (1 - b) * (1 - s)
    if mode == "darken":
        return np.minimum(b, s)
    if mode == "lighten":
        return np.maximum(b, s)
    if mode == "overlay":
        return np.where(b <= 0.5, 2 * b * s, 1 - 2 * (1 - b) * (1 - s))
    if mode == "hard-light":
        return np.where(s <= 0.5, 2 * b * s, 1 - 2 * (1 - b) * (1 - s))
    if mode == "soft-light":
        curve = np.where(b <= 0.25, ((16 * b - 12) * b + 4) * b, np.sqrt(b))
        return np.where(s <= 0.5, b - (1 - 2 * s) * b * (1 - b), b + (2 * s - 1) * (curve - b))
    if mode == "difference":
        return np.abs(b - s)
    if mode == "exclusion":
        return b + s - 2 * b * s
    if mode == "linear-dodge":
        return np.minimum(1, b + s)
    if mode == "linear-burn":
        return np.maximum(0, b + s - 1)
    if mode == "subtract":
        return np.maximum(0, b - s)
    if mode == "divide":
        return np.where(s > 0, np.minimum(1, b / np.maximum(s, 1e-12)), np.where(b > 0, 1, 0))
    if mode == "color-dodge":
        return np.where(b <= 0, 0, np.where(s >= 1, 1, np.minimum(1, b / np.maximum(1 - s, 1e-12))))
    if mode == "color-burn":
        return np.where(
            b >= 1, 1, np.where(s <= 0, 0, 1 - np.minimum(1, (1 - b) / np.maximum(s, 1e-12)))
        )
    if mode == "vivid-light":
        return np.where(
            s <= 0.5, blend_rgb(b, 2 * s, "color-burn"), blend_rgb(b, 2 * s - 1, "color-dodge")
        )
    if mode == "linear-light":
        return np.clip(b + 2 * s - 1, 0, 1)
    if mode == "pin-light":
        return np.where(s <= 0.5, np.minimum(b, 2 * s), np.maximum(b, 2 * s - 1))
    if mode == "hard-mix":
        return (blend_rgb(b, s, "vivid-light") >= 0.5).astype(np.float32)
    if mode == "darker-color":
        return np.where(s.sum(axis=-1, keepdims=True) < b.sum(axis=-1, keepdims=True), s, b)
    if mode == "lighter-color":
        return np.where(s.sum(axis=-1, keepdims=True) > b.sum(axis=-1, keepdims=True), s, b)
    sb = b.max(axis=-1, keepdims=True) - b.min(axis=-1, keepdims=True)
    ss = s.max(axis=-1, keepdims=True) - s.min(axis=-1, keepdims=True)
    if mode == "hue":
        return set_luminosity(set_saturation(s, sb), luminosity(b))
    if mode == "saturation":
        return set_luminosity(set_saturation(b, ss), luminosity(b))
    if mode == "color":
        return set_luminosity(s, luminosity(b))
    if mode == "luminosity":
        return set_luminosity(b, luminosity(s))
    raise ValueError("Unknown layer blend mode.")


def dissolve(coverage, seed):
    # Explicit saved seed and full-canvas row order: reimported IDs cannot alter it.
    random = np.random.Generator(np.random.PCG64(seed)).random(coverage.shape, dtype=np.float32)
    return (random < coverage).astype(np.float32)


def composite_rgba(backdrop, source, opacity=1, mode="normal", seed=42, clip=None):
    if opacity == 0:
        return backdrop.copy()
    b, s = backdrop.astype(np.float32) / 255, source.astype(np.float32) / 255
    ab, coverage = b[..., 3:4], s[..., 3:4] * opacity
    if clip is not None:
        coverage *= clip[..., None]
    if mode == "dissolve":
        coverage = dissolve(coverage, seed)
    if clip is not None:
        # A clipped contribution colors existing coverage; it cannot create new
        # opacity. Normalize against the current composite alpha, rather than
        # multiplying the base's alpha twice when it is the only lower layer.
        coverage = np.minimum(coverage, ab)
        alpha = ab
        premult = coverage * blend_rgb(b[..., :3], s[..., :3], mode) + (ab - coverage) * b[..., :3]
    else:
        alpha = coverage + ab * (1 - coverage)
        mixed = (1 - ab) * s[..., :3] + ab * blend_rgb(b[..., :3], s[..., :3], mode)
        premult = coverage * mixed + (1 - coverage) * ab * b[..., :3]
    rgb = np.divide(premult, alpha, out=np.zeros_like(premult), where=alpha > 0)
    result = np.rint(np.clip(np.concatenate([rgb, alpha], axis=2), 0, 1) * 255).astype(np.uint8)
    result[coverage[..., 0] == 0] = backdrop[coverage[..., 0] == 0]
    return result


def mask_image(mask, size, assets):
    if not mask or not mask.get("enabled", True):
        return Image.new("L", size, 255)
    if mask["kind"] == "image":
        image = load_image(assets[mask["source"]["assetId"]])
        if mask["channel"] == "alpha":
            image = image.getchannel("A")
        else:
            values = (
                np.asarray(ImageOps.grayscale(image)).astype(np.float32)
                * np.asarray(image.getchannel("A"))
                / 255
            )
            image = Image.fromarray(np.rint(values).astype(np.uint8))
        image = image.resize(size, Image.Resampling.LANCZOS)
    else:
        x, y = mask["x"] * size[0], mask["y"] * size[1]
        width, height = mask["width"] * size[0], mask["height"] * size[1]
        xx = (np.arange(size[0], dtype=np.float32) + 0.5)[None, :]
        yy = (np.arange(size[1], dtype=np.float32) + 0.5)[:, None]
        if mask["kind"] == "rectangle":
            selected = (xx >= x) & (xx < x + width) & (yy >= y) & (yy < y + height)
        else:
            selected = ((xx - x - width / 2) / (width / 2)) ** 2 + (
                (yy - y - height / 2) / (height / 2)
            ) ** 2 <= 1
        image = Image.fromarray(selected.astype(np.uint8) * 255)
    if mask.get("invert", False):
        image = ImageOps.invert(image)
    grow = mask.get("grow", 0)
    if grow:
        image = image.filter(
            ImageFilter.MaxFilter(2 * grow + 1)
            if grow > 0
            else ImageFilter.MinFilter(-2 * grow + 1)
        )
    if mask.get("feather", 0):
        image = image.filter(ImageFilter.GaussianBlur(mask["feather"]))
    return image


def media_canvas(image, layer, canvas, assets):
    transform = layer.get("transform", {})
    alpha = np.asarray(image.getchannel("A")).astype(np.float32)
    if layer.get("mask"):
        alpha *= np.asarray(mask_image(layer["mask"], image.size, assets)).astype(np.float32) / 255
        image = image.copy()
        image.putalpha(Image.fromarray(np.rint(alpha).astype(np.uint8)))
    width, height = canvas
    fit = min(width / image.width, height / image.height) * transform.get("scale", 1)
    angle = math.radians(transform.get("rotation", 0))
    c, s = math.cos(angle), math.sin(angle)
    sx = -fit if transform.get("flipX", False) else fit
    # Source center -> fixed canvas center + normalized translation. Inverse map
    # renders directly to bounded output; a 4x scale never allocates a 4x image.
    a, b, d, e = c * sx, -s * fit, s * sx, c * fit
    det = a * e - b * d
    cx, cy = width * (0.5 + transform.get("x", 0)), height * (0.5 + transform.get("y", 0))
    ia, ib, id_, ie = e / det, -b / det, -d / det, a / det
    matrix = (
        ia,
        ib,
        image.width / 2 - ia * cx - ib * cy,
        id_,
        ie,
        image.height / 2 - id_ * cx - ie * cy,
    )
    if image.size == canvas and matrix == (1, 0, 0, 0, 1, 0):
        return np.asarray(image).copy()
    premult = image.convert("RGBa").transform(
        canvas, Image.Transform.AFFINE, matrix, Image.Resampling.BICUBIC, fillcolor=(0, 0, 0, 0)
    )
    return np.asarray(premult.convert("RGBA")).copy()


def finite(value, low, high, integer=False):
    return (
        type(value) in ((int,) if integer else (int, float))
        and math.isfinite(value)
        and low <= value <= high
    )


def validate_request(request):
    if request.get("format") != "aftertake-layer-stack/1":
        raise ValueError("Unknown layer project format.")
    canvas = request["canvas"]
    width, height = canvas["width"], canvas["height"]
    if (
        not finite(width, 1, 4096, True)
        or not finite(height, 1, 4096, True)
        or width * height > MAX_CANVAS
    ):
        raise ValueError("Keep the canvas within four megapixels.")
    layers = request["layers"]
    if not 1 <= len(layers) <= 8 or not any(layer["type"] == "image" for layer in layers):
        raise ValueError("Use one to eight layers, including a still image.")
    for layer in layers:
        if layer.get("blend", "normal") not in MODES or not finite(layer.get("opacity", 1), 0, 1):
            raise ValueError("Invalid layer blend or opacity.")
        if not finite(layer.get("dissolveSeed", 42), 0, 2**32 - 1, True):
            raise ValueError("Invalid dissolve seed.")
        if layer["type"] == "image":
            transform = layer.get("transform", {})
            for key, lo, hi, default in [
                ("x", -2, 2, 0),
                ("y", -2, 2, 0),
                ("scale", 0.05, 4, 1),
                ("rotation", -180, 180, 0),
            ]:
                if not finite(transform.get(key, default), lo, hi):
                    raise ValueError("Invalid layer transform.")
        elif layer["type"] == "adjustment":
            finishing.validate_settings(layer["settings"])
        else:
            raise ValueError("Only still-image and adjustment layers are supported.")
        mask = layer.get("mask")
        if mask:
            if (
                mask["kind"] not in ("rectangle", "ellipse", "image")
                or not finite(mask.get("grow", 0), -32, 32, True)
                or not finite(mask.get("feather", 0), 0, 32)
            ):
                raise ValueError("Invalid layer mask.")
            if mask["kind"] != "image":
                if any(not finite(mask[key], -1, 1) for key in ("x", "y")) or any(
                    not finite(mask[key], 0.0000001, 2) for key in ("width", "height")
                ):
                    raise ValueError("Invalid mask geometry.")
            elif mask["channel"] not in ("alpha", "luminance"):
                raise ValueError("Invalid mask channel.")
    return width, height


def render_stack(request, assets):
    size = validate_request(request)
    output = np.zeros((size[1], size[0], 4), dtype=np.uint8)
    base_coverage = None
    pristine = True
    for layer in request["layers"]:
        clip = base_coverage if layer.get("clipToBelow", False) else None
        if layer.get("clipToBelow", False) and clip is None:
            raise ValueError("A clipped layer needs a lower image base.")
        if not layer.get("visible", True) or layer.get("opacity", 1) == 0:
            if layer["type"] == "image" and not layer.get("clipToBelow", False):
                base_coverage = np.zeros(size[::-1], dtype=np.float32)
            continue
        mode, opacity, seed = (
            layer.get("blend", "normal"),
            layer.get("opacity", 1),
            layer.get("dissolveSeed", 42),
        )
        if layer["type"] == "image":
            image = load_image(assets[layer["source"]["assetId"]])
            source = media_canvas(image, layer, size, assets)
            coverage = source[..., 3].astype(np.float32) / 255 * opacity
            if mode == "dissolve":
                coverage = dissolve(coverage, seed)
            if not layer.get("clipToBelow", False):
                base_coverage = coverage
            if pristine and mode == "normal" and opacity == 1 and clip is None:
                output = source.copy()
            else:
                output = composite_rgba(output, source, opacity, mode, seed, clip)
            pristine = False
        else:
            if (
                finishing.is_identity(finishing.validate_settings(layer["settings"]))
                and mode == "normal"
            ):
                continue
            grading = None
            if hasattr(finishing, "prepare_grading_context"):
                descriptor = layer["settings"].get("lut")
                lut_path = (
                    assets.get("lut:" + descriptor["sha256"])
                    if descriptor and layer["settings"].get("lutStrength", 0) > 0
                    else None
                )
                grading = finishing.prepare_grading_context(layer["settings"], lut_path)
                finished_image = finishing.apply_finishing(
                    Image.fromarray(output, "RGBA"),
                    layer["settings"],
                    grading_context=grading,
                    alpha_context=output[..., 3].astype(np.float32) / 255,
                )
            else:
                finished_image = finishing.apply_finishing(
                    Image.fromarray(output, "RGBA"),
                    layer["settings"],
                    alpha_context=output[..., 3].astype(np.float32) / 255,
                )
            finished = np.asarray(finished_image).astype(np.float32) / 255
            coverage = (
                np.asarray(mask_image(layer.get("mask"), size, assets)).astype(np.float32)
                / 255
                * opacity
            )
            if clip is not None:
                coverage *= clip
            if mode == "dissolve":
                coverage = dissolve(coverage, seed)
            rgb = output[..., :3].astype(np.float32) / 255
            changed = blend_rgb(rgb, finished, mode)
            active = (coverage > 0) & (output[..., 3] > 0)
            output[..., :3][active] = np.rint(
                np.clip(rgb + (changed - rgb) * coverage[..., None], 0, 1) * 255
            ).astype(np.uint8)[active]
    return Image.fromarray(output, "RGBA")


def process(work):
    request = work["request"]
    validate_request(request)
    assets = {}
    expected = {}
    for layer in request["layers"]:
        refs = ([layer["source"]] if layer["type"] == "image" else []) + (
            [layer["mask"]["source"]] if layer.get("mask", {}).get("kind") == "image" else []
        )
        for ref in refs:
            if ref["assetId"] in expected and expected[ref["assetId"]] != ref["sha256"]:
                raise ValueError("Conflicting image source bindings.")
            expected[ref["assetId"]] = ref["sha256"]
    if (
        len(work["assets"]) != len(expected)
        or {asset["assetId"]: asset["sha256"] for asset in work["assets"]} != expected
    ):
        raise ValueError("The worker assets do not match the project source hashes.")
    for asset in work["assets"]:
        info = inspect_image(asset["path"])
        if (
            info["sha256"] != asset["sha256"]
            or info["width"] != asset["width"]
            or info["height"] != asset["height"]
        ):
            raise ValueError("A source image changed or its oriented dimensions do not match.")
        assets[asset["assetId"]] = asset["path"]
    for lut_sha, lut_path in work.get("resolvedLuts", {}).items():
        if digest(lut_path) != lut_sha:
            raise ValueError("The finishing LUT changed before compositing.")
        assets["lut:" + lut_sha] = lut_path
    picture = render_stack(request, assets)
    output = Path(work["output"])
    picture.save(output, format="PNG")
    for asset in work["assets"]:
        if digest(asset["path"]) != asset["sha256"]:
            raise ValueError("A source changed during compositing.")
    receipt = {
        "processor": PROCESSOR,
        "width": picture.width,
        "height": picture.height,
        "sha256": digest(output),
        "sources": [
            {"assetId": asset["assetId"], "sha256": asset["sha256"]} for asset in work["assets"]
        ],
    }
    Path(work["receipt"]).write_text(json.dumps(receipt), encoding="utf-8")
    return receipt


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("work", nargs="?")
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--inspect")
    args = parser.parse_args()
    if args.check:
        print(json.dumps({"ready": True, "processor": PROCESSOR}))
        return
    if args.inspect:
        print(json.dumps(inspect_image(args.inspect)))
        return
    if not args.work:
        parser.error("Choose a work file or inspection.")
    print(json.dumps(process(json.loads(Path(args.work).read_text(encoding="utf-8")))))


if __name__ == "__main__":
    main()
