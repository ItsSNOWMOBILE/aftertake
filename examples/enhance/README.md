# Native Enhance workflow checks

Real Aftertake UI runs on an RTX 5080 (16 GB), Core Ultra 9 285K and 32 GB host RAM. Videos use the existing [castle/lighthouse camera move](../castle-pullback-v2/result.mp4): 1280 × 720, 97 frames at 24 fps, 4.041667 seconds. That source has **no audio**, so these runs do not demonstrate source-sound preservation.

Each `*-render.json` is one original native studio job record. Its executed graph, input and output hash are retained. The media files are native outputs with no delivery upscale or frame-rate conversion added outside the workflow. `media-verification.json` records full software-decode counts, timestamps and byte hashes. Review contacts are scaled previews of five source-aligned samples, not evidence of every intermediate frame's visual quality.

| Operation | Input | Seed | Output | FPS / decoded frames | Duration | Admission → final update | Sampled whole-GPU peak | Film media handoff |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [smooth](smooth.mp4) | 97-frame lighthouse clip | — | 1280 × 720 | 48 / 193 | 4.020833 s | 6.428 s | 2467 MiB | hash verified |
| [slow-motion](slow-motion.mp4) | 97-frame lighthouse clip | — | 1280 × 720 | 24 / 385 | 16.041667 s | 10.238 s | 3209 MiB | hash verified |
| [upscaled](upscaled.mp4) | 97-frame lighthouse clip | 5090 | 2560 × 1440 | 24 / 97 | 4.041667 s | 390.187 s | 6300 MiB | hash verified |
| [song-lyrics](song-lyrics.flac) | Tags + lyrics; 45 s; 118 BPM | 5090 | Audio | — | 45.000000 s | 8.205 s | 6930 MiB | hash verified |
| [song-instrumental](song-instrumental.flac) | Instrumental tags; 30 s; 90 BPM | 5090 | Audio | — | 30.000000 s | 14.226 s | 6611 MiB | hash verified |

Timings include loading, queue/polling, transfer and output validation. VRAM is the highest observed whole-device reading inside each stored job window, sampled approximately once per second. It includes desktop/other processes and is neither model-only memory nor a guaranteed absolute peak. Full timing windows and sample counts are in `timings.json`.

RIFE emits `(N − 1) × multiplier + 1` frames: smooth motion has 193 frames at 48 fps; ×4 slow motion has 385 at 24 fps and is deliberately silent. This endpoint convention gives 4.020833 s and 16.041667 s respectively, rather than exact multiplication of the source container duration.

A matching, hash-verified persisted Film asset confirms the output-file handoff after the operator used **Add to film**. It does not certify timeline placement. Native decode/hash validation cannot certify interpolation aesthetics, restored detail, song quality or correct singing of every lyric. Review/listen to the actual media before treating any result as a showcase.

RIFE visual inspection includes both full-frame and native-size water/edge crops from five consecutive-frame intervals per output, with the actual generated in-betweens labeled. No obvious new tearing or gross lighthouse/rock geometry break was observed in those samples; fine foam texture is somewhat soft between endpoints. Human real-time playback was not fully assessed. The review and exact frame/hash bindings are in `review/`.

Pinned model repositories, revisions, sizes, licenses and SHA256 values are in `models.json`. No partner API calls or CPU diffusion fallbacks were used for these generation runs.

The native graphs ran without graph-schema changes: Comfy accepts the flat DynamicCombo API values used for SeedVR2 chunking and audio format, and the song output reaches the studio from node 8. Before these runs, external-model discovery was corrected to include the installed RIFE folder, and request validation was tightened to native loader dimensions and the ACE-Step language menu. Render Setup and all three local engine-readiness profiles showed ready.

The 30-second cinematic instrumental and 45-second lyric request produce non-silent, finite 48 kHz stereo FLAC. The instrumental peaks at −0.624 dBFS with no samples near full scale. The lyric result reaches 0 dBFS and has five channel-sample values at or above 0.9999: this is a small clipping-risk observation, not an assurance of clean mastering. Full RMS/peak/sample statistics are in `media-verification.json`. Singing quality and faithful delivery of the requested words were not auditioned or transcribed for this audit.

Native detail crops show sharper lighthouse railings, masonry and rain, but SeedVR2 also reconstructs or changes fine details; some strengthened edge/halo texture is visible around the lantern roof in the middle sample. The already CGI-like rocks become harder and more stylized. These are observations of sampled visual sharpening, not verified recovery of ground-truth detail. Three native-detail comparisons and their exact crop/hash bindings are in `review/`; full real-time playback was not fully assessed.
