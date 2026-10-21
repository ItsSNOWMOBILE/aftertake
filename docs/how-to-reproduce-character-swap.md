# Reproduce a character swap

Aftertake can track a person, replace them from original photos, retain source sound, and assemble the resulting takes in Film. Save the actual inputs and recipes so another workspace can repeat the procedure. A saved seed and graph do not guarantee identical generated pixels on another GPU or software stack.

## Inputs and generation

1. Install the character profile with `python scripts/setup.py --character-swap`. Keep the application revision, installed profile/model versions, original input files and their SHA-256 hashes with the project.
2. Import one continuous source shot into the studio. Choose **High / 768** before tracking when the higher-resolution profile is available. The reviewed selection reports its actual canvas and frame count.
3. Choose the primary original character photo. Its optional face focus is a crop of that photo. When using reference clothing, the primary photo supplies the outfit.
4. Add other original photos of the same person as supporting identity references, with a separate face focus where useful. Up to seven supporting photos are accepted. The primary image, optional primary crop and supporting images together use at most nine native H3 picture slots. These inputs supply additional identity detail; they do not guarantee an improvement in likeness.
5. Add inclusion points on the intended person and exclusion points on nearby people or props. Track with SAM3, then inspect the overlay throughout the shot. Check hair, fingers, limbs, occlusions, the other people and the background before replacing.
6. Run the replacement with a saved seed and prompt. Review the actual result, including transitions between H3 continuation windows. Keep the selection request, reviewed mask hash, complete replacement request, executed workflow, native job ID and result hash.

Describe the target's position and the replacement's distinguishing face, hair and clothing in **Extra direction**. In the [controlled cafe test](../examples/foreground-protection/prompt-retry/README.md), the generic prompt barely changed the person; adding those specifics produced the silver-haired character and green sweater with the same seed, reference, crop and tracked mask. This is one measured comparison, not a guarantee for other shots. Preserve the original failed result when comparing prompts.

The MCP equivalents are `aftertake_import_media`, `aftertake_track_character`, `aftertake_inspect_character`, `aftertake_replace_character`, `aftertake_character_status` and `aftertake_character_recipe`. Keep a stable request ID for each admitted job. After an uncertain response, use status or reconciliation to rejoin that job.

`aftertake_character_recipe` retains the primary photo, every supporting reference and their crops. The files themselves must be supplied separately when reopening in another workspace. Personal reference photographs and their recipes can remain in private local storage.

Studio photo import applies EXIF orientation, converts to RGB PNG and removes metadata. It scales oversized phone photos down to an orientation-aware 3840 × 2160 or 2160 × 3840 box with Lanczos filtering; smaller valid images are not enlarged. For example, a 2880 × 3840 portrait becomes 2160 × 2880. Inputs are bounded at 64 million pixels and 16,384 pixels per axis; the normalized image must retain at least 64 pixels on its shorter side. Retain both the original file hash and the normalized studio image hash. The recipe's photo dimensions and face boxes refer to that normalized image.

The current replacement exporter takes sound from the original selected source file at the selection's trim start. It trims or pads sound to the output duration and encodes AAC. A silent input remains silent; choosing a reference photo does not create the missing original recording.

## Exact starting inputs for the reviewed four-shot example

The reviewed 12-second Hotel Lobby baseline starts from four prepared source clips. They use a global 24 fps timeline and a 1280 × 768 canvas containing a 1280 × 720 picture with 24 black rows above and below it.

| Shot | Frames | Duration | Original performance interval |
| --- | ---: | ---: | --- |
| A | 73 | 73/24 seconds | 16 to 19.041667 seconds |
| B | 80 | 80/24 seconds | 19.041667 to 22.375 seconds |
| C | 92 | 92/24 seconds | 22.375 to 26.208333 seconds |
| D | 43 | 43/24 seconds | 26.208333 to 28 seconds |

Use the supplied prepared-input manifest to verify every clip's hash, dimensions and frame count. Import each prepared clip, use local trim start zero and the manifest's duration, and track it separately at High / 768. The saved requests use microsecond-floored durations to avoid asking the native video reader for a fractional amount beyond its declared container duration. The generated output still contains the reported whole frame count.

These prepared files are explicit starting assets. Their earlier sampling, scaling and padding were performed outside the app. Repeating generation and assembly from those assets requires the normal app/MCP paths; it does not require running the original preparation or final-render scripts.

Importing the original 1920 × 1080 video is also supported, including its sound. It produces a different starting raster: the native High profile uses 1344 × 736 for that source. Native per-shot trim/resampling also chooses different boundary frames from the reviewed global nearest-frame preparation. Do not describe that route as reproducing the reviewed prepared pixels or frame map. The prepared-input bundle is required when that exact starting canvas and clock matter.

The earlier baseline used one character photo plus its face crop. A trial using all four supplied photos is a different replacement request; retain that request and its actual output as separate evidence.

The original A take also used a separate native Comfy source-protection post-pass. Equivalent compositing is now part of the character workflow itself. New app runs therefore retain the reviewed source outside the edit region without that historical private script; the historical A receipt still identifies what actually ran.

## Assemble the 12-second result in Film

1. Add the four completed character takes to Film media, in A–D order. Import the original continuous audio recording as an audio asset. Film accepts M4A directly; an external WAV conversion is unnecessary when that recording is already available.
2. Choose landscape output and use complete shot lengths of 73, 80, 92 and 43 frames. Use direct cuts, with no dissolves or holds. The total is 288 frames at 24 fps; cuts fall at frames 73, 153 and 245.
3. For the prepared 1280 × 768 inputs above, set each shot's framing to a constant zoom of `16/15`, centered at `x: 0.5, y: 0.5`. This gives the intended 1280 × 720 picture area. Film's fit/pad/framing pipeline resamples the image; it is not a lossless source-pixel crop.
4. Set source footage volume to zero. Place one continuous audio track at film time zero, trim its original source from 16 to 28 seconds, set its volume to `0.8912509381337456` (−1 dB), and disable normalization. Do not concatenate the independently encoded shot soundtracks.
5. Export through Film. Download the film project as well as the video. Import the same hash-verified media before importing that project in another workspace; Film resolves its assets by content hash.

Film's API exposes the same project controls: `shots`, `framing`, `audio` with `start`, `sourceStart`, `sourceEnd` and `volume`, `sourceVolume`, and `normalizeAudio`. Restore with `POST /api/films/resolve`, then export the resolved draft with `POST /api/films`. The MCP beat-plan tool currently handles per-beat voices rather than arbitrary continuous audio trims, so use Film or its API for this exact soundtrack edit.

Film render revision 4 compensates the mastering limiter's lookahead delay so the continuous track stays on its authored timeline. A new revision receives a new export identity; reopening an older export does not rewrite its media.

## What can be reproduced

The saved project and prepared files reproduce the shot order, frame clock, framing, soundtrack trim, volume and generation settings through Aftertake. Reusing the saved generated takes also permits a complete CPU Film export without starting another GPU job.

Generation from the photos remains a new model run. GPU kernels, model/runtime versions and sampling can affect its pixels. Film re-encodes picture and sound, and its output differs from the earlier custom literal-crop/remux delivery. Preserve hashes to identify actual files; do not promise a matching checksum for a future regeneration.
