# Mint mascot — Wan Animate 2 motion transfer

The fictional orange-hoodie dancer drives the pose of a fictional mint knitted teddy. This is full-frame motion transfer, not a character replacement composited into the garage. `source.mp4`, `reference.png`, and `result.mp4` retain the driver, appearance and result.

Seed **2026**, final quality, 10-step LCM/simple sampling, CFG 1 and pose strength 1 are preserved. The driver/caption and generated teddy reference are documented source changes. The application requests visible 1280 × 720, pads to the compatible 1280 × 736 native model grid, then crops the padding on delivery. Native raw output is retained separately.

To reproduce, import the included source and reference in Aftertake, rebind their local IDs in `request.json`, and submit it through the ordinary `/api/renders` route. Keep the pipeline, transfer, cinema and cue settings from the recipe. `executed-workflow.json` records the model contracts; `models.json` pins repositories, revisions, SHA-256 values and publisher license links. Original media IDs are execution evidence and must be rebound after import on a different installation.

The source contains generated ambient audio, not recorded footsteps or a teddy performance. Media verification reports whether the selected source trim is preserved. Runtime and progress observations are measured on this local RTX 5080 and do not promise the same speed on another GPU.

Independent review found clear head and arm gesture transfer with a consistent knitted character in the sampled frames. The dancer's hops, crouches and lateral footwork are substantially reduced; present this as gesture transfer rather than an exact copy of the whole dance. Native HD engine execution took 3,142 seconds (about 52 minutes) on this 16 GB GPU and 32 GB host. The preserved source audio and regular 24 fps clock passed verification.
