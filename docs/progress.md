# Build evidence — October 18, 2026

## Native text-to-video and generated sound

**Create video** now samples empty LTX-2.5 video/audio latents directly from
text. It exposes 2–5 second shots, landscape/portrait/square canvases,
draft/final resolution, optional generated sound, prompt-based camera/lens/light
direction and native grading. This closes the previous source-free video gap;
it does not establish long-form generation or geometric camera control.

Three actual native jobs completed on the 16 GB RTX 5080 / 32 GB Windows host:
73-frame landscape draft with sound (79.92 s engine time), 73-frame final
portrait with sound (82.68 s), and 49-frame silent square draft (61.13 s).
The portrait was started from the actual UI. Native MCP stdio created the
square job, rejoined its exact job ID after reconnect, rejected changed inputs
under that same key, returned three decoded inspection images and imported the
verified clip into Film with content reuse. These are individual measurements.

Before a completed video becomes a source clip, the server verifies the
embedded request/graph and actual decoded dimensions, frame count, zero-origin
24 fps clock and selected sound. Generated audio uses the shared AAC finishing
path with full-duration padding/cropping, continuous audio timestamps and
preserved encoded video pixels. A stereo-frequency/padding fixture verifies
channel order, retained video frames/metadata and cleanup of temporary data.

The UI has persisted history, exact settings reuse, recipe import/export and
raw Comfy graph download, original-operation recovery, Film import and source
handoff. An actual recipe download/reimport restored portrait/final/sound/seed;
repeated UI Film import reused the existing verified bytes. Recorded public
examples remain read-only; new generation and Film export require the local app.

The preferred portrait and separate silent draft, graphs, model manifest,
native receipts and actual UI capture are in `examples/text-video/`. The square
draft's bottle proportions and exposure drift; prompt camera guidance and
general product identity still require review. Existing H3 demo exports remain
the same reviewed bytes. No cloud credit, partner node or competition
submission was used for this addition.

## Native H3 character replacement

The local studio now has a dedicated character workspace and seven matching MCP
tools. Native SAM3 detects whole people, click/exclusion points disambiguate the
target, and native video tracking produces a lossless mask plus a moving review
overlay. Changing the source range or selection points invalidates the old
selection. Missing tracking frames block replacement.

The installed, pinned H3 Relay recipe uses native model loading, H3 reference
conditioning, source audio, latent edit masks, sampling and continuation loops.
The original photo is the primary identity/outfit reference; an optional crop
of its actual head supplies facial detail. A preliminary Qwen appearance redraw
is no longer part of this path. Reference and source clothing are explicit
policies. The existing Wan motion-transfer workflow remains available separately.

A short native API render caught reference-order/wardrobe errors during visual
review and was revised. The full qualification then completed 262 real frames
at 24 fps across five native windows on the 16 GB RTX 5080 / 32 GB Windows host.
All decoded timestamps match the frame grid and no adjacent frames are exactly
duplicated. Source audio is trimmed/re-encoded by the shared AAC exporter;
zero-lag waveform correlation was 0.99993, without claiming identical encoded
audio bytes. Identity and window-boundary frames were visually reviewed. These
few fixtures do not establish general likeness, articulation or occlusion quality.
User-supplied test media and their outputs remain private and outside the repo.

The first longer run exhausted host memory. Disabling intermediate node caching
completed the same full range. The opt-in Windows weight-copy fallback preserves
PyTorch copies for file-backed CPU/GPU transfers, avoiding the observed native
host-buffer failure without changing weights or model math. Engine flags expose
both policies and a process-local FFmpeg directory. Models can live on a separate
disk. H3 inference uses CUDA; the NPU is not used by this workflow.

The workspace includes history, original/result review on the matched prepared
canvas, face focus by drag or keyboard-editable coordinates, recipes, native
workflow/mask/source downloads and Film handoff. Real MCP stdio inspection
returned mask and result frames, rejoined the exact SDK job after reconnect,
and rejected stale mask hashes or changed inputs under the original key.
An HTTP regression covers review media stored under a hidden workspace directory.

Validation: 81 TypeScript tests, 49 Python tests, the production build and 27 live
Comfy graph input/output-link contracts pass. No competition entry was submitted.
The demonstration's older character shots have been replaced in fresh native
Film exports: 44.42 seconds / 1,066 frames and 71.67 seconds / 1,720 frames.
Both use the same reviewed H3 bridge take, tracked by SAM3 and rendered across
two native windows. All 73 face frames and the continuation boundary were
reviewed. The raw case, mask, photo, source, recipes and executed graphs live in
`examples/character-h3/`; no private user test media is included.

The longer cut now says "H3 keeps the performance," with a matching new 1.932s
local voice and editable caption. Independent transcription matches that line.
Every whole voice waveform was aligned in both final exports; decoded frame
clocks and continuous audio timestamps pass. The critical 44–46s interval has
49 regular frames and no identical adjacent frames. Before/after shots use the
same prepared canvas and source clock. Native H3 prompt reconstruction and
paused project reveals replace the earlier UI recordings. Capture receipts
describe their edited timing and the finite self-reveal capture pass.

The native Film export SHAs are
`45eceb3f9b049bafd92300e6d1983bd7427df65160ff1d61290084344bdc639b`
and `f2b4cbd46bcbada52e36d1d5c80f0bf47ca24e3eded3393c9ce8313b18ee3a93`.
Jay retains final review and submission. The older portrait utilities remain
separate historical comparisons.

## Stable-portrait head candidate and image shot direction

A separate `create-head-performance.py` utility now animates one aligned portrait
with the original video's relative head pose and direct lip-expression components.
It uses CPU landmarks for placement, separately annotated SAM head masks and
local fill only where the old head is exposed. Six portrait files and all SAM
files are pinned and verified. Inputs, annotations, coverage matte and separate
subject arrays are bound by the output receipt. This remains an experimental
CLI, separate from studio/MCP controls and audio-driven dialogue.

The actual bridge candidate has 73 frames at 24 fps, 768 × 432, SHA-256
`5492bafb10ebc0044f4277e5996e40ecac53f6f328caa26d8aff6d185ec9db68`.
All decoded face frames and normal/half-speed playback were reviewed. A second
run from the shipped relative request produced identical MP4 bytes and all
73 identical decoded frames. Protected pixels remain exact before encoding;
mean decoded protected RGB difference is 1.67/255. Hair annotation was corrected
after a rejected mask dropped it. The relative full-expression and lip-normalized
variants were rejected; direct lip expression followed the source more closely.
Neck/background seams and portrait sharpness still need creative review.
The earlier 71.67-second judge revision imported the stable-portrait head pass;
the current H3 export described above supersedes it.
Its shortened model label clears the face. A fresh actual native editor reveal
shows the paused character preview and a real timeline selection of the brand
shot, avoiding low-rate screen recordings of moving footage. Voice requests,
source hashes and placements are unchanged. Final review remains Jay's.

Comfy's cinematic-studio reference informed the local image studio's new shot,
lens and lighting choices and its exact generation-prompt preview. Shared schema
validation preserves settings through recipe export, reuse and MCP requests;
older recipes keep their original prompt. Native UI generation produced a
1024-square unbranded skincare still with close framing, portrait-lens wording
and soft-window-light wording in the actual executed text node. SDK job
`49b2856c-8faa-4187-9fa9-76e8ff58ad9a` succeeded; output SHA-256 is
`49b6fb69b111f4dfa649027d3fd9af20208272fbcfc40342af9d984cd112ff50`.
The PNG is retained locally. This single sample does not prove general prompt
adherence or physically simulated optics. No Router or closed image model ran.

Seventy-seven TypeScript tests, forty-four Python tests and the production build
pass. The full checks caught an older example-import regression after identical
raw/result files were consolidated. Import now resolves each output role through
the verified manifest, preserving both files without requiring duplicate source
blobs. The native hidden-checkout test now opens both affected examples and checks
their raw bytes. Jay retains final review and competition submission.

## Local lower-face performance finish

The character section's provenance is Wan Animate followed by a reviewed SAM
subject/foreground composite. It is not an LTX talking-head pass, and its source
excerpt is silent. Three initial LivePortrait trials did not improve it enough
to replace the shot. A corrected fixed driving crop and a compact tracked
lower-face blend produced the subsequent candidate in `examples/face-performance/`.

The optional `create-face-performance.py` utility verifies both media hashes,
the pinned official code revision and six model files before local inference.
It rejects short or mismatched frame clocks. LivePortrait runs on CUDA and
203-point landmarks run on CPU; no InsightFace detection weights or NPU are used.
It retains the measured plate head pose and writes an alpha movie and receipt.
This is a separate command-line utility, not an added UI control or MCP tool.

All 73 decoded face crops and synchronized before/after playback were reviewed.
On this one source performance, tracked lip-ratio correlation rises from .843
to .953 and mean absolute error drops about 24%. This geometric diagnostic is
not a perceptual-quality or viseme score. Protected pixels are exact before
encoding; the mean decoded RGB difference outside the matte is 1.69/255.
Head-turn fidelity remains limited. The source's wide-open mouth is part of its
original acting. See `/cast/performance.html` and `docs/face-performance.md`.

The preceding 71.67-second judge project retained its narration and cut clocks,
uses the refined lower-face footage and explicitly labels the pass. Its native
editor reveal was freshly recorded at 1280 × 720 from the updated project.
Forty-one Python tests pass, including rejection of a mismatched driver clock
and insufficient source coverage. Jay's review and submission remain pending.

Two subsequent native Wan Animate studies narrowed the performer focus to the
head, generating at 768 × 672 before returning to the 768 × 432 plate. The first
held the parent appearance, seed, sampler, motion strength and caption fixed;
the second changed only the motion caption to request the final profile turn.
Both completed with 73 frames on the exact 24 fps clock. The closer view improved
detail but weakened the turn and regenerated background inside the crop. Neither
is an accepted composite or a published replacement. A stronger caption did not
resolve those observed problems; neither crop movie replaced the judge footage.

The performance page's phone download actions now use a two-column grid. At a
390 × 844 viewport all four actions have equal widths and heights, with no
horizontal overflow. This layout change does not alter the media or recipes.

## Reviewed local script drafts

Film's narrated-cut panel now offers **Draft from a brief**. An optional pinned
Qwen3-4B INT4 model proposes one short line per written picture description,
with constrained JSON and an exact supplied closing line. It uses eight CPU
threads. Proposals stay separate from authored copy until explicitly applied;
changed inputs invalidate their application. The request and model receipt are
persisted before inference. A process lock and atomic result cache let native
recovery rejoin the original worker after restart. The MCP now exposes nineteen
tools, including draft, status and rejoin operations.

An actual three-picture coffee request took 5.92 seconds of CPU generation.
The UI retained its existing copy during drafting and restored the proposal
after page reload. Two lines were edited. Export inspection caught swapped
picture descriptions, which were corrected using actual decoded source frames.
The final 5.33-second portrait film now shows grounds, water over grounds, then
brewed coffee into a cup, with the matching narration. It has 128 frames at
24 fps, three cuts, three editable titles, three complete voices and eleven
word timings. Complete voice correlations exceed .9999; its embedded native
project matches. MCP requests rejoined the same script without rewriting its
result file. See `examples/script-draft/` and `/ads/script.html`.
The portable project also re-exported in a fresh CPU-only workspace with both
optional language/voice runtimes absent and Comfy unavailable. All 128 decoded
frames match exactly (RGB mean absolute error zero); complete audio correlation
is effectively one. The new mapper receipt and all eleven timings survived.

The workflow exposed eSpeak merging “with the” into a single phoneme group.
The mapper now splits joined groups only when the complete per-word phoneme
sequence exactly matches the recorded sequence, using measured phoneme
boundaries. It never divides an unmeasured interval. Unmatched units still
reject Follow voice. Old failed timing caches can be regenerated under this
mapper; valid existing timings remain reusable. The actual four-word repair is
retained beside the film. Seventy-six TypeScript tests, thirty-seven Python
tests and the production build pass.

The Intel AI Boost also ran a real Phi language-model trial: 41.0 seconds cold
load and 12.42 seconds generation. Its unconstrained and constrained copy was
unsuitable, so that model is not enabled in the app. Smaller Qwen copy also
added unsupported details. The chosen model still needs human review; no
automatic factual review or campaign-performance claim is made. Trial weights
were removed after retaining immutable manifests and results. The 44-second and
72-second movie bytes remain unchanged. Two additional byte-identical raw
camera copies now reference canonical results in the source manifest; all 727
runtime media roles and their hashes remain, and legacy public URLs are kept.

## Agent generation joins native editing

The local MCP now exposes sixteen typed tools. Agents can inspect the generation
workspace, create a Z-Image still, edit a Qwen reference, render a native video
recipe, observe/reconcile/cancel that same operation, and transfer a verified
source into Film. Source imports use the native normalizer. The API persists
caller keys and original input digests before SDK admission; repeated inputs
rejoin the same native record, while changed inputs under that key are rejected.
Unknown admissions retain their original saved graphs and SDK keys. Recovery
checks original media and waits for other generation work before resubmission.
An older running native backend is refused until restarted with this protocol.

An actual official MCP client generated a 1024-square unbranded headphone
reference, inspected it, then rendered a 97-frame square LTX camera take on the
local RTX 5080. Four decoded frames retain the rigid product silhouette during
a gentle push. One complete Kokoro line and all five supplied word timings
were assembled into a 60-frame, 2.5-second native Film export. Its embedded
project matches and complete-voice correlation is .99997 after the measured
239-sample mixer delay. The actual native UI reopened its editable picture,
type and voice. Repeating the image/take requests after client reconnect and a
native studio restart returned the same IDs; the take count stayed at fourteen.
See `examples/agent-generation/` and the public `/agent/generate.html` proof.

The companion portable project also imported and exported in a fresh CPU studio
with unavailable Comfy endpoints and an absent narration runtime. Its sixty
decoded picture frames match exactly (RGB mean absolute error zero), as does
the complete decoded audio (correlation one). It retained all five word timings
and reused the same native export on repeat. See `portable-reopen.json`.

Seventy-three TypeScript tests and the production build pass, including native
restart tests and MCP reconnect/routing tests. Mock routing tests establish the
contract, not additional GPU-generation quality. This one short product shot
does not establish full Higgsfield parity or arbitrary identity consistency.
The 44-second and 72-second demo movie bytes remain unchanged. Seven verified
identical preparation copies were removed; projects now reference their exact
canonical example bytes, preserving every source hash and the complete edit.

## Portable voice receipts and script recovery

A clean CPU-only import exposed a real defect: WAVs and title times reopened,
but their voice metadata was discarded, so unchanged lines attempted synthesis.
Film import now verifies media hashes and measured durations, validates scripts
and word intervals, and restores supplied voice receipts. Different receipts
for identical WAVs receive separate local identities; existing provenance stays
intact. Imported receipts are identified in the UI. Timed voices also satisfy
plain typography requests, avoiding unnecessary synthesis when the look changes.

For recognizable short cuts, **Use this film's narration** recovers the saved
lines, uniform voice settings and typography into the narrated-cut builder.
The actual UI restored the three-line coffee ad, prepared both Follow voice and
bold variants from its existing WAVs, and exported the restored Follow voice
cut. The separate film runtime had no Torch or Kokoro, its configured voice
runtime was absent, and both Comfy endpoints were unavailable. All 143 decoded
picture frames and the complete decoded audio match the original exactly.
The six-asset library did not grow; exact voices also rejoined after restart.
See `examples/spoken-type/voice-roundtrip.json`.

Eight older portable project files now retain 63 previously omitted receipts.
All 17 film project files validate, with 114 inline voice receipts, and all
102 distinct project sources retain their hashes. An actual MCP save enriched
an older project without changing its edit, layer IDs, ledger, creation time
or existing export job. Seventy TypeScript tests, the production build and
twelve renderer checks pass. The published demo films remain unchanged.

## Consolidated entry candidate

The new 71.67-second narrated candidate is available at `/judges/`. It starts
with the finished Follow voice coffee ad, then records the real narrated-cut
builder, manual word timing, an alternate hook and a verified MCP edit. Image
creation, LTX animation, camera controls, ending-frame guidance, Qwen reference
editing and the timed castle cue follow. The human section uses the stronger
focused take with reviewed arm and foreground protection. The final chapters
explain the implementation and contribution, then reveal this exact project
playing in the native editor. Jay has not approved or submitted it.

It has 29 cuts, 44 editable titles, 21 complete outer narration clips and the
three complete voices in its embedded opening ad. All 1,720 frames have correct
24 fps timestamps. Complete voice correlations exceed .9998 after the measured
239-sample (about 5 ms) mixer delay; the complete opening ad audio exceeds .9999.
The embedded project and every source hash match. Actual UI captures use one
1280 × 720 viewport. Castle and character comparisons retain the same source
clock and geometry, with three-frame blends and no added zoom. The 44-second
creative cut is unchanged. Character head turn and mouth performance remain
imperfect; selected-frame and technical checks do not establish general quality.
The prior 81-second candidate remains recoverable in Git history.


## Speech-following typography

The narrated-cut builder now offers **Follow voice**: fixed-layout phrases with
the current word highlighted. The pinned Kokoro ONNX model already returns
phoneme durations. The app maps these to written words while retaining actual
trim/pause offsets; it needs no extra runtime model. Expanded units such as
“20%” remain one written unit. Ambiguous counts reject this style rather than
inventing timings. All four voice presets, percentage copy and contractions
completed actual local timing-generation checks.

Timing stays editable per word in Film. Controls bound edits against adjacent
words. Changing title copy clears its stale timing and switches to Fade. The
native UI test verified a manual start-time change in the actual preview,
re-preparation from the same three cached voices and unchanged export reuse.
The final coffee film has 143 frames at 24 fps, three complete voices and
twelve timed words; source bytes and embedded project match. Whole-voice
correlations exceed .999. Reviewed frames cover all twelve highlights.

The small Whisper model's short-line times differed by up to 230 ms. An
independent Apache-2.0 Wav2Vec2 CTC review places these twelve starts within
49 ms of Kokoro's estimates. Word ends differ more, and both are estimates.
Raw transcripts retain the Your/You're ambiguity and the CTC greedy errors.
The CTC review is optional research, with its model revision/hash pinned; it
does not become an app dependency or a universal timing-accuracy claim.

The source/project/voices and review evidence are in `examples/spoken-type/`;
the phone review is `type/spoken.html`. Sixty-five TypeScript tests, 36 Python
tests and the production build pass. The renderer regression checks word
highlights, gaps and a phrase change across an actual cut. Word controls also
fit the actual 390-pixel phone viewport without horizontal overflow. Redundant
castle source copies were removed after byte comparison; the packager restores
their existing public download URLs from hash-verified canonical examples.
The supplied project was also imported and re-exported in a separate CPU film
runtime with unavailable Comfy endpoints and no Torch or Kokoro installation.
All 143 decoded frames match the native export exactly; all six source hashes,
word timings and idempotent export reuse survived. See `cpu-reexport.json`.
No submission sent.

## Narrated cuts for short-form work

Film now prepares a voiced edit from up to sixteen selected pictures and one
written line per picture. The UI uses the same content-bound beat compiler as
the local MCP. It measures full voices, retains source trim origins and framing,
rejects insufficient footage, and prepares editable captions and short dissolves.
The main viewer previews the candidate before applying it; the previous draft
can be restored. Scripts/settings persist, and exact voice requests reuse bytes.

The actual native UI produced two six-second portrait coffee variants from
licensed Michael Burrows footage. Changing the opening line reused the body
voices and footage. A fresh 20.08-second walkthrough records actual typing,
preparation, both exports and a native-project reveal. The local MCP saved and
exported its final five-beat project. Repeating export returned the same job.
Its final shot contains the recorded UI, replacing the capture-pass still.
All media, source receipts, WAVs and editable projects are in
`examples/narrated-cut/`; the phone review is `ads/workflow.html`.

The real export exposed a floating-point title intersection at an exact cut
boundary. Title intersections and source trims now use integer frame ranges.
A separate complete-voice check found gain pumping when mastered ad sound was
mixed with raw narration. Mastering now measures the whole mix and applies
constant gain with true-peak headroom. A regression checks the entire quieter
line's waveform and envelope. New export identities include renderer revision.

The walkthrough contains 482 frames at 24 fps, five outer titles, three outer
voice tracks and six embedded ad voice instances. All nine whole-voice
correlations exceed .998; the embedded project and source hashes match.
Unprompted Whisper retains a trailing per-line hallucination and a split
“walk through” in its whole transcript; the raw report is included. Selected
chapter, title and reveal frames were visually reviewed. Sixty-three TypeScript
tests, 32 Python tests and the production build pass.

The main 44-second repaired cut and 81-second technical review remain unchanged.
They cover ads, typography, images, animation, localized VFX, natural character
replacement, recipe reuse and editing; ending-frame and camera-track walkthroughs
remain absent from the short cut. The newer focused performer take remains a
separate review. No full Higgsfield parity or campaign-performance claim is made.
Jay still reviews and submits. GitHub synchronization awaits its new permission;
matching source snapshots remain available through the showcase.

Goal remains active: win at least an RTX 5090. No award or completed submission
has been claimed. This is a working prototype with substantial quality work left.

## Focused performer review

An experimental performer box now crops the driver and scene-matched appearance
together, gives Wan a larger view of the person, and restores the generation
to its original scene position before applying paint or a tracked matte.
Focus bounds survive sharing, alter take matching and reject a saved generation
from another setup. The unmodified model crop is available for inspection.

The actual native A/B held captions, source, appearance, seed, sampler and quality
constant. The focused take follows more of the ending head turn than the
unfocused control. Separate strength and caption tests retain the tradeoffs:
lower strength weakens the turn; the selected shorter caption still exaggerates
the mouth. Int8 cache, reduced reference strength, Euler and a slower full-model
comparison did not convincingly repair the turn in this local study.

The new review is `cast/focus.html`. Its native saved-generation finishing pass
is `2142bfcc-c491-4cf3-a2be-69e7b9408c91`, SDK job
`bfaa1c5c-08f2-48e4-a2b0-a0f2aaebea29`. The result has 73 frames at 24 fps,
768 × 432, SHA-256
`619e6e44b7c4d1632de970791859c44c97289f32045073cc3f49fa75c2d076e2`.
Selected matched frames retain both arms and the original woman's foreground
hand and face. Source pixels are exact wherever alpha is zero before display
resizing and encoding; encoded protected-subject interior RGB MAE is 1.99/255
against the source passed through the same resize. This is a measured codec
difference, not a general perceptual-quality guarantee.

The native UI generated the comparison and imported its exact generation and
reviewed local SAM matte for finishing. Fifty-nine TypeScript tests, 30 Python
tests and the production build pass. Controls were checked at 390-pixel phone
width. Exact records, recipes, model crops, placed generations, annotations and
receipts are retained under `examples/performer-focus/`; research media is in
the complete source archives. The 44-second and 81-second films retain their
previous takes pending this separate review. No submission was sent.

## Earlier narrated tools and workflow review (superseded)

A separate 81.42-second judges’ candidate now explains the actual model roles,
cue-guided compositing, annotated subject protection, local MCP editing and
the combined contribution. It retains the coffee ad opening, natural human
replacement and a fresh capture of its own native Film project at the reveal.
The 44-second review 10 video is unchanged byte for byte. Neither cut is
approved or submitted. The human head turn remains under-followed.

The actual Film export contains 1,954 frames at 24 fps, 34 cuts, 36 title layers
and 26 whole voice clips. Every frame timestamp, continuous audio clock and
embedded project were checked. Complete-voice correlations exceed .996;
independent unprompted ASR retains brand-name and isolated-word ambiguities.
Model-clause visual cuts were placed against measured speech and bound to the
voice checksum. Paired beat frames and critical technical/reveal frames were
reviewed visually. Evidence is in `judges-film-evidence.json`; editable media,
voices and projects are under `examples/judges-film/`.

The first real MCP UI recording exposed a preview loading defect: its clock
could advance before a new clip decoded. Film now prepares the upcoming shot
and pauses picture/narration time until the current picture is ready. A fresh
asset-URL playback check sampled both dissolves with no unready visible video
samples and reached the full 6.5-second ending. The rejected capture was replaced
before publication. Fifty-seven TypeScript tests, 29 Python tests and the
production build pass. No general perceptual-quality or full feature-parity
claim follows from those checks.

## Local MCP editing and CPU-only reproduction

A real stdio MCP server now exposes nine typed editing tools. Agents can inspect
source frames, import selected film media, measure local Kokoro speech, compile
a persistent picture/voice/title plan, export through the native Film renderer,
rejoin recorded jobs and inspect decoded export frames. This is an editing
interface for existing footage and completed takes; it contains no LLM or hosted
inference dependency and does not expose new video-generation tools yet.

The real coffee proof is 6.5 seconds, 156 frames, portrait 720 × 1280 at 24 fps,
with three whole voices and matching editable captions. An actual MCP client
reconnected to its saved plan and export; repeated requests returned the same
job. A deliberately short picture interval was rejected. Source-frame review
corrected the first trim to show the coffee grounds entering the filter.
The project imports into the native Film editor with all three cuts, titles
and sound clips. Separate ASR transcribes all three lines correctly; complete
voice correlations range from .993 to .999. These are integrity checks, not a
creative-quality score.

Native film export now accepts persistent idempotency keys and rejects a changed
edit under an existing key. Exact narration requests verify and reuse cached
bytes. The UI no longer silently truncates newly added audio; trimming imported
audio is an explicit choice. A Windows code-page bug in the new review-report
pipe was found by the actual run and fixed with ASCII JSON escaping; its test
preserves accented and non-Latin metadata under a forced legacy encoding.

A second full MCP edit used a freshly installed CPU film runtime, with Comfy
endpoints unavailable, and completed import, narration, export and decoded
review. The small installer now includes the NumPy dependency needed by PyAV
frame conversion and audio diagnostics. Video/image generation still needs
the local Comfy engine. Evidence: `agent-edit-evidence.json`; usage: `mcp.md`.

Official entry requirements were rechecked in the expanded contest page on
October 18. The public GitHub branch remains stale because both connector and
noninteractive Git authentication fail. Matching current source ZIPs remain
the publication path. The new judges’ candidate supplies the techniques and
contribution explanation; it still needs Jay's approval. No entry or social post is sent.

## Composite and transition repairs — review 10

Jay identified a clipped arm, a purple castle boundary and jumping joins in
review 9. Those were real defects missed by the earlier visual review. The
character generation had a complete arm, but the broad painted composite cut
it. A reviewed SAM 2.1 subject matte now follows source and generated silhouettes
and separately protects the woman's foreground hand. The native saved-generation
finishing path reuses the exact raw take and checks its embedded generation
receipt. Model weights, annotations, inputs, output hashes and executed graphs
are included or pinned. This remains an annotated workflow; the model's head
turn still follows the source incompletely.

The castle rerender matches low-frequency boundary color to the source. Final
video geometry is restored from the 768 × 448 model grid to the source's
768 × 432 display geometry. Scene-matched appearance references share the
driver's transform. UI shots use fixed framing, and castle/character comparisons
continue the same source clock instead of restarting the result at zero.

A moving-bar test exposed a held frame near an FFmpeg dissolve despite correct
total frame counts. Picture joins now blend explicit integer frame indices.
The regression checks all 90 motion positions across two dissolves, a hard cut
and source EOF, rather than relying on static-color joins or timestamp counts.

Review 10 is 44.42 seconds: 24 cuts, 20 title layers and 20 whole voice clips.
It adds text-to-image, frame animation, region controls and recipe reuse while
retaining ads, hooks, natural character replacement and the actual editor reveal.
All 1,066 frame timestamps, embedded project and voice-source correlations pass;
paired beat frames and per-line ASR were reviewed separately. Fifty-two
TypeScript tests, twelve node Python tests, nine actual film-render tests and
the production build pass. Evidence: `visual-repair-evidence.json` and
`narrated-film-evidence.json`.

The demo does not show every control: ending-frame editing, camera-track editing
and portable-workflow import are still outside this short cut. It is not full
Higgsfield feature parity. Public GitHub synchronization remains outstanding;
the showcase provides matching complete source ZIPs. Nothing is submitted.

## Faster review cut and editable dissolves

Review 9 is 41.79 seconds, down from 57.29 seconds (27% shorter). Shorter
voice lines, a 1.05 Kokoro delivery and tighter holds remove repeated explanation.
The complete coffee concept, actual prompt typing at recorded speed, natural
human replacement and authentic Film editor reveal remain. Every voice clip is
whole; speech is regenerated rather than stretched or cut off.

The native Film editor now previews, saves, restores and exports per-shot
dissolves. Overlap uses a shared 24 fps clock and is bounded to half of either
trim. Eleven selected 3–4-frame dissolves connect chapters and UI shots. The
source/result changes retain direct cuts. The 17-shot export has 18 title layers
and 18 whole voice clips; all 1,003 frame timestamps, embedded project, source
hashes, decoded join frames, audio continuity and complete voice alignment were
checked. Per-beat ASR confirms the revised script. Fifty TypeScript checks,
eight actual Python film-render checks and the production build pass. Nothing
has been submitted; Jay reviews and submits the entry.

## Natural human character replacement

Jay requested a natural-looking replacement for the silver character. Review 8
uses a fictional human in a brown field jacket and oatmeal sweater, generated
locally from text with Z-Image Turbo. A native detailed Qwen frame edit (20
steps, seed 5091) places the reference in the original bridge scene. The real
UI prompt is recaptured with the selected human reference; it replays the same
verified edit settings before selecting the appearance and rendering the video.

Two native Wan Animate 2 takes compare motion strengths 1.0 and 1.4. The selected
1.4 take retains the human appearance and scene; its head turn is still more
subdued than the source. It is 73 frames at 24 fps with no looping or slow
motion. Encoded RGB error outside the zero-alpha cue is 1.88 / 255. Source,
reference generation, frame edit, recipes, executed graphs and credits remain
in `examples/character-replacement/`. The silent Tears of Steel excerpt retains
its Blender Foundation CC BY 3.0 attribution; the soundtrack is excluded.

Review 8 remains 57.29 seconds with 18 cuts, 19 title layers and 19 whole voice
clips. It preserves the short-form ad opening and authentic editor reveal.
This is a review cut; Jay will make the contest submission after reviewing it.

## Motion stability and editable kinetic typography

Jay reported shake in the review footage. Two independent causes were verified:
the film's integer crop coordinates made slow zooms jump, and short external
VAE tiles blended different versions of moving scene edges. Fractional framing
fixes the first. Native video codecs keep each bounded LTX clip together and
fix most of the second in the tested scenes, without changing the backbone,
seed, prompt, camera track or output frame rate. The castle's same-latent
translation-spike diagnostic falls from 0.991 to 0.197 pixels at 960 × 540;
the observatory falls from 1.744 to 0.139. These are diagnostics, not a general
perceptual-quality score. Some deformation and limited detail remain.

Fresh app runs replace the coast, castle camera and observatory examples.
Their executed graphs, SDK job identities, hashes and full comparison results
are in `generation-motion-evidence.json`. A reproducible SDK comparison helper
is included. Production retains the existing ConvVAE; a heavier diffusion
decoder was tested separately and remains experimental.

Jay clarified that the requested typography was animated text in demo videos.
The Film editor now has word-build, typewriter, impact and wipe presets, editable
entrance duration and type size, per-title replay, and a pinned desktop preview.
An actual 12-second app export and its editable project live in
`examples/kinetic-type/`. New rendered tests check the readable hold, actual
motion pixels and phase continuity when a cut crosses an animated title.

The refreshed 57-second review cut was exported through the actual Film editor
with the new coast/castle outputs, selected kinetic title entrances and a fresh
editor reveal. All 1,367 frame timestamps and the embedded editable project were
verified. Its decoded narration is identical to review 4. Forty-nine TypeScript
checks, seven real film-render checks and the production build pass. The public
showcase includes the silent 12-second typography sample and matching source.

Nothing has been submitted to the contest or posted on Jay's behalf.

## Editorial repair after user rejection

The 116-second narrated film was rejected by Jay for poor cutting and mismatched
text, narration and pictures. Its technical waveform checks did not establish
editorial quality. In particular, “Cut it here” appeared over the generation
viewer, and transformations did not coincide with their spoken descriptions.

The replacement review cut is 57 seconds, follows one coastal transformation,
and pairs 20 complete voice recordings with their pictures and captions. Its
real painted-cue playback and film-editor playback replace several static
captures. Text is larger; headline typography no longer uses a rounded box.
The reveal shows the new project and moving timeline. A timing ledger is in
`examples/submission-film/storyboard.json`. No approval or submission is claimed.

The export stalled again in the global delayed-title filter graph. Typography
now renders within each intersecting cut, retaining global fade phase across
cut boundaries. Source audio stays PCM until the final encode, and narration
is mastered separately. Real decoded exports test fades across cuts, framing,
normalization, and preservation of every voice opening. These remain technical
checks, separate from the visual/semantic review and Jay’s approval.

## Verified

- RTX 5080 16 GB / 32 GB RAM, PyTorch 2.11.0 CUDA 13.0, ComfyUI 0.41.0.
- All five original LTX-2 artifacts downloaded and SHA-256 verified.
- Official `@comfyorg/sdk` submits real jobs through the self-hosted v2 proxy.
- Draft renders at 512 × 288 / 49 frames / 16 fps.
- A tracked finish render at 768 × 448 / 97 frames / 24 fps.
- Composite and raw generation files downloaded through the official SDK.
- Brush rasterization, temporal envelope, source preservation, frame mismatch
  rejection and bidirectional optical-flow tracking have automated tests.
- Studio preview opens and plays actual renders. Before/after scrubbing works.
- CPU tracked-mask preview completes in the real editor (the hidden-directory
  `sendFile` issue was fixed and the PNG verified over HTTP).
- Export ComfyUI workflow works through the UI; actual downloaded JSON inspected.
- Model adapter access approved by the user; gated inpainting LoRA downloaded
  through the user's browser and verified against published SHA-256.

## Actual generations

| Local render | Result | Observations |
| --- | --- | --- |
| `a2037bff-931f-414f-ae6f-a6105d768706` | GPU success, 149.14 s | Small mask produced a dull patch. First output save node used `videos`; proxy expects `gifs`. Outputs recovered from verified native history, save node corrected. |
| `2c3b5f86-e8b0-4fca-a960-551273142135` | Complete SDK round trip, 71.91 s | Broad moss coverage produces a clear transformation. CUDA 13 cut sampling from ~93 s to ~12 s on these different draft runs. |
| `8116bdf7-492e-43c3-8105-ac10addcc64a` | Complete SDK round trip, 118.24 s | 768 × 448 / 97 frames with flow-tracked cue. Consistent greenery; boundary quality still needs improvement. |
| `3a9e2e89-095e-45da-bea0-ea45508165f9` | Complete SDK round trip | Live-action actors preserved in composite, but the frost instruction largely failed. This is negative quality evidence, not a successful showcase. |

Videos and recipes are under `.data/`. Contact sheets and source research are
under `.runtime/evidence/` and `.runtime/sources/`. Those folders are ignored.

## Native inpainting execution

All three LTX-2.5 public artifacts and the gated adapter are installed and
SHA-256 verified. Both draft and two-stage finish have executed on the RTX 5080.

| Render | Evidence |
| --- | --- |
| `7394891b-ad76-406e-8216-7762c0097247` | Native draft completed in 75.17 s. Coherent greenery, weaker wall coverage than requested. |
| `39c84d21-c7b7-4e5f-8a08-dbe85bfa3ed5` | Early finish completed in 81.10 s but lost the transformation. Negative quality evidence. |
| `d4b47413-80e8-4a0f-99ad-9e4e44c1aeb4` | Consistent conditioning mask alone did not solve the tiny coarse pass: invented a person. Negative quality evidence. |
| `ca56f918-ba61-4935-86ca-13814f22d56c` | 512-pixel coarse pass and reference samplers retained foliage through refinement, 87.67 s. Coarse, raw and composite outputs inspected. |
| `0bc7df85-955e-4d36-8da2-a9f16bedb77c` | Clear blue portal in the original room study, 83.92 s. Temporal appearance/disappearance visible in the composite. |
| `d02a1b59-26d1-49d3-9075-f38a9b9ae8e7`, `656ceb50-8539-4fa7-9d3b-f9967c1276a4` | Small real-room mask ignored the portal instruction, including with CFG 3. Negative quality evidence. |
| `8acd01c3-b25a-4e3b-a730-a698d3a366e6` | Wider mask and untiled guide produced a clear live-action portal; duplicated a ceiling fixture. |
| `d88fb542-794b-4889-9726-dda98843325e` (isolated install) | Eraser protected the fan, clear portal retained. 80.96 s. Full SDK round trip in the fresh installation. |
| `fe2fd39c-aeb6-4c11-8a97-2bfc8204a094` | Narrow waterfall mask followed the golden-material prompt weakly. Negative quality evidence. |
| `515db4fc-5b10-4fbb-8606-866a695cd9d8` | Wider mask and untiled guide produced visibly glowing golden falls on licensed nature footage. Draft inspected. |
| `2a7c74eb-8313-499e-8276-6d598b0ac6d1` | Protected portal retained through 768 × 448 / 97-frame refinement. Fan remains the source in the final composite. |
| `c729f8fb-5919-4152-be2c-8eeb56c3ffcf` | Golden waterfall retained through 768 × 448 / 97-frame refinement. Surrounding forest restored by the composite. |

Current native guide uses a consistent spatial region, independently of the
temporal composite envelope. Fade-in of the green plate was removed. Finish
uses a 512-pixel coarse pass, Euler ancestral sampling, pyramid blend,
resize/re-encode, two Euler refinement steps with another seed, boundary blend
and exact-source compositing. Presets describe the masked region.

These are quality experiments, not a guarantee that any arbitrary prompt works.
Reference samples and attention/memory settings were checked against the pinned
Lightricks workflow. Larger regions often work better; protect foreground detail
with erase strokes. The original narrow-mask failures remain in local history.

Experimental public weights download with:

```sh
.runtime/venv/Scripts/python.exe scripts/download-models.py --ltx25
```

The resumable downloader retains `.part` files, pins revisions and verifies
SHA-256. It was repaired to resume truncated HTTP responses. Do not restart a
live download solely because an observation times out; inspect its session.

The inpainting adapter has been installed and its receipt is checked in.
No API key or browser cookie was extracted or created. Chrome's automated
download hit `ERR_BLOCKED_BY_CLIENT`; the user completed the ordinary download.

## Installation and reliability checks

- Installed pinned Python dependencies and cloned pinned runtime repositories
  into `.runtime/clean-check`, using `setup.py --skip-models`.
- Reused the already verified model directory through ComfyUI's extra search
  paths; the test did not redownload a second copy of the weights.
- The generated original source video has exactly the same SHA-256 as the
  first installation (`c54ab72b1e49289da2ea7df20e950a492e27a3c791da89d9e74da44031849b4b`).
- Fresh `pnpm install --frozen-lockfile`, production build, eight TypeScript
  tests, seven Python tests, and `pip check` passed.
- Started an isolated ComfyUI on 8198, proxy on 8199 and production studio on
  4311. Imported a clip and rendered through the official SDK.
- Restarted that studio during job `efb3e42f-fb74-4ff3-bfd8-e137f6555e9a`;
  it resumed the same ID. Native queue showed one running job and no pending
  duplicate before and after restart. The output then downloaded successfully.
- Cancellation test `228189b3-f07c-4fdf-9f44-65daba6bd9e9` reached `canceled`,
  and the native queue was empty. Engine log confirms interruption.
- Isolated test processes were stopped after completion; evidence and files
  remain local. This is a fresh installation on the same Windows machine,
  not a claim of testing other operating systems or GPUs.
- Browser video decoding failed under GPU pressure and recovered when idle
  weights were released. Engine reserves 3 GB; completed jobs release the cache.
  The editor's thumbnail videos were replaced with cached CPU-decoded JPEGs.
- UI now has paint/erase, visible brush radius, source range selection, quality
  timing clamping, global render admission state, and source selection on small
  screens. Output download remains `finalizing` until local files are available.
- Fonts are bundled locally under OFL, with source and hash receipts.

## Reviewable example workspace and UI checks

- Three reviewed examples are bundled under `examples/`, with source media,
  recipes, actual MP4-embedded graphs, original render records and SHA-256
  manifest. Research actor footage is excluded.
- `pnpm demo` copies them into `.data-demo` and starts a separate local studio
  on port 4312. Its banner identifies the results as pre-rendered. New output
  still requires an actual connected Comfy engine.
- A separate source copy at `.runtime/no-python-demo` has no Python/runtime
  directory and no engine connection. Its studio on 4313 loaded and played
  all three outputs. Edited workflows exported through the UI without Python.
- Cached source thumbnails cover every 24-fps source position. Trimming to
  0.2 seconds loaded all ten visible filmstrip images without Python.
- Example loader checks passed: repeat initialization is idempotent; different
  existing files are preserved; modified assets and path traversal are rejected.
- The main UI imported a real MP4, loaded its recipe, and rejected a deliberately
  mismatched source hash. Downloaded video SHA-256 matches the stored output.
- Exported native workflow has the expected green-plate node and untiled guide.
  An unchanged historical take now exports its recorded graph; edits export
  the newly built graph. Changed settings are explicitly labeled above playback.
- Before/after source and output both reached `readyState=4` at time 1.5 seconds.
- Chrome at 390 × 844 verified source selection, controls and persistence.
  Brush-control overflow was fixed (`scrollWidth=clientWidth=375`). An unpainted
  project now survives reload; render validation still requires paint.
- Latest suite: ten TypeScript tests and seven Python tests. Production build
  passes. These checks do not imply universal prompt-following or other GPU/OS
  compatibility.

## Higgsfield replacement expansion, October 17

- Public Genjutsu, Cinema Studio, apps/effects and three open-source projects
  were reviewed. Coverage and unimplemented capabilities are tracked in
  `higgsfield-benchmark.md`. No third-party application code was copied.
- REA 6.5.0 completed bounded static analysis of two public Higgsfield scripts;
  203,090 bytes and 48,363 AST nodes, no parse errors. This is partial client
  evidence, not the private backend implementation.
- Added a real LTX-2.5 first-frame animation workflow without the masked-edit
  adapter. PNG/JPEG/WebP imports normalize EXIF orientation to an RGB PNG;
  preview and conditioning use that same normalized reference.
- Added camera/lens/lighting prompt controls, a view of the exact compiled
  encoder prompt, named saved looks and reuse across sources.
- `ade9d68a-6a3f-431d-8970-2b37f482aa4f` / job
  `703bb028-8684-4fed-bea9-c4a682cdc7a0`: 49 frames at 512 × 288,
  16 fps, successfully generated a coherent forward move from a still room.
  Browser playback reached readyState 4 and advanced normally.
- `1279f0f7-4d76-46d7-a900-dbdf89a19359` / job
  `7345d182-8209-4000-8bb3-7bf708c37065`: 97 frames at 768 × 448,
  24 fps. Generation completed, but did not reliably follow the static camera
  or monochrome prompt. This is negative control-adherence evidence.
- Added `AftertakeFilmGrade`: consistent warm/cool/monochrome grading after
  generation, with an untouched source-color option and separate raw output.
  `2b2262f9-899f-47c6-99dd-5fb2198f5ec9` / job
  `b2fcbe60-8045-4235-8038-62f10107a7a0` completed 49 frames. Decoded
  monochrome channel separation is exactly zero across all frames.
  A requested pullback still moved forward; motion-track conditioning is
  being investigated before claiming reliable camera control.
- Actual browser paint/erase/render test
  `f352d93e-92d4-4cca-959a-21ee014a3d55` / job
  `a2186b13-894c-4b87-9b3b-1646ae5e6e27` completed and retained the portal
  and protected fan. Captures show the actual cue, submission and result.
- Live schema integration checks cover all six pipeline/quality combinations,
  checking required inputs and output links without submitting jobs. The first
  animation attempt correctly exposed a missing `bypass` input; fixed and the
  rejected attempt retained. Typed admission rejections now become failed
  takes; transport uncertainty still blocks blind retry.
- Suite: 14 TypeScript and 10 Python tests; production build passes. Photo
  orientation, corrupt imports and deterministic grading are included.
- Four reviewed examples are now bundled (about 14.4 MiB), including actual
  photo animation. The example loader tolerates semantically identical JSON
  formatting while preserving genuinely different existing data.
- GitHub was reconnected by the user, but connector reads still return
  `UNAUTHORIZED`; publication is not yet verified.

### Motion-conditioned framing

- Downloaded the public motion adapter from pinned publisher revision
  `572bb9c9a1ba3d8e8724cce69783ffc2422386db`; 327,309,314 bytes,
  SHA-256 `e279807ee3aa3db1ce60188d665ff83342860367dcd6bac19f8bd5a99a9e1dca`.
  No additional account gate or credentials were needed.
- The app derives 12 screen-space trajectories from the framing direction.
  Its source overlay and native `LTXVDrawTracks` use the same coordinates.
  The guide conditions the IC-LoRA; guide tokens are cropped before decode.
  The exact guide video is downloaded alongside raw and graded results.
- Initial guided attempt `9863fb84-9d63-4684-8176-dceb45a77642` failed because
  the ref0.5 adapter needs pixel dimensions divisible by 64. Draft geometry
  now selects a nearby aspect-preserving 64-pixel grid (576 × 320 for this room).
- `4d104079-d530-47dd-936f-dade1212be0b` / job
  `04f16b30-2195-4cd3-b857-6e0baf1978df`: guided pullback completed. Visual
  inspection shows the room receding and new surrounding space appearing.
- `d6f1b874-8c93-49d4-b4f4-672fa9ddda9e` / job
  `e7385a8d-5401-482a-a2aa-c64336b9c8ab`: stationary tracks held the room's
  framing while the fan moved.
- `60dfef1a-02ef-4151-bb20-a2cfca21c676` / job
  `8c32f17a-7957-48e0-a253-ed891f5c6d9d`: guided finish also completed,
  97 frames at 768 × 448 / 24 fps, with the reference colors retained.
  The full-resolution pullback and its actual guide were visually inspected.
- First-to-last LK features + RANSAC partial-affine scale estimates:
  prompt pullback 1.0857, guided pullback 0.8681, prompt static 1.0487,
  guided static 1.00004. This is a screen-space engineering check on one
  room with different output sizes, not a calibrated 3D camera or controlled
  model benchmark. The directions agree with visual inspection.
- Orbit remains prompt-only. Track guidance, lens look and scene relighting
  need broader footage/scene testing before a reliability claim.
- Five reviewed examples are packaged (about 14.9 MiB), now including the
  successful guided pullback and its actual guide video.
- Latest suite: 15 TypeScript + 10 Python tests. Eight workflow variants pass
  the live required-input and output-link schema checks. Production build passes.
- A 68-second captioned submission-demo draft has been composed from actual
  app captures and generated outputs. Export QA passed: 1,632 decoded frames,
  1280 × 720, 24 fps, exactly 68 seconds, approximately 4.1 MB. Captions and
  representative frames were visually reviewed. No
  simulated progress, cloud inference, voice service or external music is used.
- All five examples played from a fresh data directory with Python set to an
  absent executable and both engine endpoints offline. The guided example
  reached readyState 4 and played; an edited pan workflow exported 12 correctly
  directed tracks without the runtime.
- The five-case manifest verifies all 350 runtime assets (15,607,918 bytes).
  Display titles are curated independently of the original render records;
  original names, timestamps, job IDs and MP4 metadata stay intact.
- At 390 × 844, the animation controls and source picker have no horizontal
  overflow (clientWidth = scrollWidth = 375). A saved film look survived a
  source change and reload. Scene text resets for the new source while the
  film look persists. A reload bug selecting the cue view for an unfinished
  animation was fixed.
- A real rejected SDK submission returned `InvalidWorkflow`, code
  `invalid_workflow`, HTTP 422. Error classification was corrected to recognize
  the high-level SDK `ComfyError` as well as protocol `ApiError`; unknown
  transport results remain ambiguous. Partial workflows can execute a valid
  independent guide output even when the main output is invalid, so successful
  admission alone is not treated as a usable take.

## Sound, upright footage and film assembly — October 17

- The native loader, probe and thumbnails share one display-matrix handler.
  All eight orthogonal rotation/mirror combinations match FFmpeg autorotation.
  Image EXIF normalization remains separate and still strips source metadata.
- Region-edit output node 21 muxes the original first audio stream, starting at
  the same source trim as the visual frames. It copies the encoded picture,
  pads a short audio track with silence and retains recipe/workflow metadata.
  Raw generation and reference-frame animation remain silent.
- Actual SDK masked edit `d8b43e02-0dc3-4d9f-b163-664841ee5745`, job
  `bccc81f3-88a0-4884-b752-2bf64a21ebdf`, completed on the RTX 5080:
  49 upright frames, 512 × 288, 16 fps, 3.0625 seconds. Source has a 90-degree
  display matrix and a procedural two-tone audio fixture. After a 0.5-second
  trim, decoded output has the expected 440 Hz / 880 Hz transition. Evidence:
  `.runtime/evidence/audio-native-proof.json` and `upright-audio-native.jpg`.
- The preview mute control directs sound to exactly one player: source or
  output. Comparison uses the output track. Switching views pauses playback
  and preserves the playhead; metadata load restores the result's position.
- The film desk adds, orders, removes and trims up to eight finished takes.
  Canvas options are 1280 × 720, 720 × 1280 and 720 × 720, all 24 fps.
  It letterboxes to preserve framing, retains source audio and supplies silence
  for silent takes. A CPU-only FFmpeg filter timeline encodes the cuts together.
- Film exports and in-progress state persist. Interrupted assembly is reported
  as failed with its cut list retained. A portable manifest embeds recipes,
  actual workflows and output SHA-256 hashes. Manifest import resolves matching
  local output bytes, independent of render IDs, before restoring the cut list.
- A real three-shot browser export `c1f62857-9fed-4932-b92c-9611fac594ef`
  decoded to exactly 254 frames / 10.583333 seconds. Two additional real exports,
  portrait `e3cc88cb-d2f1-44bd-add0-dba37c19f5ac` and square
  `dcec93a9-47e7-4482-b558-df99cf763cf7`, decoded to exactly 96 frames / 4 seconds,
  retained the two tone frequencies, and had zero sound in the silent second cut.
  Evidence: `.runtime/evidence/film-assembly-proof.json`.
- The first film iteration hit Windows' command-line length limit with full
  motion-track graphs. Metadata now travels in a UTF-8 FFmetadata file. A test
  round-trips over 100 KB including escape characters. A second iteration exposed
  a two-frame mixed-rate shortfall; explicit frame-grid trims and one concat
  filter fixed it. Failed/earlier iterations are retained locally as evidence.
- Manifest download/import passed through the in-app browser. Chrome playback
  reached readyState 4 and played the exported 10.583333-second film. Film controls
  have no horizontal overflow at 1280 × 900 or 390 × 844. Chrome's extension file
  upload setting was unavailable; its UI was tested by adding takes directly.
- Latest suite: 17 TypeScript + 13 Python tests; production build and all eight
  live Comfy workflow contracts pass. No additional GPU generation is required
  for film assembly.
- The captioned demo now includes the actual film desk and reviewed three-shot
  export: `.runtime/demo-output/aftertake-demo-v2.mp4`, exactly 85 seconds,
  2,040 decoded frames, 1280 × 720 at 24 fps, approximately 5.9 MB. The original
  68-second draft is retained. No fabricated app state or render progress is used.
- The example-only workspace still starts without Python or an engine. Its film
  list returns successfully; export reports the missing local runtime explicitly.

## Searchable recipes and first-frame pilots — October 17

- The Recipes library presents five real, reviewed outputs with their source
  previews, actual render settings, direction, attribution and license notices.
  Three region effects and two camera recipes can be searched by words/tags and
  filtered by category. Posters are extracted from the actual output at 1.5 s.
- Explore an example opens its recorded source and result without generating.
  Existing native/example outputs are reused only after checking source/output
  hashes. New local copies retain the original render identity in an explicit
  example-origin field. Repeated opens reuse the imported take. Shared still
  sources are deduplicated; existing source bytes are checked before reuse.
- Use on my source preserves source identity, trim, quality, seed and painted
  cue. Region effects apply the recorded prompt/method. Camera recipes apply
  camera/look settings and retain the user's scene direction. Still images
  cannot accept a region effect. The library pauses background studio playback.
- Actual browser checks covered search, source/result playback, applying gold
  to the current room cue, offline example opening/playback, and the still-image
  compatibility guard. No Python or engine was available to the offline app.
  At 390 × 844: page client/scroll widths both 375, dialog widths both 349.
  At 1280 × 900: page widths both 1265, dialog widths both 1038. Keyboard focus
  stays within the library and Escape restores focus to its trigger.
- The packaged manifest now verifies 355 runtime files / 15,763,202 bytes,
  including five posters. The five original renders and their metadata are
  unchanged. No additional illustrative media is presented as generated output.
- Latest suite: 20 TypeScript + 13 Python tests; production build and all eight
  live required-input/output-link contracts pass.
- Reference research: the official LTX-2.5 inpainting workflow supports an edited
  first frame for replacement. A draft SDK pilot inserted LTXVImgToVideoInplace
  before the inpainting guide, conditioned on a prior edited room frame. Job
  `ec0da214-d934-4b1e-92e9-2654657ca372` produced 49 frames at 512 × 288 / 16 fps.
  The opening raw frame differed from the resized reference by mean 2.135 levels
  per RGB channel (8-bit scale); the portal remained stable in the contact sheet.
- A finish pilot conditioned both stages, including the re-encoded high-res
  latent. Job `16e201a4-96dd-491f-99ba-c1469f5f79c0` produced 97 frames at
  768 × 448 / 24 fps. Opening-frame mean difference was 1.764 levels; the portal
  remained stable across the four-second shot. Raw/full composites and actual
  workflow metadata are retained in `.runtime/reference-inpaint/`, with
  `contact-final.jpg` and `verification-final.json`. These are internal pilots,
  not a user-facing identity-swap feature or a general reference-consistency
  benchmark. Product integration and broader scenes remain to be done.
- The separate LTX-2.3 Ingredients adapter requires its own publisher access
  gate and a matching 2.3 stack. It was not downloaded. The successful pilots
  use the installed 2.5 weights and existing inpainting adapter.

## Edited first frames and six-case walkthrough — October 17

- Native masked edits now accept an optional edited full frame. Export the
  selected starting frame as an upright, full-resolution PNG, edit it, then
  upload or select the reference. Incompatible image geometry is rejected
  without replacing the current reference. Source/range changes and new effect
  directions clear an old reference; manual prompt edits preserve it.
- `LTXVImgToVideoInplace` conditions the coarse latent and, for Finish, the
  refinement latent. Both stages receive the same SDK-uploaded image. Source
  compositing and audio continue to use the original video. Source and reference
  are rebound to canonical local metadata and their actual bytes are checked
  against SHA-256 hashes before GPU submission.
- Real app render `49b0792c-855f-43ed-b656-403351bb0976`, SDK job
  `2d52f915-4304-4f3f-81b6-cdf6a49c25a5`, completed on the RTX 5080:
  97 frames, 768 × 448, 24 fps, 4.041667 seconds. Its raw opening frame has
  mean absolute difference 1.764 RGB levels from the resized reference on an
  8-bit scale. Unselected pixels at 1.5 s differ from the resized source by
  1.319 levels after lossy encoding. The contact sheet shows the timed portal
  appearing and disappearing while the fan stays protected. Evidence:
  `.runtime/evidence/reference-app-proof.json` and `reference-app-contact.jpg`.
- The reference is a frame from the prior local portal output, based on the
  attributed Curtis Adams / Pexels source. No closed image API was used.
  Reference SHA-256:
  `eb1e002ac8b403d8dee60f9f233d5c67c2d9a1d693be3a83156c38cdfc10aaf4`.
  This proves this edited-frame workflow on one scene, not general arbitrary
  identity replacement.
- Browser checks covered full-resolution source export, upload, inspection,
  rendering, recipe download/removal/re-import, and rejection of a portrait
  reference while retaining the valid image. Recipes resolve both assets by
  content hash, independent of local IDs. The exported starting frame matched
  the decoded source RGB pixels and contained no EXIF metadata.
- The sixth reviewed case, **An image to follow**, includes its edited frame,
  source, output, both generation stages, recipe and executed graph. The
  manifest verifies 363 runtime files / 17,029,376 bytes. A fresh example
  workspace opens all six cases. Without Python or an engine, the reference
  preview and source/result playback work, both videos reach readyState 4,
  thumbnails load, and new generation stays disabled.
- Desktop panes now scroll independently and keep the render action visible.
  Checks at 1280 × 900 show the full preview, cue timeline and render button;
  page client/scroll widths are both 1280. At 390 × 844 the page widths are
  both 375 and the reference dialog widths both 349. Reference selection
  survives reload. Screenshots: `reference-desktop.png`, `reference-mobile.png`
  in `.runtime/evidence/`.
- Fixed sampling inside the final source frame's display interval. Automated
  checks compare full-frame export and native loading at multiple timestamps;
  out-of-range trim still fails. A real native loader-only SDK job
  `37e427ee-9632-4b65-a3a6-ddde91c4994d` also passed after the engine restart.
- Latest checks: 23 TypeScript + 14 Python tests, production build, and all ten
  live workflow required-input/output-link contracts pass. Contract checking
  submits no GPU jobs.
- The updated captioned demo includes the six-case recipe library and actual
  edited-frame output: `.runtime/demo-output/aftertake-demo-v3.mp4`, exactly
  97 seconds / 2,328 decoded frames, 1280 × 720 at 24 fps, 6,329,320 bytes.
  Representative frames were visually reviewed; all frames decoded. Evidence:
  `.runtime/evidence/demo-v3-proof.json` and `demo-v3-contact.jpg`. Earlier
  drafts are retained. Publication and the public repository URL remain pending.

## Local frame editing and the complete appearance chain — October 17

- The studio can now create an edited appearance with Qwen-Image-Edit-2511,
  using the selected source frame and an optional second image. Fast mode uses
  the four-step Lightning adapter; Detailed uses twenty steps and the base
  model. Both expose the seed. The result requires explicit review and selection
  before it becomes a video reference. The spatial cue still applies to video
  generation/compositing; the image editor receives the complete source frame.
- Four optional model files total 23,732,843,846 bytes. Repository revisions,
  SHA-256 hashes and Apache-2.0 license metadata are pinned in
  `docs/models-frame-editor.json`; all downloads were verified. The installed
  Comfy stack required no new custom-node dependency. Both image and video
  submission use the official Comfy SDK and the existing local proxy.
- Real UI Fast edit `5009120d-9816-41d2-9733-032b32541a1f`, SDK job
  `ab6bc3ce-4672-4b69-b160-10e37658fae5`, created a turquoise crystal in the
  licensed forest shot. The native engine reported 45.80 seconds. Its PNG is
  768 × 432, SHA-256
  `2723bccd53c823e306777d755d3dc0184f28b85e7b6a7bf4294688bea4944858`.
- The reviewed frame was applied in the UI, the cue extended, and a Finish
  video rendered: `bbe90566-782e-49c2-b308-43a1643103d9`, SDK job
  `a8528116-b73d-4b05-a79a-3dd6b5655d15`. It decoded to 97 frames at
  768 × 448 / 24 fps. The native engine reported 88.41 seconds. The crystal
  stays coherent in the contact sheet and the temporal cue brings it in/out.
  Both LTX stages use the same uploaded frame. Unselected pixels at 1.5 s have
  mean absolute source difference 1.892 RGB levels after lossy encoding. Raw
  opening-frame difference from the resized reference is 6.614 levels; reference
  conditioning does not promise pixel-exact reproduction. Evidence:
  `.runtime/evidence/frame-editor-chain-proof.json` and `crystal-video-contact.jpg`.
- Detailed two-image edit `d3a00f2a-7cf1-406d-9285-25eaafde09e3`, SDK job
  `12af69ed-acf6-4b3b-aee8-18a9bf8e5186`, reused the turquoise crystal as its
  second reference and changed it to ruby red. The native engine reported
  197.64 seconds. During generation the web server was stopped and restarted;
  the same job ID resumed, with one running native job and none pending.
  The final PNG retains the pointed shape and red material. Evidence:
  `.runtime/evidence/frame-editor-detail-proof.json`. This is one synthetic
  object test, not a general character/identity benchmark.
- Frame jobs, outputs and actual PNG-embedded graphs persist. A frame becomes
  available only after its complete PNG, dimensions and workflow are verified.
  Recovery preserves the idempotency key after an ambiguous submission. Image
  and video admission share a guard in each studio workspace. Automated tests
  cover these paths and incomplete/missing PNG metadata.
- Sharing exposed a real normalization edge case: the downloaded generated PNG
  contains workflow metadata, while importing an image strips metadata. Imports
  now retain a verified original-file hash as well as the normalized-file hash.
  Recipe matching prefers exact bytes, then recognizes an original image upload
  and rebinds to its normalized local file. A clean-workspace browser test
  imported the original video recipe with new asset IDs, preserving cue/prompt.
  The normalized reference has identical RGB pixels, no EXIF/workflow metadata,
  and its actual bytes pass canonical asset verification. Evidence:
  `.runtime/evidence/frame-recipe-roundtrip-proof.json` and `frame-recipe-roundtrip.png`.
- The frame editor also imports its own shared recipes. In the same clean
  workspace, the Detailed two-image recipe resolved the normalized subject by
  its original upload hash and restored its prompt, twenty-step mode and seed
  732. Importing created no GPU job. Screenshot:
  `.runtime/evidence/frame-edit-recipe-import.png`.
- The seventh packaged case includes both image/video recipes, generated frame,
  raw/refined video stages and actual graphs. The manifest verifies 373 runtime
  files / 22,653,766 bytes. The example workspace also includes the completed
  frame-edit record, so the frame editor can display its history offline.
- At 1280 × 900, page client/scroll widths are both 1280; the frame dialog is
  1100 × 828 with client/scroll widths both 1088. At 390 × 844 the page widths
  are both 375 and the dialog client/scroll widths both 354. History selection,
  Escape/focus restoration and Chrome frame-recipe download passed. With no
  Python or engine, the bundled frame loads, source/result players reach
  readyState 4, and new frame generation remains disabled. Screenshots:
  `.runtime/evidence/frame-editor-desktop.png` and `frame-editor-mobile.png`.
- Latest checks: 27 TypeScript + 14 Python tests, production build, and all
  fourteen live workflow input/output-link contracts pass. These contract
  checks submit no jobs. Model quality evidence remains limited to this GPU
  and the documented scenes.
- The updated demo includes actual in-studio appearance editing and the crystal
  video: `.runtime/demo-output/aftertake-demo-v4.mp4`, 97 seconds / 2,328 decoded
  frames, 1280 × 720 / 24 fps, 7,068,830 bytes. Representative frames were
  visually reviewed. Evidence: `demo-v4-proof.json` and `demo-v4-contact.jpg`
  under `.runtime/evidence/`. Public repository/demo upload remain pending;
  the GitHub connector still returns `UNAUTHORIZED` after the user's reconnect.

## Publication preparation — October 17

- Chrome has an authenticated GitHub browser session even though the connector
  still returns `UNAUTHORIZED`. The repository importer can create the public
  `ItsSNOWMOBILE/aftertake` repository; that name is available. Source credentials
  are kept empty because the reviewed import source is public and read-only.
- Audited 571 tracked historical blobs for excluded runtime paths, embedded
  credential patterns, signed download links and machine-specific user paths;
  no findings. All seven existing commits use the agent's non-personal identity.
  The temporary export serves Git clone files only, with directory listing,
  configuration files and writes unavailable. It exposes no running studio API.
- `docs/index.html` and its assets provide the captioned 97-second demo,
  source/setup links, hardware context and source/model attribution. The MP4 is
  the verified v4 demo, copied unchanged. The document is prepared for GitHub
  Pages publication from `/docs`; deployment remains to be verified.
- Local document QA: desktop page widths both 1265, mobile widths both 375;
  native video reaches readyState 4 with duration 97 s at 1280 × 720, and the
  Watch action starts playback. The Copy commands control copied the exact
  displayed setup commands. No model generation occurs on this document.

## Clean-clone portability correction — October 17

- A complete clone from the read-only HTTPS export installed its frozen pnpm
  lockfile and built successfully. Its template HTTP test exposed a hidden-path
  issue: Express rejected an absolute media path containing `.runtime` in the
  checkout location. Example assets now use a contained relative path and an
  explicit root, retaining the dotfile-denial policy inside that root.
- The regression test copies the real example catalog into a hidden checkout
  and exercises preview serving and source/result imports without Python or a
  GPU. All 27 TypeScript tests and the production build pass after the fix. The
  HTTPS clone was then fast-forwarded to the fix, passed its own tests/build,
  and launched all seven examples with Python absent and engine URLs offline.
  Poster, video, reference PNG and frame-recipe routes returned their expected
  MIME types. Evidence: `.runtime/publication/clean-clone-proof.json`.
- GitHub initially returned HTTP 500 in the import view and no anonymous Git
  refs. The importer subsequently recovered; public access was verified below.

## Public source and demo — October 17

- [The MIT repository](https://github.com/ItsSNOWMOBILE/aftertake) is public.
  Anonymous HTTPS Git fetch returns the published branch and complete source.
  Its application files, tests and example assets match the independently
  tested clean clone; the hidden-checkout media fix and regression are included.
- [The demo document](https://itssnowmobile.github.io/aftertake/) is live on
  GitHub Pages from the repository's `/docs` folder. Its native video reaches
  readyState 4, plays successfully, and reports 97 seconds at 1280 × 720.
  The public MP4 is the reviewed v4 file, SHA-256
  `4e3b93a34e16890dd103aeff897ca3c05fea5e2f0fb720586ea5948a136bf066`.
- The GitHub connector remains unauthorized, but the authenticated browser
  allowed import, source updates and Pages deployment. The separate Git device
  authorization was not needed and expired without completion. Its tab is
  closed. The temporary read-only Git export and tunnel have been stopped.
- Publication does not constitute competition registration, a social post,
  submission, category acceptance or an award. Those remain outstanding.

## Tracking on low-detail camera moves — October 17

- Controlled camera transforms of the licensed room and forest starting frames
  exposed distortion over blank walls. Dense flow now uses a guarded camera
  estimate where the local image cannot determine motion. Distributed feature
  tracks must agree before this fallback is used; textured regions retain dense
  flow. It requires no additional model or service.
- At 512 × 288 over 49 frames, mask intersection-over-union against the known
  transform improved as follows. These are synthetic camera moves on frozen
  real textures, not a general natural-video or occlusion benchmark.

  | Scene / move | Original mean IoU | Updated mean IoU |
  | --- | --- | --- |
  | Room / pan | 0.913 | 0.992 |
  | Room / pan, zoom and roll | 0.896 | 0.990 |
  | Forest / pan | 0.988 | 0.989 |
  | Forest / pan, zoom and roll | 0.988 | 0.988 |

- Separate synthetic checks retain independently moving textured foregrounds
  with both static and moving backgrounds. A completely blank source safely
  falls back without inventing a camera estimate. Three meaningful regression
  tests bring the Python suite to 17 passing tests; all 27 TypeScript tests,
  production build and fourteen live node contracts also pass.
- The real CPU preview endpoint processed a compressed controlled-pan clip in
  3.30 seconds. Its decoded sprite alpha matches current node masks exactly.
  Preview cache versioning prevents an old mask from being reused after this
  algorithm update. Evidence is retained under `.runtime/evidence/` as
  `tracking-camera*-proof.json` and `tracking-preview-http-proof.json`.
- The idle engine was restarted with the updated nodes; installed source bytes
  match. No generation was active or queued. General tracking, occlusion and
  independently moving low-detail objects remain experimental.

## First and last frames — October 17

- Added the Cinema Studio start/end workflow to Animate a frame. The ending
  image can be uploaded, selected from imported images, inspected or created
  inside the existing Qwen frame editor. Applying a frame edit remains an
  explicit review action. Selecting the already-active mode retains the work.
- Followed the official LTX-2.5 first/last template: image guides at frame 0
  and -1, each at strength 0.7; appended guide tokens are removed before decode.
  This is single-stage video generation, using the installed public backbone,
  encoder and VAE. No new model or hosted inference API is required.
- Real SDK pilots completed at 512 × 288 / 49 frames and, with motion-track
  conditioning, 576 × 320 / 49 frames. Their job IDs are
  `c8e4ea68-7563-4f82-8968-0a17eafeba2e` and
  `6de350ed-e5eb-48a5-a20a-7b834fa4f11f`. Representative frames show a continuous
  forest waterfall-to-crystal transition, rather than an edited crossfade.
- The normal editor then submitted finished take
  `373aeb55-1569-411f-a541-7a7367617ec3`, SDK job
  `56c4d2a8-f985-46b8-ad9a-ef61346ea985`: 768 × 448, 97 frames, 24 fps.
  The executed graph retains both guide bindings and the ending-image hash.
  Decoded first/last RGB MAE to their respective resized references is 9.00 /
  9.12 on a 0–255 scale. Endpoints are soft constraints, not exact copied pixels.
- A separate engine-offline workspace imported the original source and the
  generated ending PNG. The actual browser recipe import found both new local
  identities after PNG metadata removal. Its exported recipe binds the ending
  to normalized SHA-256 `55294df019ef562cb1c8d1c34642bb9340443507e156cc62f5712c4d6d5c63ff`;
  original-hash matching recognizes the shared PNG. Normalized RGB is identical
  and image metadata is empty. Workflow export contains both guides and the
  portable `ENDING_FRAME.png` placeholder. Importing settings creates no jobs.
- Mobile width 375 has no horizontal overflow in the new controls or ending
  editor. Escape closes the dialog and restores focus. Evidence is retained
  in `.runtime/first-last-pilot/` and
  `.runtime/evidence/ending-frame-roundtrip-proof.json`.
- All 29 TypeScript tests, the production build and eighteen live workflow
  input/output-link contracts pass. The unchanged Python suite previously
  passed all 17 tests. Contract checks submit no generation jobs.
- This extends reference animation; it does not establish arbitrary character
  identity or motion transfer. General scene quality remains experimental.

## Video-driven motion transfer — October 17

- Added a separate Transfer motion surface using the pinned, public Wan
  Animate 2 distilled model. A raw driving video supplies motion; an imported
  or locally created appearance image supplies character and scene. The optional
  driving caption, both input hashes, seed and whole-frame/painted-cue scope
  survive recipe sharing. Source audio is connected in both scopes.
- Matched 384 × 512 / 49-frame pilots kept the appearance, seed and neutral
  prompts fixed. Mirroring only the driver changed the waved arm. SDK jobs:
  `65047d0f-129d-4e4a-b576-5dca93721312` and
  `d22ab8db-8300-4bcd-8457-126348f43938`. This establishes the controlled
  original-character test, not arbitrary human identity or facial performance.
- The normal browser studio completed 576 × 768 / 97-frame, 24 fps take
  `fe95d08b-acd6-4124-8aeb-175655fc5632`, SDK job
  `dfbe604b-d8c9-4b4d-a4c8-d1b6f3ee2aab`. The initial int8-cache version of
  this longer test was canceled after severe memory pressure. The native int4
  cache completed it in 259 seconds on the RTX 5080 / 32 GB machine. Draft
  retains int8 caching. Idle GPU models are released after terminal jobs,
  including canceled and failed generations.
- The new mode's Qwen editor then created and explicitly applied appearance
  `729c2e07-8881-4a36-8125-3f86ddd26efe`, SDK job
  `93c34eec-58cd-4b67-b882-a9adc414da22`. It completed a second real 97-frame
  motion take: `d18450f0-a9ca-4a2b-9d24-fd75d00664c6`, SDK job
  `7ec51815-4c35-47d6-8268-9bb6743e9d78`. The executed conditions bind the
  new source and generated PNG separately. The knitted appearance and arm
  gesture remain coherent in representative frames; pose timing can vary.
- A painted/timed draft with a 0.5-second source trim completed as
  `f94a2209-fe53-4ed3-a9b0-a6482fd55c1f`, SDK job
  `413ee209-1958-4f73-a2bf-53b4906585a3`: 384 × 512, 49 frames, 16 fps.
  Its original synthetic 440 Hz tone survives at 48 kHz for 3.062 seconds.
  Outside the zero-alpha cue, decoded RGB mean absolute error is 1.06 / 255;
  the compositor's exact-source guarantee remains before lossy encoding.
- A separate engine-offline workspace imported the shared source, generated
  PNG and actual browser-exported recipe. It rebound both new asset IDs and
  recognized the original PNG hash after normalization. RGB is unchanged and
  private PNG metadata is empty. Re-export retains the normalized image hash,
  motion caption and scope, and produces both portable input placeholders.
  Importing/exporting settings created no jobs.
- Appearance inspection previews the actual center crop without stretching.
  At mobile width 375, the three creation modes and crop dialog have no
  horizontal overflow. Escape restores focus to the inspection control.
  Quality controls are disabled while restoring a project or rendering.
- New take exports now use the executed graph embedded in the downloaded MP4,
  after verifying its recipe; they no longer expose the pre-upload placeholder
  graph as the recorded execution. Portable unrendered graphs retain placeholders.
- The four Wan artifacts total 24,907,108,099 bytes, all SHA-256 verified.
  Setup/download/engine scripts support a remembered separate model disk while
  retaining the existing local folders. A normal supervisor restart found Wan,
  LTX cinema, inpainting and Qwen profiles ready.
- All 34 TypeScript tests, 17 Python tests, the production build and twenty-two
  live workflow input/output-link contracts pass. Evidence is retained under
  `.runtime/research/motion-transfer/` and `.runtime/evidence/motion-transfer*`.
  These new local studies are not yet in the seven-example public media bundle.

## Frame-history reuse — October 17

- Reopening the frame editor restores its latest matching direction, seed,
  fast/detail mode and available subject reference. A viewed history item has
  an explicit Reuse these settings action; missing subject images are reported.
  Mode-specific placeholder text describes character or ending-frame edits.
- Browser QA reopened the completed robot-to-bear edit, replaced its direction
  temporarily, then restored the exact saved settings without starting a job.
  The production build passes. The refreshed demo uses this actual review UI.

## Nine-example demo refresh — October 17

- Prepared a new 106-second, 1280 × 720 / 24 fps demo. It adds the actual
  Qwen character editor, Wan driving-video/appearance workflow, controlled
  mirrored-driver pair, timed motion cue and LTX starting/ending-frame
  transition. Generation waits are omitted. Repeated diagnostic previews are
  explicitly labeled as looped. The encoded movie decodes all 2,544 frames,
  seeks and plays in the browser, and has fast-start metadata.
- Added Signal and Between falling water and crystal to the reviewed media
  bundle: nine examples, 486 checksum-verified assets, 28,614,943 manifest
  bytes. Both new examples include source, image reference, actual output,
  executed video graph and the Qwen frame-creation recipe.
- The recipe library now filters motion examples and labels appearance and
  ending images by their roles. Exploring an example restores its own media;
  applying its settings preserves the user's source and does not silently
  copy the example character or destination image. Existing, corrupted media
  are preserved while importing verified replacement copies under new IDs.
- Engine-offline browser QA played both new examples and restored their input
  images. A motion recipe applied to the existing portal source retained its
  source hash and seed and left the new appearance/caption unselected. The
  browser's recorded-motion graph export exactly matches the bundled native
  graph. The nine-example workspace created no generation jobs.
- At viewport width 375, the four category filters fit without horizontal
  overflow. All 35 TypeScript tests and the production build pass. The
  generation graphs and Python nodes are unchanged from the previously
  passing 17 Python tests and 22 live workflow contracts.
- This refresh is prepared locally on `codex/demo-refresh`. The public site
  still serves the previous 97-second movie and seven-example bundle until
  the new media upload is verified. Evidence is retained in
  `.runtime/evidence/demo-v5-proof.json` and
  `.runtime/evidence/nine-example-bundle-proof.json`.

## Live-action motion research — October 17

- The existing silent Tears of Steel bridge excerpt supplied a two-performer
  research scene. Local Qwen edit `0cd5b712-10da-4cf9-9d64-d326abf5c334`,
  SDK job `1a920b61-5a23-4caa-863b-a19ad7be381a`, replaced the left performer
  with a silver android while largely retaining the original composition.
- A real painted-cue Wan take completed at 768 × 448, 73 frames / 24 fps:
  `a2eb31b9-9fe5-4ef3-b37d-89f30e28f5d6`, SDK job
  `f183d88d-9c46-44e8-b891-61d921287d46`. Its appearance remains coherent
  in representative frames, and the composite retains the surrounding source.
  Encoded RGB MAE outside the zero-alpha cue is 1.89 / 255. The end time of
  3.04 seconds leaves a partial fade in the last sampled frame; it is not an
  exact-source final-frame example. The raw android under-follows the head turn.
- An exploratory crop isolates the left performer: source box
  `(176, 0, 432, 432)` and the same crop of the Qwen appearance. The app
  imported both and finished whole-frame take
  `d9fee2d0-7255-4fa1-9447-f0163e3924c4`, SDK job
  `4d1cc9ee-cf08-449a-a1be-b25556ccbd89`, at 448 × 768, 73 frames / 24 fps.
  Representative frames show some facial and upper-body timing, but the final
  head rotation remains weaker than the driver. This is an observational
  comparison: the crop, output framing and prompt differ from the wide test.
- Both MP4s decode fully, contain the matching recipe and actual executed
  graph, and bind verified driver and appearance bytes separately. These two
  studies remain local research under `.runtime/research/motion-transfer/`;
  they are excluded from the nine-example bundle and 106-second demo.
  Neither establishes general facial performance or human identity fidelity.

## Adjustable motion guidance — October 17

- A paired native experiment held the isolated-performer source, appearance,
  prompt, seed, framing and other inference settings fixed. Changing only
  `pose_strength` from 1.0 to 1.4 increased the final head rotation in this
  scene and exaggerated an arm entering at the edge. The stronger setting is
  not a universal quality improvement. SDK job:
  `223e93ee-b32f-4e49-940d-603626571e29`.
- Added a Motion strength control bounded to 0.50–1.50, with the model's
  original 1.00 default and an explicit Reset. Its value survives recipe
  sharing/import and reference rebinding, reaches the native Wan input, and
  changes take matching. Older recipes keep the same default behavior.
- Browser QA exported a 1.40 recipe and a portable graph with the actual
  1.4 native value. Reset restored the recorded default match; importing
  the recipe restored 1.40. No example generation was started. The control
  fits at viewport width 375 without horizontal overflow, and is disabled
  during generation.
- The normal browser then submitted and completed take
  `fa3f5c76-d46b-44d0-bbbd-460ca1598d20`, SDK job
  `ac9c6fe7-6162-4c78-9724-db1c133591c9`: 448 × 768, 73 frames / 24 fps.
  Its embedded recipe and actual graph both retain 1.4. All decoded frames
  match the controlled 1.4 native probe on this machine. These actor-based
  studies remain local research, outside the nine-example media bundle.
- All 36 TypeScript tests and the production build pass. The Python nodes
  and model files are unchanged. The candidate landing page was also checked
  at width 375: document width 360, video width 324, no horizontal overflow.
  Temporary viewport overrides were reset after testing.

## Portrait social cut — October 17

- Prepared a captioned 24-second portrait cut at 1080 × 1920 / 24 fps from
  the reviewed Signal, portal, golden-falls and Reclaimed examples. It shows
  an actual gesture transfer, local Qwen appearance, source/result region
  edits and the repository link. Source footage and model credits remain
  visible; no actor research footage or outside soundtrack is included.
- All 576 encoded frames decode, fast-start metadata is present, and native
  browser playback and seeking were verified. The canvas scales the existing
  outputs for display; it does not claim native 1080p inference. A 221-character
  caption draft includes the demo link and required #OpenSourceHiggsfield tag.
- The local landing-page candidate links both the 106-second full demo and
  portrait cut. Both new media files and the nine-example source bundle remain
  prepared locally until their public upload is verified. No social post or
  entry submission has been sent.

## Browser editor trial — October 17

- Added a static editor at `/aftertake/studio/` with the seven already-public
  recorded examples. It uses the same React editor, paint/erase cue, timeline,
  comparison, recipe library and frame-history review UI as the local studio.
  The disclosure explains that edits affect exports while recorded results
  stay unchanged. Importing new media, generation, tracking and film export
  require the local studio; unsupported actions create no simulated jobs.
- The build verifies the published manifest and media hashes, extracts the
  executed graphs from recorded MP4s and pins all media to one immutable
  public Git revision. It bundles local OFL fonts and app/dependency notices.
- Browser QA played actual remote source/result videos, loaded all ten timeline
  thumbnails, changed a temporal cue, painted a new stroke and undid it.
  The original cue was restored exactly. Portable graphs retained the edited
  cue and source hash; the recorded graph matched the original execution.
  Downloaded video and Qwen PNG hashes matched the published bytes, and the
  frame recipe matched its original. No generation jobs were created.
- At 375 px, the disclosure and local-setup link fit without horizontal overflow.
  Both the normal and browser builds pass; all 36 TypeScript tests on this
  branch pass, including immutable-record and portable-workflow checks.
- [PR #2](https://github.com/ItsSNOWMOBILE/aftertake/pull/2) is merged, and
  [the public editor](https://itssnowmobile.github.io/aftertake/studio/) is live.
  Anonymous Git fetch matched every published file to the tested branch tree.
  Live Pages QA confirmed source/result playback, ten thumbnails and an exact
  recorded-graph download. The separate nine-example candidate now includes
  this browser mode; all 38 combined tests and both builds pass. Its browser
  snapshot stays pinned to seven public examples until the new media is uploaded.

## Motion-strength control — October 17

- Motion transfer now exposes a 0.50–1.50 strength control with an explicit
  reset to 1. Its value survives recipe exports/imports, changes take identity
  and reaches Wan's native `pose_strength` input. Appearance strength remains 1.
  Higher values can exaggerate detail; this is guidance rather than a fidelity
  guarantee. Old recipes retain the default value.
- Previous browser QA verified a 1.4 recipe/workflow export, import restoration,
  reset, disabled controls during generation and a 375 px mobile layout.
  Normal app render `fa3f5c76-d46b-44d0-bbbd-460ca1598d20` recorded 1.4 in its
  actual graph and embedded recipe. Its decoded frames matched the corresponding
  fixed-input native probe exactly. The licensed-film research input and result
  stay local and are excluded from the public demo and examples.
- The public editor build is refreshed from the same source. Its media remains
  the seven published examples; the nine-example media refresh is separate.
- All 37 release-branch TypeScript tests and both builds pass. Static-editor
  QA exported a 1.4 recipe and native graph, reset to 1, then imported the saved
  recipe and restored 1.4. At 375 px, the slider fits and the page has no horizontal
  overflow. These checks created no GPU jobs.

## Self-contained public showcase — October 17

- A public Sites deployment now serves all nine reviewed examples, the complete
  106-second captioned demo and the 24-second portrait cut. It has no inference
  endpoint. Source snapshot, workflows and media are downloadable as three ZIP
  parts; every archived Git blob was checked and the ZIPs re-read after writing.
  Source and deployment metadata are exposed in the showcase's JSON receipts.
- Local browser QA played the full demo, the actual 576 × 768 motion example,
  and the 768 × 448 ending-frame result. The ending PNG loaded at 768 pixels.
  Chrome checks at 375 px found no horizontal overflow on the landing or editor.
- Anonymous post-deploy checks matched all 534 non-HTML assets byte for byte,
  including the three source ZIPs. HTML retains the original document with
  additional hosting security scripts. Recorded graph export matches execution.
- This host ignores video byte-range requests. The browser build can therefore
  opt into `--blob-previews`, preparing the bounded recorded clips in memory so
  normal seeking works. Encoded bytes and recipe bindings remain unchanged.
  The showcase also prepares seekable previews for its demo and portrait page.
  Failed preparation releases completed object URLs. All 41 TypeScript tests
  and the normal build pass; hosted playback compatibility is being verified.

## Remaining work

### Generation quality takes priority — user review, October 17, 2026

Jay judged the demo's generation quality poor. The current examples establish
working inference and reproducible provenance; they do not establish visual
quality suitable for the final entry. Prioritize controlled quality comparisons
and stronger replacement shots before expanding feature breadth or editing
another complete submission film.

An audit of the actual bundled graphs confirms:

- LTX examples use the distilled Q4_K_M backbone and the lighter Conv VAE.
  Quantization is a possible contributor, not an isolated or measured cause yet.
- Masked edits start at 512 × 288, resize/re-encode and refine to 768-pixel
  output. The 720p film then enlarges those results. This limits native detail.
- Cinema examples use a single sampling stage, without the publisher's learned
  latent upscaler and second refinement stage. Official two-stage I2V is the
  relevant higher-detail comparison; simply increasing the distilled step count
  does not reproduce that workflow.
- Wan character transfer is a separate model path. Its finished configuration
  uses an int4 motion cache; compare that against int8 without changing the
  appearance, driver, prompt or seed before attributing quality loss to caching.
- The pinned official LTX-2.5 inpaint and motion-track templates themselves use
  the same 2.3-named adapters. Their filenames alone are not evidence of an
  incompatible model stack. The current publisher model card also describes
  broad 2.3 adapter compatibility, with individual exceptions to validate.

The local baseline inventory is `.runtime/quality-audit/current-examples.json`.
Next comparisons should keep source, prompt, seed, duration and output geometry
fixed while changing one factor: decoder, sampling/refinement path, model
precision or tracking/composite. Inspect raw generation separately from the
composite and film export so edge drift, identity/geometry drift and softness
are not conflated. No quality improvement from these changes is established yet.

Primary references: [official workflow comparison](https://github.com/Lightricks/ComfyUI-LTXVideo/tree/master/example_workflows/2.5)
and [LTX-2.5 model card](https://huggingface.co/Lightricks/LTX-2.5).

### Original image creation and narrated review film — October 17, 2026

- Added a native text-to-image studio with Z-Image Turbo: three aspect ratios,
  six prompt styles, seed, history, image recipe import/export and an explicit
  handoff into Cinema. The public Apache-2.0 profile pins all three model files
  by immutable revision, byte size and SHA-256; all downloads were verified.
- Actual SDK image job `05add27e-bcfb-4d64-970a-f7f4e257a28b` produced the
  1152 × 768 observatory from text alone. Its generated PNG then became the
  source for SDK video job `0b6fb100-88d4-4133-9181-86a4016e60aa`: 97 frames,
  768 × 512, 24 fps, with a coherent guided pullback. Both executed graphs,
  native PNG metadata, recipes and original records are packaged as `observatory`.
- The library now contains thirteen reviewed cases. The hosted runtime can
  inspect the recorded image history and export its image recipe; new image
  generation remains local. Native UI checks exercised generation and the
  image-to-Cinema handoff. Phone-width QA caught and fixed dialog/grid overflow.
- Re-exported the stronger 116-second review film through the actual Film editor:
  25 cuts, 25 typography layers and nine local Kokoro narration clips. The coast
  and winter results replace weaker opening footage. The ending reveals the
  actual editing project that made the film. Editable sources remain included.
- An audio transcription check exposed narration loss in the normalized export.
  Intermediate AAC priming/padding disrupted timestamps across cuts. Intermediate
  PCM, a separate mastering pass and continuous sample clocks fix it; unused PCM
  is disabled during picture processing to avoid an FFmpeg demux stall with many
  timed overlays. A regression with 25 title intervals, six cuts and eight
  distinct audio bursts fails on the old renderer and passes after repair.
- The final app export `ad28c6e9-fdc8-4a64-92b1-e43d1a6d08f2` decodes all
  2,784 video frames and continuous stereo audio. All nine voice waveforms match
  their source above 99.7% with a consistent 5 ms limiter delay. Measured loudness
  is −16.15 LUFS and true peak −1.49 dBTP. The 22,355,055-byte sharing export
  retains the exact editing project. See `narrated-film-evidence.json`.
- Native text-to-video, automatic subject mattes/clean plates, a two-take
  comparison view, broader camera discovery and easier setup remain priorities.
  Full Higgsfield parity and an award are not established. Jay retains the final
  competition submission and social post.
- All 46 TypeScript checks, two real Python film-render checks and the production
  build pass. Recipe import restored the native image seed, style and aspect
  without creating another image job. The phone dialog fits a 375 px viewport.

### Cinematic examples and comparison-driven iteration — October 17, 2026

- The coastal transformation now has a public phone-friendly review page at
  [the castle page](https://aftertake-studio.right-bard-9761.chatgpt.site/castle/),
  with actual source, transformation and a separate camera take. Public media
  matched local hashes; all three videos played through the hosted preview.
- Three new reviewed cases expand the local library from nine to twelve:
  coastal lighthouse-to-castle, the castle's guided camera pullback, and alpine
  green-to-winter-to-green. The winter video is a real 97-frame, 24 fps, 768 × 448
  local SDK output, rendered as `034b4b2f-2664-4636-8c17-44d64debe1c8` through
  job `76ab3e38-e33a-4ddd-afa5-97ede5afb005`. Its edited frame, original excerpt,
  executed graph, raw/coarse outputs and credits are packaged with the case.
- The packager now decodes missing thumbnails directly from verified source
  bytes and reuses only hash-verified prior thumbnails. Packaging no longer
  depends on every historical local studio being online.
- Reviewed Comfield and Kevin's OpenSourceHiggsfield source, then searched the
  hashtag's Latest and Top views. Additional references include FXjutsu,
  TakeLab, Landscape Time Machine and music-video/storyboard research posts.
  Detailed evidence and the resulting priorities are in `higgsfield-benchmark.md`.
- Added local take search across names, prompts, sources, seeds and pipeline;
  type/state filters; and browser-persisted favorites. Browser QA verified
  combined filters, empty-state recovery, stable take numbers, the selected
  take's original settings, favorites after reload and a 375 px layout with
  no horizontal overflow. No generation was requested by those checks.
- All 43 TypeScript tests and the production build pass. Example-import checks
  now cover the new tracked appearance edits and guided castle still, including
  source/reference/output hashes and real frame-edit recipes.
- The narrated-film preparer now selects the stronger coastal and winter
  footage and a revised timed script. The stored 116-second film remains the
  previous review draft; fresh UI captures, its final self-reveal and a new
  normalized export are still pending. Nothing has been submitted to the contest.

### Narrated film editor and review draft — October 17, 2026

- Film assembly now supports 48 cuts, imported footage/stills, timed typography,
  local Kokoro narration and voiceover mixing. Version-1 projects remain readable;
  version-2 projects retain content hashes and editable title/audio settings.
- A real 116-second review draft was exported by the app's **Export film** button:
  22 cuts, 24 title layers and nine locally generated voice clips. All 2,784 frames
  decode on the 24 fps grid, stereo sound is present, and embedded project data
  matches the app's exported manifest. The editable sources live under
  `examples/submission-film/`. This remains a draft pending stronger footage.
- Restricting title-image processing to visible intervals reduced the full CPU
  export to 38.52 seconds on this workstation. Generation still runs through the
  native Comfy/PyTorch GPU stack; export is native FFmpeg controlled by Python.
- 43 TypeScript tests and the production build pass. A real Python render test
  verifies cuts, title intervals, delayed audio, normalization and MP4 provenance.
- Intel AI Boost is present and passed a real OpenVINO NPU inference test.
  The current Kokoro ONNX graph fails OpenVINO conversion on dynamic sequence
  operators; narration therefore uses the verified CPU runtime. See
  `hardware-check.json`; no model-level NPU acceleration is claimed.
- A new local source pack contains four Full HD Pexels clips: neon city,
  coastal lighthouse, misty mountains and a studio dancer, plus twelve extracted
  original stills. Authors, source URLs, file hashes and license links are retained
  locally. Candidate results will be reviewed before inclusion in public examples.

- Continue edge, motion-tracking and prompt-following quality work.
- Review the published demo against the final submission form requirements.
- Refresh the public video with the narrated edit, authentic editor reveal and stronger cinematic footage.
- Prepare social/entry drafts for Jay's review. Jay will make the contest submission personally; do not submit on his behalf.
- Award outcome remains external and unverified (official announcement date: November 6).

The included source study is original procedural media. Blender-derived
research footage is local only. Licensed Pexels clips without recognizable
people are being used for demo candidates; see
`docs/media-attribution.md`.


### Short-form and marketing demo — October 18

- Review 7 opens with a complete 10.5-second vertical coffee concept ad, then
  shows the native 9:16 Film editor and an alternative opening hook. The main
  narrated demo is now 57.29 seconds, with coastal VFX, prompt typing, character
  replacement and the authentic editor reveal retained.
- Two real native portrait exports use matching licensed Michael Burrows /
  Pexels footage, seven editable typography layers and five whole local Kokoro
  voice clips each. They are manually prepared creative variants, with no
  campaign optimization or ad-performance claim. Source receipts and projects
  are included under `examples/social-ad/`.
- Verified every decoded frame timestamp, embedded project, source checksum
  and complete voice alignment in both ads and the main demo. Reviewed paired
  beat frames and narration separately. Evidence: `social-ad-evidence.json`
  and `narrated-film-evidence.json`. Jay has not approved or submitted this cut.
- The public showcase adds phone-friendly playback of both ads and a complete
  project/media pack. Public GitHub branch synchronization remains outstanding;
  matching source ZIPs are provided through the showcase.
