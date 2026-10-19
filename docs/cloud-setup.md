# Compute connections

Aftertake's native editing workflows render through the local studio's startup Comfy engine. Optional [hosted LTX generation](hosted-generation.md) uses a separate Comfy Router queue and credential connection. The recorded browser demo does not accept API keys or send live generation requests.

The local studio's compute settings prepare a connection to Comfy Cloud or a managed Comfy deployment. They do not deploy native editing workflows. A successful credential check is not proof that the account can run Aftertake's workflows or that a deployment will charge the intended account. The hosted LTX button opens its separate working Router integration.

## Prepare a connection

1. Open the local studio and its compute settings. Choose Local, Comfy Cloud or Managed deployment.
2. For Comfy Cloud, enter your own API key when you are ready. You can leave the key unset while reviewing the setup.
3. For a managed deployment, use its HTTPS `*.run.comfy.app` origin. Paths, custom ports, URL credentials, queries and fragments are rejected.
4. Save the connection, then explicitly run a check. Cloud checks send the key only to `https://cloud.comfy.org/api/user` using the documented `X-API-Key` header. This read-only request has a five-second deadline and does not follow redirects. It does not submit a workflow, purchase credits or provision a deployment.
5. Disconnect to discard the entered key. Restarting the studio also discards it.

Keys entered in these settings are held only in the local server's memory. They are not written to `.env`, browser storage, project files, recipes, logs or status responses. Status responses expose only whether a key was supplied. Account documents and provider error bodies are not returned to the browser. The managed-deployment connection currently has no verified read-only metadata probe, so its authentication remains unverified.

## What a check establishes

Local checks report readiness separately for each workflow using the existing engine's nodes and model menus. Cloud checks distinguish reachability from credential acceptance. Subscription eligibility, available credits, billing ownership and workflow compatibility remain unverified for native workflow deployment. Those capabilities remain blocked, even after an accepted credential. This does not describe the separate hosted LTX Router queue.

Saved connection settings are candidates. Local submissions, running jobs, saved-job recovery and cancellation continue using the same startup SDK client. Selecting or disconnecting a candidate does not reroute work or change the startup environment.

New native jobs save a versioned fingerprint of the startup API and native-engine endpoints before asset upload or submission. Takes, images, text-to-video, frame edits and character jobs check that fingerprint before submission, polling, cancellation or recovery. A different startup endpoint blocks those operations and preserves the original job ID, operation key and workflow. Restore the original engine configuration to recover the job. The binding contains no endpoint addresses or credentials; it identifies endpoint configuration, not an engine instance, account, model set or verified cloud worker.

Historical records without a binding are never silently assigned to a new target. Legacy recovery is permitted only when both startup endpoints use loopback addresses. A missing binding on a non-loopback target, or any malformed existing binding, blocks recovery. Completed local outputs remain available. Real provider account isolation and provider-specific recovery still require separate validation before cloud execution can be enabled.

## SDK execution boundary

The startup renderer uses the real Comfy SDK inside a dedicated Node worker. Its endpoint and credential are captured when the studio starts, in a copied worker environment; candidate connection changes do not mutate that environment or the main process. SDK jobs, workflows and assets stay inside the worker. The studio exchanges bounded workflow JSON, file bindings, safe job snapshots and progress. Inputs and streamed output files must stay within the configured local data directories, with real-path checks inside the worker.

Output identities are opaque. The tested local v2 proxy returns signed identifiers rather than UUIDs; the adapter retains these privately and passes them unchanged to SDK retrieval. They are bounded separately from job IDs and operation keys and are not included in browser job responses.

Uploads retain the SDK's asset hashing, materialization and idempotency behavior. Output downloads stream to a temporary sibling file before publication. Progress uses a separate pull stream, so it does not block status polling, cancellation or concurrent downloads. Pending requests, streams and retained SDK handles are bounded. Errors expose fixed messages and an allow-listed code/status rather than provider response text, credentials or signed URLs.

A deadline, interrupted submit or stopped worker does not trigger a new generation. The existing job record and operation key remain the basis for recovery; the studio must be restarted after a worker failure. The SDK's job lookup currently has no abort parameter: a cancelled local wait discards its late result, while the SDK's own 30-second request timeout bounds the underlying lookup. Refresh, cancellation and event operations use the SDK's abort support.

Loopback contract tests exercise two workers with different endpoints and credentials but identical job and output IDs. They cover real SDK asset upload, a throttled submission retry with the same key, polling, cancellation, progress and streamed downloads. They also check ambiguous submission failures, bounded requests, file/client ownership and rejection of invalid mutated graphs before IPC. This validates the native adapter boundary; it does not establish a cloud account's billing ownership, compatibility or recovery behavior. Native workflow deployment remains disabled.

## Before native workflow deployment can become available

A supported execution profile must provide Aftertake's exact custom nodes, models, media upload/download behavior and output metadata contract. Character replacement also needs the pinned H3 Relay recipe, SAM3 and its required model files. A generic Comfy endpoint is not sufficient evidence of compatibility.

The account owner must separately establish an eligible subscription, credits and the deployment's billing rules before native workflow deployment is enabled. This settings framework performs no account creation, purchase, deployment provisioning or billable trial. It does not assume that a visitor's personal credits pay for another workspace's managed endpoint. Explicit hosted LTX generation is a different integration and uses the connected Comfy Router workspace.

The application also needs verified provider-specific job routing and recovery before it can activate a remote connection. A shared hosted service additionally needs authenticated users, isolated credentials, media and job ownership, and a secure credential lifecycle. The current settings are connection preparation for an owner-run local studio, not a shared hosted BYOK service.

## Local API

- `GET /api/compute` returns safe connection and capability status.
- `POST /api/compute/connection` accepts `{ "provider": "local" }`, `{ "provider": "comfy-cloud", "apiKey": "..." }`, or `{ "provider": "managed-deployment", "endpoint": "https://example.run.comfy.app", "apiKey": "..." }`. Remote keys can be omitted until a later connection update.
- `POST /api/compute/probe` explicitly checks the selected candidate or local engine.
- `DELETE /api/compute/connection` clears the candidate and its memory-held key.

These routes retain the local studio's existing loopback host and same-origin write restrictions. Client-supplied claims such as `billingVerified` or `compatibilityVerified` are rejected.

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
