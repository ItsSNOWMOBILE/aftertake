# Aftertake: one take, your next take

An editable 30.625-second native Film demo: tracked source-pixel duplicates, a color finish, H3 character replacement, an LTX-2.5 shot, a short-form coffee hook, and animated type, panels and image cards. The closing reveal shows this actual project at the three-copy hero frame, not a simulated interface.

This bundle supplies **27 exact companion media files** and an `aftertake-film/3` project with **16 cuts, 16 editable titles, 19 graphic layers and 11 audio tracks**. It reproduces the edit using completed native results. It does not regenerate the H3/LTX diffusion outputs or bundle model weights.

## Reopen and export

Use the Aftertake repository at revision `8dfa49c297daf3f2f0b639fa17bd101c986bfa8b` or a later revision supporting Film format 3 and motion graphics. Run these commands from the checkout root, with Node.js 22.12+, pnpm, and Python 3.12 available.

1. Extract `aftertake-motion-inputs.zip` **at the checkout root**. The resulting project must be `examples/motion-design/project.json`; preserve the `media/` folder beside it. Python's built-in extractor can be used:

   ```sh
   python -m zipfile -e aftertake-motion-inputs.zip .
   python examples/motion-design/verify.py
   ```

2. Install dependencies and the small CPU Film runtime, then start the local studio:

   ```sh
   pnpm install --frozen-lockfile
   python scripts/setup-film.py
   pnpm demo -- --port=4376
   ```

3. In a second terminal at the same checkout root, verify and import the media:

   ```sh
   python scripts/import-film-project.py examples/motion-design/project.json --url http://127.0.0.1:4376
   ```

   The helper imports hash-matched assets and checks the project; it starts no render. If using an already-running studio, replace the URL with its actual local address. The repository's unmodified `pnpm demo` currently defaults to port 4312; the command above explicitly selects 4376.

4. Open `http://127.0.0.1:4376`, choose **Film → Import film project**, and select `examples/motion-design/project.json`. Scrub the cuts, open **Graphics & motion**, and inspect the title transform tracks. Choose **Export film** when ready to create an MP4.

No CUDA GPU, Comfy credits, API key or narration model download is needed to reassemble these existing inputs. Fresh image/video inference is a separate action requiring the corresponding model profiles and supported hardware. Browser-only recorded demonstrations cannot import these local files or export a Film. Native Film export uses the installed CPU runtime; its MP4 bytes may differ across codec/runtime versions.

## What remains editable

- The first three shots advance one continuous dancer clock: source frames 0–19, duplicates 20–39, grade 40–72. They retain the same framing.
- The H3 comparison also advances a matched source clock: original frames 0–31, replacement 32–72.
- The coffee chapter uses genuine before/after UI stills followed by original moving footage and an independent moving hook. It is a fictional creative example, not a real commercial offer.
- The how-built sequence uses native rectangles, an ellipse, imported image cards, arrows and independently keyed typography. Their timing, depth and transforms remain editable.
- Narration is separate from the original procedural music bed. Source clip audio is muted in this authored mix. The music is trimmed from its unchanged 39-second source to this project's 30.625-second timeline.

UI shots are genuine still captures with authored framing changes. They do not claim continuous screen recording, live typing, or a cursor interaction that was never captured. A 1080p export canvas scales existing footage; it does not imply every generated source was natively 1080p or AI upscaled.

## Files and review scope

`media-manifest.json` lists every source path, byte count and SHA-256. `SHA256SUMS` also covers the project and companion documents. `verify.py` checks the complete included file list and the 27 project source bindings using only Python's standard library.

`TRANSCRIPT.md` is derived from the selected `heardWords`, rather than repeating complete source scripts across trimmed narration windows. `narration.json` retains each selected WAV range and word timing. `preview-status.json` states the technical checks and limits: bundle integrity is verified; this packaging step performs no new render, continuous playback, listening pass or creative approval. It also records the separately verified reference MP4's hash and technical properties; that MP4 is not duplicated inside this input archive. Review the exported motion and audio before publishing your own changes.

See `CREDITS.md` for source footage, modifications, music, model terms and fonts. The app's MIT license does not relicense third-party footage or model outputs.
