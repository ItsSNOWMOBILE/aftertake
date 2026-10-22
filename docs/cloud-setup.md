# Comfy Cloud rendering

Aftertake renders on your own GPU, with local models, as it always has. Comfy Cloud is optional, studio by studio. With a key from a **paid** Comfy Cloud plan, you can choose to render any of these studios on [Comfy Cloud](https://comfy.org/cloud) instead:

| Studio | On Comfy Cloud |
| :--- | :--- |
| Create images (Z-Image Turbo) | The same graph as local |
| Make a song (ACE-Step 1.5) | The same graph as local |
| Upscale ×2 (SeedVR2 3B) | The local graph between Cloud's own video loader and a WebM saver |
| Smooth and slow motion (RIFE 4.26) | The local graph between Cloud's own video loader and a WebM saver |
| Create video (LTX-2.5) | The local graph with Cloud's full distilled transformer in place of the GGUF quant |

Character replacement, painted region effects, camera guidance, motion transfer, reference-frame editing and still-image depth need Aftertake's own nodes or H3 Relay. Comfy Cloud does not have them, so those studios always use the local engine, even while Cloud is on.

**Status.** Tested end to end on a Comfy Cloud Standard plan on October 22, 2026. Through the studio itself, each Cloud studio rendered one job: a 1024×1024 image in 16 s, a 10-second song in 25 s, 2-second clips upscaled ×2 in 42 s and smoothed to 48 fps in 15 s, and a 2-second text-to-video clip with sound in 28 s (submission to ready, including the local steps). Each result passed the same checks as a local render. The image kept its workflow in the PNG, and the videos have the exact frame count, frame rate and sound coverage. The record is in [`cloud/oct22-cloud-validation.json`](cloud/oct22-cloud-validation.json). The cloud graphs are also checked against Comfy Cloud's live node and model list (`tests/fixtures/comfy-cloud-object-info.json`), and the routing is tested against a simulated Cloud API. Free Comfy Cloud accounts can't use the API (`API key authentication is not available for free tier accounts`); any paid plan can.

## Turn it on

1. Open **Render setup** and choose **Comfy Cloud**.
2. Paste your Comfy Cloud API key and save it, then choose **Check saved connection**. Aftertake sends the key to Comfy Cloud's read-only account endpoint, `https://cloud.comfy.org/api/user`. It keeps only the account id, to bind jobs to the account that ran them.
3. When the key is accepted, Aftertake starts a separate isolated Comfy SDK worker for `https://cloud.comfy.org` and reads Cloud's node list (`/api/object_info`). Nothing moves yet: every studio still renders on your GPU.
4. Under **Where each studio renders**, switch the studios you want from **Your GPU** to **Comfy Cloud**. Each switch shows whether that destination is ready, and **Use Comfy Cloud for all** or **Use my GPU for all** changes them together. A typical mix keeps images local and sends text to video to Cloud.
5. Start a job as usual. In a studio you switched, the time estimate beside the button says it renders on Comfy Cloud and uses your credits.

Your choices are saved in the workspace (`cloud-choices.json` in the data folder, which holds no key) and apply again whenever Comfy Cloud is connected. To connect at startup, set `COMFY_CLOUD_API_KEY` in your `.env`. **Remove saved key** in Render setup disconnects Cloud, and every studio renders locally again.

Keys entered in Render setup are held only in the local server's memory and in the Cloud worker's copied environment. They are not written to `.env`, browser storage, project files, recipes, logs or status responses.

## How a Cloud job runs

- **Images and songs** submit the local graph unchanged. If Comfy Cloud returns a PNG without its prompt metadata, the image keeps the graph it submitted.
- **Upscale and interpolation.** Comfy Cloud has no Aftertake clip loader, so `scripts/cloud-media.py prepare` decodes the source on your computer onto the same 24 fps frame clock and canvas as `AftertakeLoadClip`. It writes that as near-lossless full-chroma H.264 for upload. Cloud loads it with `LoadVideo` and `GetVideoComponents`, runs the same SeedVR2 or RIFE nodes, and saves VP9 WebM frames. `scripts/cloud-media.py finish` then encodes the MP4 exactly as `AftertakeSaveVideo` does: H.264 CRF 17, the recipe and workflow in the comment tag, and the source's sound trimmed and padded to the picture. The existing checks then verify the request, size and frame count.
- **Text to video.** Cloud saves frames as WebM and the generated sound as FLAC. Your computer applies the palette grade (the same math as `AftertakeFilmGrade`) and adds the sound. The result must then pass the same checks as a local video, against the cloud graph: canvas, frame clock, regular timestamps and sound covering the picture.

Comfy Cloud bills its GPU time to the account whose key you entered. Aftertake's own steps run on your CPU.

## Jobs, accounts and recovery

Switching a studio affects only its new jobs. Every job records its target. Local jobs keep the startup engine's fingerprint; Cloud jobs record `kind: "comfy-cloud"` with a SHA-256 of the account id, never the key. A saved Cloud job can be rejoined or canceled only while Comfy Cloud is connected with the same account. After a restart without the key, it shows *connection lost* until you check the key again. It then resumes on its own, because Cloud kept running it. Local jobs never move to Cloud, and Cloud jobs never fall back to the local engine.

If Comfy Cloud refuses a job because the plan is free, the job fails with that explanation and Render setup marks the subscription check as blocked. Switch those studios back to your GPU, or check the saved connection again after upgrading. A job refused for missing credits says so. When a studio is on your GPU and the local engine isn't ready for it, the error also suggests Comfy Cloud while it's connected.

## Managed deployments

Managed `*.run.comfy.app` deployments can be saved and checked, but they stay blocked: they have no verified read-only probe, and Aftertake's custom nodes would need to be installed there. A deployment that carries the full node pack and models could run every studio. Use the offline inventory and metadata checker below to evaluate one.

## Local API

- `GET /api/compute` returns safe connection and capability status, including where each studio renders (`renders: "local" | "comfy-cloud"`) and, for the cloud-capable studios while Cloud is connected, both destinations' readiness (`choices`).
- `POST /api/compute/connection` accepts `{ "provider": "local" }`, `{ "provider": "comfy-cloud", "apiKey": "..." }`, or `{ "provider": "managed-deployment", "endpoint": "https://example.run.comfy.app", "apiKey": "..." }`.
- `POST /api/compute/probe` checks the selected connection, and connects Comfy Cloud when its key is accepted.
- `POST /api/compute/routing` with `{ "feature": "text-video", "renders": "comfy-cloud" }` chooses where one cloud-capable studio renders; `"feature": "all"` sets all five. Choosing Comfy Cloud needs a connected key; choosing `"local"` always works.
- `DELETE /api/compute/connection` clears the connection, its memory-held key and the Cloud worker.
- `GET /api/engine?pipeline=...` reports Comfy Cloud's readiness for a studio you switched to Cloud, and the local engine's otherwise.

These routes keep the local studio's loopback host and same-origin write restrictions. Client-supplied claims such as `billingVerified` or `compatibilityVerified` are rejected.

## Prepare an offline character-swap inventory

Run this from a source checkout, without a key or an engine:

```sh
python scripts/prepare-cloud-profile.py --profile character-swap --output .runtime/cloud/character-swap-inventory.json
```

This writes a provider-independent `aftertake-cloud-profile-inventory/1` JSON report. It is not a Comfy Build configuration or a certified deployable Linux release. The command performs no login, network request, upload, installation, build, deployment or generation.

The report reads repository and Python/PyTorch pins from `scripts/setup.py`, model revisions/sizes/SHA-256 pins from `docs/models-character-swap.json`, and required nodes/model menus from `server/character-profile.ts`. It includes the existing setup stack, rather than claiming a minimal H3 worker image. It records exact runtime dependency pins, FFmpeg/FFprobe requirements, hashes of Aftertake's custom-node files, and hashes of the profile's supporting source files. The application-side H3 graph builder's dependency on the pinned Relay recipe is explicit. An installed local copy of that small recipe is fingerprinted when available; its presence does not certify a remote worker.

To report which expected models are present on an existing model disk, optionally add `--models-dir PATH_TO_MODELS`. The path is not included in the report. This checks filenames and sizes only: model contents are never read or hashed, and a matching size is reported as `present-unhashed`. The expected hashes remain manifest evidence, not fresh verification. Missing source files, absent models and size mismatches are reported separately. Invalid pins, escaping paths or a disagreement between the model manifest and runtime model menus stop the export.

The inventory contains no `.env` data, API keys, account records, personal reference photos, source media, projects or job records. Source hashes describe the current checkout bytes; regenerate the report after changing code or checking out another revision.

Before translating this report into a provider's documented build format, validate Linux dependency resolution, GPU capacity/kernels, codecs, all required node/model capabilities and real output contracts on the intended worker. Then separately verify account/billing ownership and isolated job recovery. The report always leaves deployment readiness false and performs none of those steps automatically.

## Check saved engine metadata

The local studio and the offline checker share the same declared node, model-menu and native port/runtime checks. Save the intended worker's `object_info` and `system_stats` responses using its documented metadata interfaces. Keep these captures in ignored `.runtime/`: file-picker menus can contain private uploaded filenames. Comfy Cloud's metadata routes are described in its [API overview](https://docs.comfy.org/development/cloud/overview); obtain metadata from the actual execution target when evaluating a dedicated deployment.

```sh
pnpm exec tsx scripts/check-engine-readiness.mts --feature character-swap --object-info .runtime/cloud/object-info.json --system-stats .runtime/cloud/system-stats.json --output .runtime/cloud/character-swap-check.json
```

Use `--feature all` to inspect all ten workflow profiles. `--system-stats` is optional; character profiles remain blocked when their operating system cannot be verified. Input limits are 16 MiB for object metadata and 1 MiB for system metadata. Choose a new output path for each report; existing files are preserved. Without `--output`, the command prints the report. Exit status is `0` when the selected profile checks pass, `1` when checks are blocked, and `2` for invalid arguments, files or output paths.

The command reads saved JSON from disk and makes no engine/API requests. URLs, explicit network-share paths and device namespaces are rejected before reading or writing files. It never uploads media, changes connections or starts a job. Reports contain input hashes, contract hashes and fixed expected component names; observed menu values, host paths and account documents are omitted. Missing or malformed model lists block readiness. Both list-style menus and `COMBO` menus with an `options` list are checked.

Every report retains `generationReady: false`. Metadata origin and freshness, full graph validation, model bytes, GPU execution, media transport, output recovery and account billing still need verification. Run the check again against a fresh capture after changing the target worker or profile. The Python inventory above supplies the separate pinned deployment inputs.

## Linux dependency candidate

The full current setup resolves to **115 packages** for Linux x86_64, manylinux 2.28, Python 3.12.14 and CUDA 13.0. All 93 runtime pins and the three setup Torch pins are retained; the resolution adds 19 Linux CUDA/NVIDIA/Triton dependencies. The [hashed candidate](cloud/requirements-linux-cu130.candidate.txt), [input constraints](cloud/linux-cu130.in) and [resolution evidence](cloud/linux-cu130-resolution.json) record this metadata check. The working Windows environment was unchanged.

Use uv **0.13.1** in a clean environment without inherited `UV_*` or `PIP_*` overrides to recheck the pinned candidate. Create the ignored `.runtime` directory if needed. The command below reads package metadata from PyPI and the official PyTorch CUDA index, preserves the candidate versions, and writes a separate output:

```sh
uv pip compile docs/cloud/linux-cu130.in --constraint docs/cloud/requirements-linux-cu130.candidate.txt --python-platform x86_64-manylinux_2_28 --python-version 3.12.14 --torch-backend cu130 --default-index https://pypi.org/simple --config-file docs/cloud/uv-resolve.toml --no-build --no-sources --no-python-downloads --no-managed-python --generate-hashes --no-header --no-annotate --emit-index-annotation --quiet --output-file .runtime/linux-cu130-recheck.txt
```

Add `--offline` when that resolver cache is already populated. The recorded offline recheck produced a byte-identical candidate. The evidence uses explicit LF-normalized text hashes for source files, following the repository's Git line-ending policy. Regenerate the evidence after changing setup constraints; when intentionally updating versions, remove the candidate constraint and review the new result separately.

This candidate mirrors the complete existing setup and does not change the installer. Linux installation/imports, native libraries, NVIDIA drivers/kernels, GPU capacity and media outputs remain unverified. Deployment readiness stays false. See uv's [cross-platform resolution](https://docs.astral.sh/uv/concepts/resolution/) and [explicit PyTorch backend selection](https://docs.astral.sh/uv/guides/integration/pytorch/) for the resolver's scope.
