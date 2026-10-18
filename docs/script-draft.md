# Draft spoken copy from a brief

In Film, arrange up to sixteen pictures, then open **Make a narrated cut →
Draft from a brief**. Describe the product, audience and tone. Correct each
picture description after looking at the footage; this text model does not
inspect video. A supplied closing line is retained exactly.

Click **Draft spoken lines**, review the suggestions, then **Use these draft
lines** to copy them into the existing script fields. This action replaces
written lines only. Edit the wording and factual details before preparing,
previewing and using the narrated cut. Nothing is voiced or exported merely
because the model finished. Short picture coverage still rejects a long voice;
speech is never silently truncated or footage stretched.

## Optional local setup

```sh
python scripts/setup-script.py
```

This installs OpenVINO GenAI 2026.4.1 in a separate `script-venv` and downloads
the pinned, approximately 2.29 GB Qwen3-4B INT4 conversion. Revisions, individual
file sizes, SHA-256 values and the Apache-2.0 model license are in
`models-script.json`. Every inference checks those files. Model weights are
separate from the source packages. Script drafting uses eight CPU threads and
leaves the RTX for Comfy generation. Manual script writing remains available
without this model. Kokoro voice setup remains a separate optional step.
The conversion is published by [OpenVINO](https://huggingface.co/OpenVINO/Qwen3-4B-int4-ov);
the original model is [Qwen3-4B](https://huggingface.co/Qwen/Qwen3-4B).

`AFTERTAKE_SCRIPT_PYTHON` and `AFTERTAKE_SCRIPT_MODEL` can select an existing
compatible local runtime and the exact pinned model directory. Restart the
studio after installing or changing those settings. No hosted language-model
API or account is needed. The optional runtime uses only the selected local
files for inference.

## Requests and recovery

The native API persists a request bound to its brief, picture descriptions,
durations, closing line, variation and model revision. Identical requests rejoin
the same draft before runtime admission. **Draft another version** deliberately
changes its variation. Proposals remain separate from the written script.
Changing the brief or pictures invalidates the old proposal's Apply action.

Page reload restores the saved draft. If the native studio restarts during
inference, **Rejoin script draft** resumes that original request. A Python file
lock and atomic result cache handle a worker that outlived its parent without
duplicating inference for that draft. Completed results remain readable without
the model runtime. Native cache files do not depend on an MCP client session.

The local MCP adds `aftertake_draft_script`, `aftertake_script_status` and
`aftertake_rejoin_script`. They use this same native job and return the proposed
lines and model receipt. Review them before passing authored lines to narration
and the existing film plan tools. Nineteen typed MCP tools are now exposed.

## Actual proof and limits

`examples/script-draft/` contains an actual 5.33-second, 720 × 1280 / 24 fps
UI export, its editable project, complete voices and the original model
proposal. Two lines were edited. Decoded source inspection corrected the order
to grounds, water over grounds, then brewed coffee into a cup. All 128 export
frames have the expected timestamps; complete-voice correlations exceed .9999.
The embedded native project matches, and all eleven word timings remain editable.
Actual official MCP clients rejoined the script without changing its result file.
A fresh CPU workspace also imported and re-exported this project with the script
and narration runtimes absent and Comfy unavailable. All 128 decoded frames
match exactly; complete decoded audio correlation is effectively one. The new
joined-word mapper receipt and all eleven supplied timings remain portable.

The model can invent details even with a restrictive prompt. These are draft
suggestions, not automatic factual review, campaign strategy or performance
optimization. The smaller NPU-compatible Phi trial ran on this machine's Intel
AI Boost, but its wording and constraints were inadequate. It is not enabled in
the app. `hardware-check.json` records the bounded NPU result separately.

The live flow also exposed eSpeak joining “with the” into one phoneme group.
Follow voice now splits such a group only when the complete individual phoneme
strings exactly match the recorded timed sequence. Each split uses a recorded
phoneme boundary. Unmatched or ambiguous units still reject this style. Older
failed mappings can be regenerated after this mapper upgrade; valid existing
timings remain reusable. These remain model-duration estimates that need review.
