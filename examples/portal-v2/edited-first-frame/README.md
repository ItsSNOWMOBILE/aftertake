# Edited source frame0 — city appearance guide

This image was created by the normal Aftertake `/api/frame-edits` route from frame0 of the parent `source.mp4`, using Qwen Image Edit2511, detail20 steps and seed9841. It is the video recipe's `editReference`, not a separately composited final video. The frame editor returns the source dimensions1280 ×720 through its normal image-sizing graph; that entire graph is retained.

The image contains a vivid neon city, rain and flying vehicles. The original central dividers are partly absent in the guide; the final video recipe's glass-only source matte protects and restores the original dividers and room. Final video review remains necessary because a good guide does not guarantee a clean animated composite.

Replay by importing the parent source video, rebinding its local clip ID in `request.json`, and calling the normal frame-edit route. Use its returned image as `editReference` in the parent request. The exact included guide is also saved as `../edit-reference.png` once the video request is prepared. `recipe.json`, `render.json`, executed graph and `models.json` preserve parameters and pinned model provenance.
