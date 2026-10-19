"""Independent numeric and actual PNG checks for the still-only layer engine."""

import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import uuid

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("layer_stack", ROOT / "scripts/layer-stack.py")
layers = importlib.util.module_from_spec(spec)
spec.loader.exec_module(layers)


def image_layer(asset="source", **patch):
    return {
        "id": str(uuid.uuid4()),
        "type": "image",
        "source": {"assetId": asset, "sha256": "a" * 64},
        "name": asset,
        "blend": "normal",
        **patch,
    }


def project(items, width=8, height=8):
    return {
        "format": "aftertake-layer-stack/1",
        "name": "Independent fixture",
        "canvas": {"width": width, "height": height},
        "layers": items,
    }


class LayerStackTest(unittest.TestCase):
    def test_w3c_numeric_blend_vectors_and_finite_component_extremes(self):
        b = np.array([[[0.2, 0.6, 0.8]]], dtype=np.float32)
        s = np.array([[[0.7, 0.3, 0.4]]], dtype=np.float32)
        expected = {
            "normal": [0.7, 0.3, 0.4],
            "dissolve": [0.7, 0.3, 0.4],
            "multiply": [0.14, 0.18, 0.32],
            "screen": [0.76, 0.72, 0.88],
            "overlay": [0.28, 0.44, 0.76],
            "soft-light": [0.2992, 0.504, 0.768],
            "hard-light": [0.52, 0.36, 0.64],
            "difference": [0.5, 0.3, 0.4],
            "exclusion": [0.62, 0.54, 0.56],
            "darken": [0.2, 0.3, 0.4],
            "darker-color": [0.7, 0.3, 0.4],
            "lighten": [0.7, 0.6, 0.8],
            "lighter-color": [0.2, 0.6, 0.8],
            "color-dodge": [2 / 3, 6 / 7, 1],
            "color-burn": [0, 0, 0.5],
            "linear-dodge": [0.9, 0.9, 1],
            "linear-burn": [0, 0, 0.2],
            "linear-light": [0.6, 0.2, 0.6],
            "pin-light": [0.4, 0.6, 0.8],
            "vivid-light": [1 / 3, 1 / 3, 0.75],
            "hard-mix": [0, 0, 1],
            "subtract": [0, 0.3, 0.4],
            "divide": [2 / 7, 1, 1],
            "hue": [0.9055, 0.3055, 0.4555],
            "saturation": [0.30066667, 0.56733333, 0.70066667],
            "color": [0.771, 0.371, 0.471],
            "luminosity": [0.129, 0.529, 0.729],
        }
        self.assertEqual(set(expected), layers.MODES)
        for mode, values in expected.items():
            np.testing.assert_allclose(
                layers.blend_rgb(b, s, mode)[0, 0], values, atol=1e-6, err_msg=mode
            )
        for mode in layers.MODES:
            for background, source in [(0, 0), (1, 1), (0, 1), (0.5, 0.5), (1, 0)]:
                result = layers.blend_rgb(
                    np.full((1, 1, 3), background, dtype=np.float32),
                    np.full((1, 1, 3), source, dtype=np.float32),
                    mode,
                )
                self.assertTrue(np.isfinite(result).all(), mode)
                self.assertTrue(((result >= -1e-6) & (result <= 1 + 1e-6)).all(), mode)
        with self.assertRaises(ValueError):
            layers.blend_rgb(b, s, "fake-mode")

    def test_partial_alpha_and_all_mode_transparency_identities(self):
        b = np.array([[[255, 0, 0, 128]]], dtype=np.uint8)
        s = np.array([[[0, 0, 255, 128]]], dtype=np.uint8)
        np.testing.assert_array_equal(layers.composite_rgba(b, s), [[[85, 0, 170, 192]]])
        for mode in layers.MODES:
            transparent = s.copy()
            transparent[..., 3] = 0
            np.testing.assert_array_equal(layers.composite_rgba(b, transparent, mode=mode), b)
            np.testing.assert_array_equal(layers.composite_rgba(b, s, opacity=0, mode=mode), b)
            opaque = s.copy()
            opaque[..., 3] = 255
            np.testing.assert_array_equal(
                layers.composite_rgba(np.zeros_like(b), opaque, mode=mode), opaque
            )

    def test_dissolve_is_repeatable_by_saved_seed_and_has_coverage(self):
        b = np.zeros((128, 128, 4), dtype=np.uint8)
        s = np.full_like(b, 255)
        a = layers.composite_rgba(b, s, opacity=0.4, mode="dissolve", seed=23)
        np.testing.assert_array_equal(
            a, layers.composite_rgba(b, s, opacity=0.4, mode="dissolve", seed=23)
        )
        self.assertFalse(
            np.array_equal(a, layers.composite_rgba(b, s, opacity=0.4, mode="dissolve", seed=24))
        )
        self.assertAlmostEqual(float((a[..., 3] > 0).mean()), 0.4, delta=0.02)
        self.assertEqual(set(np.unique(a[..., 3])), {0, 255})

    def test_clipped_image_preserves_partial_base_alpha_and_opaque_underlays(self):
        base = np.array([[[255, 0, 0, 128]]], dtype=np.uint8)
        blue = np.array([[[0, 0, 255, 255]]], dtype=np.uint8)
        coverage = base[..., 3].astype(np.float32) / 255
        np.testing.assert_array_equal(
            layers.composite_rgba(base, blue, clip=coverage), [[[0, 0, 255, 128]]]
        )
        np.testing.assert_array_equal(
            layers.composite_rgba(base, blue, opacity=0.5, clip=coverage),
            [[[128, 0, 128, 128]]],
        )
        underlay = np.array([[[0, 0, 0, 255]]], dtype=np.uint8)
        below = layers.composite_rgba(underlay, base)
        np.testing.assert_array_equal(
            layers.composite_rgba(below, blue, clip=coverage), [[[64, 0, 128, 255]]]
        )
        for mode in layers.MODES:
            result = layers.composite_rgba(base, blue, mode=mode, clip=coverage)
            np.testing.assert_array_equal(result[..., 3], base[..., 3], err_msg=mode)
        empty = base.copy()
        empty[..., 3] = 0
        np.testing.assert_array_equal(
            layers.composite_rgba(empty, blue, mode="dissolve", clip=coverage), empty
        )

    def test_shape_masks_alpha_luminance_and_morphology(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "mask.png"
            Image.new("RGBA", (8, 8), (255, 255, 255, 128)).save(path)
            source = {"source": str(path)}
            mask = {"kind": "rectangle", "x": 0, "y": 0, "width": 0.5, "height": 1}
            raw = np.asarray(layers.mask_image(mask, (8, 8), source))
            self.assertTrue((raw[:, :4] == 255).all())
            self.assertTrue((raw[:, 4:] == 0).all())
            inverted = np.asarray(layers.mask_image({**mask, "invert": True}, (8, 8), source))
            np.testing.assert_array_equal(inverted, 255 - raw)
            self.assertTrue(
                (
                    np.asarray(layers.mask_image({**mask, "enabled": False}, (8, 8), source)) == 255
                ).all()
            )
            tiny = np.asarray(layers.mask_image({**mask, "width": 0.000001}, (8, 8), source))
            self.assertEqual(int(tiny.sum()), 0)
            self.assertGreater(
                int(np.asarray(layers.mask_image({**mask, "grow": 1}, (8, 8), source)).sum()),
                int(raw.sum()),
            )
            self.assertLess(
                int(np.asarray(layers.mask_image({**mask, "grow": -1}, (8, 8), source)).sum()),
                int(raw.sum()),
            )
            self.assertTrue(
                np.any(
                    (np.asarray(layers.mask_image({**mask, "feather": 1}, (8, 8), source)) > 0)
                    & (np.asarray(layers.mask_image({**mask, "feather": 1}, (8, 8), source)) < 255)
                )
            )
            for channel in ("alpha", "luminance"):
                imported = {"kind": "image", "source": {"assetId": "source"}, "channel": channel}
                self.assertTrue(
                    (np.asarray(layers.mask_image(imported, (8, 8), source)) == 128).all()
                )

    def test_affine_premultiplication_preserves_clean_edges_and_does_not_wrap(self):
        source = np.zeros((16, 16, 4), dtype=np.uint8)
        source[:, :, :3] = [255, 0, 0]
        source[4:12, 4:12] = [255, 255, 255, 255]
        image = Image.fromarray(source, "RGBA")
        layer = image_layer(transform={"x": 0, "y": 0, "scale": 1.4, "rotation": 27, "flipX": True})
        result = layers.media_canvas(image, layer, (32, 32), {})
        colors = result[:, :, :3][result[:, :, 3] > 8]
        self.assertTrue(
            (colors > 248).all(), "Transparent red input pixels must not fringe the white cutout."
        )
        off = layers.media_canvas(
            image, image_layer(transform={"x": 2, "y": 2, "scale": 1, "rotation": 0}), (32, 32), {}
        )
        self.assertEqual(int(off[..., 3].sum()), 0)
        np.testing.assert_array_equal(
            layers.media_canvas(image, image_layer(), image.size, {}), source
        )

    def test_order_hidden_opacity_clipping_and_adjustment_alpha(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            Image.new("RGBA", (8, 8), (100, 80, 60, 128)).save(folder / "base.png")
            Image.new("RGBA", (8, 8), "blue").save(folder / "blue.png")
            assets = {"base": str(folder / "base.png"), "blue": str(folder / "blue.png")}
            base = image_layer("base")
            blue = image_layer("blue")
            source = np.asarray(Image.open(folder / "base.png"))
            np.testing.assert_array_equal(
                np.asarray(
                    layers.render_stack(project([base, {**blue, "visible": False}]), assets)
                ),
                source,
            )
            np.testing.assert_array_equal(
                np.asarray(layers.render_stack(project([base, {**blue, "opacity": 0}]), assets)),
                source,
            )
            self.assertFalse(
                np.array_equal(
                    layers.render_stack(project([base, blue]), assets),
                    layers.render_stack(project([blue, base]), assets),
                )
            )
            settings = copy.deepcopy(layers.finishing.DEFAULTS)
            settings["exposureEV"] = 1
            adjustment = {
                "type": "adjustment",
                "name": "local exposure",
                "settings": settings,
                "mask": {"kind": "rectangle", "x": 0, "y": 0, "width": 0.5, "height": 1},
            }
            result = np.asarray(layers.render_stack(project([base, adjustment]), assets))
            np.testing.assert_array_equal(result[..., 3], source[..., 3])
            np.testing.assert_array_equal(result[:, 4:], source[:, 4:])
            self.assertGreater(float(result[:, :4, :3].mean()), float(source[:, :4, :3].mean()))
            for mode in ["multiply", "screen"]:
                masked = np.asarray(
                    layers.render_stack(project([base, {**adjustment, "blend": mode}]), assets)
                )
                np.testing.assert_array_equal(masked[:, 4:], source[:, 4:])
                np.testing.assert_array_equal(masked[..., 3], source[..., 3])
            # Clipped upper image never reveals pixels outside lower coverage.
            cut = {**base, "mask": {"kind": "rectangle", "x": 0, "y": 0, "width": 0.5, "height": 1}}
            clipped = np.asarray(
                layers.render_stack(project([cut, {**blue, "clipToBelow": True}]), assets)
            )
            self.assertTrue((clipped[:, 4:, 3] == 0).all())
            self.assertTrue((clipped[:, :4, 3] == 128).all())
            self.assertTrue((clipped[:, :4, :3] == [0, 0, 255]).all())
            hidden = np.asarray(
                layers.render_stack(
                    project([{**cut, "visible": False}, {**blue, "clipToBelow": True}]), assets
                )
            )
            self.assertEqual(int(hidden[..., 3].sum()), 0)

    def test_adjustment_spatial_operations_ignore_hidden_rgb_and_keep_alpha(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            pixels = np.zeros((16, 64, 4), dtype=np.uint8)
            pixels[:, :32] = [20, 50, 80, 255]
            pixels[:, 31, 3] = 64
            dark = pixels.copy()
            pixels[:, 32:, :3] = 255
            Image.fromarray(pixels, "RGBA").save(directory / "white-hidden.png")
            Image.fromarray(dark, "RGBA").save(directory / "black-hidden.png")
            source = image_layer("source")
            for patch in [
                {"glowStrength": 1, "glowRadius": 5},
                {"halationStrength": 1, "halationRadius": 5},
                {"sharpen": 1},
                {"chromaticStrength": 1, "chromaticOffset": 2.5},
                {"glowStrength": 1, "halationStrength": 1, "sharpen": 1, "chromaticStrength": 1},
            ]:
                settings = {**copy.deepcopy(layers.finishing.DEFAULTS), **patch}
                adjustment = {"type": "adjustment", "name": "covered optics", "settings": settings}
                request = project([source, adjustment], 64, 16)
                white = np.asarray(
                    layers.render_stack(request, {"source": str(directory / "white-hidden.png")})
                )
                black = np.asarray(
                    layers.render_stack(request, {"source": str(directory / "black-hidden.png")})
                )
                np.testing.assert_array_equal(white[:, :32], black[:, :32], err_msg=str(patch))
                np.testing.assert_array_equal(white[..., 3], pixels[..., 3])
                np.testing.assert_array_equal(white[:, 32:], pixels[:, 32:])
            # An opaque layer uses the exact legacy finishing path.
            settings = {
                **copy.deepcopy(layers.finishing.DEFAULTS),
                "glowStrength": 1,
                "halationStrength": 1,
                "sharpen": 1,
                "chromaticStrength": 1,
            }
            rgb = Image.fromarray(pixels[..., :3])
            np.testing.assert_array_equal(
                np.asarray(layers.finishing.apply_finishing(rgb, settings)),
                np.asarray(
                    layers.finishing.apply_finishing(
                        rgb, settings, alpha_context=np.ones((16, 64), dtype=np.float32)
                    )
                ),
            )
            # A faint constant cutout cannot acquire a sharpening fringe from
            # quantizing its premultiplied color before coverage normalization.
            constant = Image.new("RGB", (8, 8), (80, 80, 80))
            settings = {**copy.deepcopy(layers.finishing.DEFAULTS), "sharpen": 1}
            for alpha in (1 / 255, 0.5):
                np.testing.assert_array_equal(
                    np.asarray(
                        layers.finishing.apply_finishing(
                            constant,
                            settings,
                            alpha_context=np.full((8, 8), alpha, dtype=np.float32),
                        )
                    ),
                    np.asarray(constant),
                )

    def test_real_png_output_receipt_and_source_hash_guard(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            path = folder / "base.png"
            pixels = np.arange(8 * 8 * 4, dtype=np.uint8).reshape(8, 8, 4)
            Image.fromarray(pixels, "RGBA").save(path)
            request = project([image_layer("base")])
            request["layers"][0]["source"]["sha256"] = layers.digest(path)
            work = {
                "request": request,
                "assets": [
                    {
                        "assetId": "base",
                        "path": str(path),
                        "sha256": layers.digest(path),
                        "width": 8,
                        "height": 8,
                    }
                ],
                "output": str(folder / "output.png"),
                "receipt": str(folder / "receipt.json"),
            }
            receipt = layers.process(work)
            np.testing.assert_array_equal(np.asarray(Image.open(work["output"])), pixels)
            self.assertEqual(receipt["sha256"], layers.digest(work["output"]))
            self.assertEqual(
                json.loads(Path(work["receipt"]).read_text())["processor"], layers.PROCESSOR
            )
            work["assets"][0]["sha256"] = "f" * 64
            with self.assertRaisesRegex(ValueError, "hashes|changed"):
                layers.process(work)

    def test_bounds_reject_before_transformed_image_allocation(self):
        for bad in [
            project([image_layer()], 4096, 4096),
            project([image_layer() for _ in range(9)]),
            project([image_layer(transform={"scale": float("nan")})]),
        ]:
            with self.assertRaises(ValueError):
                layers.validate_request(bad)


if __name__ == "__main__":
    unittest.main()
