# Generate a video from text

Open **Create video** in the local studio. Describe the scene, action, camera
and desired sound, choose landscape/portrait/square and a shot length, then
create a take. This path samples native LTX-2.5 video/audio latents directly.
It does not generate or upload a starting image.

After the main runtime setup, install the pinned optional profile:

```powershell
python scripts/download-models.py --text-video
python scripts/engine.py --safe-weight-copies --no-node-cache
pnpm dev
```

The profile reuses the existing LTX-2.5 distilled Q4 backbone, Gemma 4 text
encoder and video VAE, and adds a 365 MB audio VAE. The four files total
41.67 GB. Downloads verify pinned revisions, file sizes and SHA-256 hashes.
Model terms apply separately from the MIT app. See `models-text-video.json`
and the upstream [LTX-2.5 model](https://huggingface.co/Lightricks/LTX-2.5).

The official [Comfy native T2V example](https://docs.comfy.org/tutorials/video/ltx/ltx-2-5)
informed the joint latent/sampling/decoding path. Aftertake uses its existing
GGUF profile and exporter rather than the template's optional spatial upscaler
or prompt enhancer. Those extra features are not exposed here.

| Setting | Behavior |
| --- | --- |
| Draft | 512 × 288 landscape, 288 × 512 portrait, 512 × 512 square |
| Final | 1024 × 576 landscape, 576 × 1024 portrait, 768 × 768 square |
| Optional HD output | Select **HD · 720p** or add `resolution: "720p"` to the saved request: 1280 × 720 landscape, 720 × 1280 portrait, 720 × 720 square. Higher memory use; draft/final defaults remain unchanged. |
| Length | 2–5 seconds of action on the native 8n+1 grid: 49–121 frames at 24 fps; the MP4 lasts one frame longer than the selected action interval |
| Sound | Joint AV sampling always runs. Keeping sound adds the native decoded audio; silent delivery omits its decoder and track |
| Camera/lens/light | Inspectable prompt direction, requiring visual review; no geometric camera reconstruction is claimed |
| Grade | Native post-generation grade, also retained in the recipe |

Each completed take retains its original request, seed, executed Comfy graph,
native job ID and content hash. Before publication into the source library,
the server compares the embedded graph/request and decodes the MP4 to verify
geometry, frame count, zero-origin 24 fps timestamps and the requested sound.
Generated sound must cover the video with continuous audio timestamps. AAC
encoding is lossy; audio packet identity is not claimed.

HD output samples the full native resolution. LTX's 32-pixel latent grid uses
1280 × 736 for landscape (736 × 1280 portrait), followed by an eight-pixel
crop on both edges of the padded axis inside the saved Comfy workflow. This
does not enlarge a lower-resolution sample. Z-Image's matching optional
`resolution: "720p"` image preset samples 1280 × 720 directly.

For an existing 16:9 source, **HD finish** adds the same optional resolution
to painted edits, camera moves and motion transfer recipes. Existing recipes
without this field keep their original sizes. Source pixels and paint are
mapped into the padded model canvas together, and the final video crops back
to the visible 720p canvas. Tracked camera moves use a 64-pixel model grid.
Raw takes retain their padded dimensions for saved motion finishing and
recomposition; those operations remove the padding without stretching it.

**Add to Film** verifies the bytes and reuses an existing identical Film asset.
**Use as source** opens the video for painted editing or character replacement.
Export/reimport the video recipe to restore settings; import starts no job.
The raw Comfy graph can also be downloaded. The configured engine needs the
Aftertake nodes for grading and receipt-preserving MP4 export.

The UI retains a stable admission key across an uncertain response. Rejoin the
original request or reconcile its saved record; a timeout does not authorize
a duplicate generation. Closing the dialog does not cancel a running job.

For agents, use `aftertake_generate_video`, then
`aftertake_generation_status` with `kind: "video"`. Inspect the completed
`clipId` with `aftertake_inspect_picture` and bring it into Film with
`aftertake_use_source`. The optional profile is `text-video`.

Two reviewed recorded takes are in `examples/text-video/`. The public browser
trial reviews their native results and restores settings; new inference and
Film export require the local studio. Native engine times on the tested
16 GB RTX 5080 / 32 GB Windows host were 79.92 s for the first landscape draft,
82.68 s for the final portrait, and 61.13 s for the silent square draft. These
three runs are individual measurements, not a general speed guarantee or a
comparison with cloud GPUs. Product identity and movement vary across takes.
