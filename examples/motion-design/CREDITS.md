# Credits and source terms

## Dance footage and tracked duplicates

**Antoni Shkraba — Video of a Man Dancing**, via [Pexels](https://www.pexels.com/video/video-of-a-man-dancing-7571381/), under the [Pexels License](https://www.pexels.com/license/). A silent excerpt beginning at 21 seconds was prepared at 24 fps; the comparison canvas is 1344 × 736. Aftertake retains the original dancer and adds two transformed copies of tracked source pixels, including a mirrored copy, then applies a color finish. SAM3.1 supplies tracking; duplication is CPU composition, not new identity/motion synthesis. See `examples/subject-duplicates/ATTRIBUTION.txt`, `provenance.json`, and the finishing example in the checkout for the original receipts.

## Bridge character comparison

**Tears of Steel (2012), Blender Foundation / mango.blender.org**, [source](https://mango.blender.org/about/), [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). Changes: silent excerpt at 28 seconds, prepared at 1536 × 640 and 24 fps; the man on the left is replaced using native H3 Character Swap V1.5 with a fictional reference generated locally by Z-Image Turbo. Original and result retain the matched prepared frame clock. The original film soundtrack is excluded. No real-person reference photo is included in this example. Source footage and visible derivatives retain CC BY attribution; model terms also apply. See `examples/character-h3-high/ATTRIBUTION.txt` and `examples/character-h3/reference-origin.json` in the checkout.

Applicable publisher terms: [MiniMax H3](https://huggingface.co/Comfy-Org/MiniMax-H3), [Character Swap adapter](https://huggingface.co/akatz-ai/MiniMax-H3-Character-Swap-LoRA), [Turbo adapter](https://huggingface.co/lightx2v/Minimax-h3-Turbo), and [SAM3.1](https://huggingface.co/Comfy-Org/sam3.1). The separately installed [H3 Relay node pack](https://github.com/akatz-ai/h3-relay) retains its GPL-3.0/Apache notices. Its code and model weights are not supplied by this archive.

## Coffee footage

**Michael Burrows — Putting coffee powder into a paper filter**, via [Pexels](https://www.pexels.com/video/putting-coffee-powder-into-a-paper-filter-7118095/), under the [Pexels License](https://www.pexels.com/license/). This bundle retains the complete original 1440 × 2560, 25 fps video file; Film selects and scales its short authored range on the 24 fps canvas. The UI captures and hook add Aftertake typography/framing. Fictional creative demonstration; no product or performance claim. The original download hash and license receipt are recorded in `examples/product-film/coffee-source-receipts.json` in the checkout.

## Observatory and UI

The observatory reference is an original local [Z-Image Turbo](https://huggingface.co/Comfy-Org/z_image_turbo) generation, seed 5090, followed by a native [LTX-2.5](https://huggingface.co/Lightricks/LTX-2.5) reference-animation workflow. Its recorded input, actual result and workflow receipts remain under `examples/observatory/` in the checkout. No outside observatory photograph was used. Publisher model terms apply separately.

Aftertake interface captures, original layout, geometric graphics, type animations and branding: Aftertake contributors. Captures depict the actual local studio; media visible inside captures retain the same source/model terms as their corresponding examples. The fresh final reveal shows this project at 1.3333 seconds. No private Hotel Lobby footage or user portrait is included.

## Narration, music and fonts

Narration is generic synthetic speech generated locally with [Kokoro-82M v1.0](https://huggingface.co/hexgrad/Kokoro-82M) (Apache-2.0 model), via [kokoro-onnx](https://github.com/thewh1teagle/kokoro-onnx) (MIT), using `am_michael`. The project retains the model/voice hashes, script settings and phoneme-derived timing receipts. No voice clone, real-person voice recording or external speech API is used.

Original procedural music and sound design, **More possibilities — original demo bed**, by Aftertake contributors: **CC0-1.0**. The unchanged 39-second stereo WAV is selected at 0–30.625 seconds with Film gain/fades; it contains no third-party samples, music recording or embedded narration. The generator code is MIT. See `examples/product-film/MUSIC.md` and `music-provenance.json` in the checkout for provenance. That source bed's previous cut-specific ducking is not a new listening certificate for this edit.

App typography uses DM Sans and Manrope under the SIL Open Font License; their actual font/license files are provided with the application. Models/weights, outside node packs and source media retain their separate terms; the app code's MIT license does not replace them. No source creator, performer, model publisher or service endorsement is implied.
