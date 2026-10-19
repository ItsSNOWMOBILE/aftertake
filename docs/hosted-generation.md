# Generate with Comfy credits

Aftertake's optional hosted video studio creates short **LTX-2.5 Fast** videos
through Comfy Router, then saves the MP4 locally for editing in Film. This path
needs no CUDA GPU, local diffusion models or running ComfyUI engine.

It currently supports text prompts, landscape or portrait 720p, two to five
seconds, 24 fps and optional generated sound. Character replacement, painted
edits, reference-frame animation and custom Comfy graphs still use the native
workflows. Selecting hosted video does not reroute those workflows or their jobs.

## Start locally

Install Node.js 22.12+, pnpm, Git and Python 3.12, then run:

```sh
git clone https://github.com/ItsSNOWMOBILE/aftertake.git
cd aftertake
git switch hosted-rendering
pnpm install --frozen-lockfile
python scripts/setup-film.py
pnpm dev
```

Open **http://127.0.0.1:4310** and open the hosted video studio. The small CPU
Film runtime checks downloaded video and assembles exports; no generation-model
download is needed. If the studio was running during installation, restart it.
For an existing custom Python installation, use the media runtime configuration
in the [local setup guide](../README.md#run-locally).

1. Create an API key in your [Comfy workspace](https://platform.comfy.org/).
   Use a workspace with credits and access to the selected model.
2. Enter the key in the local studio and choose **Connect key**. **Check
   connection** reads model access without starting a video. A successful check
   does not establish the available balance or guarantee generation admission.
3. Write a prompt, select the canvas, length and sound setting, and optionally
   choose **Check estimated cost**.
4. Choose **Create video with Comfy credits**. This explicitly submits a paid
   generation. Review the result, download its **MP4**, or choose **Add to Film**.

The public recorded browser editor does not accept keys or run paid generation.
This feature is for your own local studio, not a shared account or public
multi-user credential service.

## Router, Cloud and billing

[Comfy Router](https://docs.comfy.org/development/comfy-router/quickstart) uses
workspace credits per model call and does not require a subscription. Comfy
Cloud workflow runs have separate eligibility and subscription requirements.
The existing [Render setup framework](cloud-setup.md) prepares Cloud or managed
workflow connections; it does not deploy Aftertake's custom nodes or turn native
character replacement into a Router call.

An estimate can be unavailable even when generation works. Aftertake displays
that as unknown; it does not invent a price or treat the call as free. Quotes
can change before billing, and a successful quote does not reserve credits.
Check the Comfy workspace's usage and billing records for settled charges.
[Router billing documentation](https://docs.comfy.org/development/comfy-router/billing)
explains the distinction.

## Credentials and recovery

The key is held in local server memory and cleared on disconnect or restart.
Aftertake does not save it in project JSON, browser storage, logs or `.env`.
Prompts and request history are saved separately: browser draft storage retains
the draft and operation identity, while the local data directory retains the
input, credential fingerprint, original provider handle and job state. Downloaded
MP4s and clip metadata are saved in that workspace.

Restarting does not automatically submit paid work. Reconnect the **same API
key and workspace** and check the saved request. Another key is intentionally
rejected for recovery, even if you believe it belongs to the same account.
Interrupted submission keeps its original operation key and input; recovery
reuses those instead of creating another take. Aftertake stops replaying an
unconfirmed submission beyond its conservative 23-hour window. Do not create a
replacement merely because a connection timed out: accepted work may still run
and be charged. See [Router recovery rules](https://docs.comfy.org/development/comfy-router/errors).

**Cancel** requests cancellation and keeps checking the original job. Already
running work can finish and be charged; a successful result is still collected.
Removing the key stops local tracking and does not establish that the provider
stopped. The [queue contract](https://docs.comfy.org/development/comfy-router/queue)
describes authoritative cancellation outcomes and result retention.

## Saved outputs and reproducibility

Aftertake downloads the provider result promptly because hosted result URLs
expire. The current LTX schema documents a 24-hour output URL lifetime; replay
does not renew it. Keep the downloaded MP4 and local workspace rather than relying
on a remote link. A missing or changed local MP4 can be collected again from its
original handle only while the provider still retains it.

If a saved request is corrupted or has been renamed, Aftertake retains the file
and blocks new paid submissions. Restore the original record and restart the
studio before continuing. Discarding an unresolved record can hide already billed
work; changing its operation key is not a recovery method.

**Save request** exports the model input and available output measurements and
hash. The hosted model schema exposes no seed: this records how to repeat the
request, not a promise of pixel-identical regeneration. The measured output clock
is preserved; for example, a two-second request can return 49 frames at 24 fps
(2.0417 seconds). Film uses the actual saved clip duration.

## Competition profile

Hosted integration is developed on the dedicated `hosted-rendering` branch. The
[native competition snapshot](https://github.com/ItsSNOWMOBILE/aftertake/tree/550ca00e0729c941c514bd529e5e8b6f3283f109)
and its existing demo remain separate evidence of local open-weight workflows.
Optional Router use is **not proven compatible with Open Weights Only**. The
[official category rule](https://comfy.org/open-source-higgsfield/) excludes
partner nodes and closed-source APIs; it grants no stated exemption for an
optional backend. Hosted outputs must be identified as such, and their presence
must not be presented as proof of category eligibility.
