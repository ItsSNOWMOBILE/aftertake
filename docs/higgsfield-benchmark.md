# Higgsfield replacement benchmark

Reviewed October 18, 2026. The product goal is an open replacement for useful
Higgsfield workflows. Competition readiness and full feature parity are
different milestones. A control is counted as implemented only when it changes
the executed workflow; generative quality still needs visual review.

**Current answer: full Higgsfield feature parity has not been achieved.**
Aftertake currently implements a subset of the editing, motion and cinema
workflows. Its open-weight implementation and its demonstrated output quality
must be assessed separately. The public hosted trial also has fewer capabilities
than the local studio: it reviews recorded outputs and exports settings, while
new generation, media import, narration and film export require the local app.

## Whole-suite inventory

Checked against the [official product catalog](https://higgsfield.ai/Apps),
[current homepage](https://higgsfield.ai/),
[Cinema Studio guide](https://higgsfield.ai/blog/cinema-studio-4-0),
[AI Influencer guide](https://higgsfield.ai/blog/new-ai-influencer) and
[official API catalog](https://open.higgsfield.ai/models/higgsfield/cinema-studio/4.0/playground).
This is a coverage inventory, not a claim that every option or private backend
behavior has been inspected.

| Feature family | Aftertake status |
| --- | --- |
| Local image editing with a subject reference | Implemented with Qwen; broader identity consistency needs evaluation |
| Standalone text-to-image studio and broad model selector | Local Z-Image Turbo implemented and natively verified; shot/lens/light prompt direction and exact preview available; broader model selection missing |
| Painted video edits / object replacement | Implemented; native SAM3/H3 whole-person replacement is available, while broad identity/occlusion quality still requires review |
| Motion transfer | Implemented with Wan; live-action/facial quality remains partial |
| Reference-to-video and first/last-frame generation | Implemented; soft endpoint constraints |
| Standalone text-to-video | Native LTX-2.5 joint AV sampling, draft/final and three canvas shapes, optional sound, recipes/history/MCP/Film handoff; short portrait and silent square outputs verified |
| Camera, lens, lighting and grade direction | Partial: five moves, four lens characters, five lighting choices, four grades; experimental track guidance |
| Full film-stock/camera/lens catalogs and multi-shot cinematic direction | Missing / partial compared with the existing small look library |
| Soul ID / persistent character identity across projects and scenes | Missing |
| AI Influencer structured character builder | Missing |
| Broad effects/preset marketplace | Partial: thirteen bundled reviewed recipes |
| Ads Studio and Marketing Studio | Partial: optional local brief-to-script suggestions, a measured narrated-cut builder, editable type/voices and hook variants; footage discovery, campaign planning, batch strategy and performance optimization remain missing |
| Canvas, workflow chaining and team collaboration | Missing |
| Dedicated 3D Jutsu workflows | Missing |
| Dedicated upscaling/restoration delivery workflow | Missing |
| Bulk variations, batch grids and collections | Missing |
| Long continuous generation and native 1080p/4K delivery | Missing; current finished generation is short and film export is 720p |
| Film cuts, imported footage/stills, typography and voiceover | Implemented locally; 48 cuts, timed type, generic local Kokoro voices, a measured narrated-cut builder and editable projects |
| Prompt-driven motion design and kinetic typography | Partial: editable entrances plus Follow voice word highlights using Kokoro timing estimates, with manual word adjustment; freeform generative motion graphics remain missing |
| Full character/avatar audio performance workflows | Missing; narration and mixing do not establish this capability. Separate experimental LivePortrait utilities refine the lower face or reconstruct a head from an aligned portrait and original video motion with SAM contours. One bridge candidate is verified; these CLI passes do not establish general head fidelity or audio-driven dialogue |
| Agent generation and editing via MCP | Implemented locally: twenty-seven typed tools cover native image/frame/video generation, direct text-to-video with sound, native SAM3/H3 character selection/replacement, optional local script drafts, inspection, measured narration, persistent beat plans and native exports; the product-shot chain is verified live, while broad automated creative direction remains unproven |
| Managed cloud rendering, accounts, billing, shared projects and public generation API | Missing; current hosted site reviews recorded examples |

The focused 53.04-second film was cut, titled, voiced and exported through Aftertake. It has 19 cuts, 24 editable title layers and 13 complete outer narration clips. The actual local MCP session receipt and editable project are included. The film is prepared for review and is not a submitted entry or evidence of full suite parity.

Higgsfield's official [explainer skill](https://github.com/higgsfield-ai/skills/blob/main/higgsfield-video-explainer/SKILL.md)
pairs narration and visuals, generates voice before assembly, and validates
scene ordering. That published architecture informed the revised local
preparer. Its skill was read as reference material; no Higgsfield paid API
or proprietary media was used.

## What was observed

Higgsfield's public [Genjutsu page](https://higgsfield.ai/genjutsu) distinguishes
whole-scene motion transfer from selected-element replacement with references.
The public page and its guide give different reference-image limits, so this
benchmark does not assume either number is a stable backend contract.

The live [Cinema Studio](https://higgsfield.ai/generate) was inspected while
signed out. Its own read-only WebMCP options exposed camera look, lens
character, lighting, palette, genre, era and pacing, plus start/end references,
aspect ratio and duration. Options differed from older screenshots. The
[October camera guide](https://higgsfield.ai/blog/ai-video-camera-control)
provides additional context about prompt-driven movement. These are product
observations, not evidence of access to the server implementation.

The [apps catalog](https://higgsfield.ai/apps) and
[effects collection](https://higgsfield.ai/collection/effects) make discovery
and repeatable starting points a major part of the experience.

## Coverage and gaps

| User job | Aftertake implementation | Remaining gap |
| --- | --- | --- |
| Change a selected part of footage | Native inpainting, paint/erase, temporal fades, source-preserving composite, optional edited-first-frame conditioning in both stages | Prompt following and edge quality vary; arbitrary identity replacement is not established |
| Prepare a new appearance inside the studio | Local Qwen-Image-Edit-2511 frame editor, optional subject image, seed, fast/detail modes, explicit review and selection, PNG and actual graph export | Single-image and two-image native tests passed on the forest; broader scene quality and arbitrary identity consistency remain under evaluation |
| Reuse motion with a new character and scene | Wan Animate 2 distilled with separate driving-video and appearance conditions; adjustable motion strength; whole-frame or painted/timed output; source sound and content-bound recipes | Controlled original-character pilots passed, including a mirrored-driver control. Stronger guidance increases the head turn in one live-action crop but exaggerates an edge gesture. Facial action and general identity fidelity need broader evaluation |
| Animate a reference or connect two images | LTX-2.5 first-frame conditioning; optional ending image, upload/select/inspect or create with local Qwen; hash-bound recipe sharing; first/last guides with optional motion tracks | Real draft and finish transitions checked on the forest scene. Endpoints are soft constraints; broader scene and transition quality remain under evaluation |
| Direct camera and look | Five movement suggestions, four lens characters, five lighting options; inspectable prompt; four output grades; optional motion-track conditioning | Prompt-only direction is unreliable. Guided pullback and static framing passed visual checks on one room; broader scene coverage and 3D camera reconstruction remain open |
| Keep a film look across sources | Named local look library, built-in looks, settings preserved in recipes and MP4 metadata | No multi-user collaboration or identity lock |
| Start from an effect | Searchable library of thirteen reviewed effects, camera and motion recipes with actual source/result previews; inspect/import recorded takes or apply direction to your source and cue | More varied scenes and effects needed |
| Iterate and remix | Durable takes, search/type/state filters, browser favorites, source/result/compare, seeds, editable recipes and executed graph export | Batch variation grid and collections needed |
| Finish a longer film | Trim and join up to 48 takes, imported videos or stills; timed typography, local narration, audio mixing and optional normalization; three 720p canvas shapes; hash-bound version-2 editable project | Longer continuous generation, advanced transitions and native 1080p delivery remain open |

The frame-animation path loads the same public LTX-2.5 backbone, text encoder
and VAE as masked editing, with **no inpainting adapter**. Camera and look
settings are compiled into the actual text encoder input; color grading is
also applied after generation. There are no partner
inference nodes or closed model calls in this path.

## Open-source references

### Comfy cinematic studio — October 18, 2026

Inspected [Comfy-Org/comfy-cinematic-studio at f223ccf5](https://github.com/Comfy-Org/comfy-cinematic-studio/tree/f223ccf5b8561e9f44a4983c8ccb19c1ebe7cf6b):
UI, prompt builder, request validation, Router route, response parser and tests.
It is a focused still-image app calling FLUX 2 Pro through Router. Shot, camera,
light and look choices compile to inspectable prompt text; it does not provide
a video timeline or workflow-based motion inference. The MIT reference informed
Aftertake's structured image direction and exact prompt preview. Aftertake's
implementation uses the existing local Z-Image graph and shared typed schema.
No reference code or paid model call was copied into the app.

### Comfield review — October 17, 2026

Inspected [synthetic-ape/comfield at 3dbae267](https://github.com/synthetic-ape/comfield/tree/3dbae26715869bc0c35507eedf840682f50e7c09):
README, checked-in interface screenshots, presets, model registry/workflow
bindings, generation dispatch, library, onboarding, downloader and price helper.
This is a source review, not an end-to-end certification of its cloud models.
No Comfield code or media has been copied into Aftertake.

| Area | What Comfield does better | Implication for Aftertake |
| --- | --- | --- |
| Generation breadth | Separate text-to-image and video studios; five local model families in the registry, plus Router adapters | Native Z-Image text-to-image and LTX-2.5 text-to-video are now verified; the model-selector breadth remains smaller |
| Camera discoverability | 27 named movements with animated viewfinder tiles; shot size, angle and depth-of-field controls | Replace text-only discovery with previews, while distinguishing prompt guidance from actual geometric controls |
| First run | Engine onboarding, explicit ready/missing states and an in-app template-based downloader with resume and disk-space checks | Make the current verified, pinned setup reachable from the app; preserve model hashes and license gates |
| Iteration | Up to four takes from one request; separate searchable library and favorites | Search, filters and favorites are being added; a real sequential variant queue remains open |
| Cloud usability | Per-model native request builders, price-estimate helper and prompt enhancement | Useful for broader parity, but closed inference would change eligibility for the open-weights category |

Important distinctions: the roughly 75 families listed by its model catalog
are not 75 implemented studio-generation integrations. Its 27 movement presets
mostly compile to prompt instructions, with additional native controls for
selected cloud adapters. A preset preview is not evidence of model adherence.
Its source is Node/TypeScript and React, so this comparison offers no evidence
that a Rust rewrite would improve generation latency.

Aftertake's concrete differentiators in this comparison are its painted, timed,
flow-tracked video composite; appearance references coupled to those edits;
motion-transfer mode; and an integrated cut/type/narrate/export film project.
The inspected Comfield generation routes and workflow families do not implement
those editing and finishing paths. Breadth and a good end-to-end workflow both
matter; neither project establishes full Higgsfield parity.

### Hashtag and additional entries — October 17, 2026

Reviewed both Latest and Top results for `#OpenSourceHiggsfield` on X, then
followed entry links to their public repositories. Promotional posts and
work-in-progress announcements are not treated as completed submissions.

| Reference | Useful idea | Evidence and limits |
| --- | --- | --- |
| [FXjutsu](https://github.com/audriu/fxjutsu/tree/cd333a4d15edc928060d27c2d0c14478ff7ac11e) ([entry post](https://x.com/Audrius1454663/status/2111177673842012349)) | Automatic subject mattes, empty-background plates, multiple adapter passes and painted fluid keyframes | Inspected `lib/comfy.ts`, presets, adapter notes and generated composite graph wiring. The SDK submission path binds actual uploaded assets and joins matte/restyle/plate passes. These features exceed Aftertake's current painted-region effect breadth. The advertised renders were not re-run on this workstation. |
| [TakeLab](https://github.com/Bortlesboat/takelab/tree/ece3e856dde1685765c4dc39162af0d9e1dbeafd) ([entry post](https://x.com/BTCOrangeCoin/status/2111226936689037768)) | Two-take side-by-side review, a video/settings/workflow ZIP, and controlled camera comparisons | Read its contract, example notes and comparison UI. Useful next step beyond Aftertake's source-versus-result wipe. Its documented model timing belongs to its own hardware and individual runs. |
| [Kevin's OpenSourceHiggsfield](https://github.com/kevin9327/OpenSourceHiggsfield/tree/9014e1e985a2bff0ee69e2ca0b27500d48ab17e8) | Interactive 3D camera sphere, timestamped camera keyframes, relight controls and graph inspection | Read frontend, normal backend routes and custom-node processing. `run_openjutsu_generate` uses bundled source/character paths, directly calls a procedural VFX node and can blend a bundled swapped reference. Its `build_sdk_workflow` constructs a graph, but this route does not submit that graph for model inference. The hard-coded competitive scores are self-assessments, not judge results. Treat its interface as inspiration and validate generation behavior independently. |
| [Landscape Time Machine](https://github.com/rollon115/landscape-time-machine-api) ([entry post](https://x.com/Rollon115Rollon/status/2111441608986230968)) | A focused landscape time-shift flow and explicit job/API contracts | Reviewed the repository's current README. It explicitly leaves Director composition and durable production storage incomplete. No live deployment was exercised. |
| [vveerrgg's music-video work](https://x.com/vveerrgg/status/2111487578285506641) and [viewer study](https://x.com/vveerrgg/status/2111031556798287948) | Storyboard-driven iteration and blind audience comparison of lip-sync outputs | Posts describe work in progress. These are research ideas, not evidence of a complete published replacement. |

Resulting priorities: finish the stronger narrated film; add visual camera
previews and a two-take comparator; add native open-weight text-to-image/video;
improve first-run model setup; then expand into verified subject-matte/clean-plate
effects. Search, type/state filters and browser-persisted take favorites have
been implemented locally as the first iteration improvement. These directions
are independent implementations; no competitor code or media is incorporated.

Follow-through: Aftertake now has a native Z-Image Turbo text-to-image mode,
three frame shapes, six prompt styles, seed/history/recipe import and export,
and an explicit handoff to Cinema. A real 1152 × 768 image and its subsequent
768 × 512 / 97-frame guided video are packaged as **Above the clouds**. This
closes the basic image-creation gap for one local model; native text-to-video,
broader models, integrated automatic matte creation and clean plates remain open.
An annotated SAM 2.1 helper and exact saved-generation finishing are implemented;
these require reviewed subject annotations rather than one-click replacement.

- [Open Generative AI](https://github.com/Anil-matcha/Open-Generative-AI)
  (MIT): useful reference for separate creation surfaces and exposed camera
  modifiers. Its advertised model count includes API integrations; that is not
  a substitute for a locally executed open-weight workflow.
- [Sonder Editor](https://github.com/SonderSaid/ComfyUI-Sonder-Editor)
  (GPL-3.0): reference for scenes, staged rendering and take management.
- [Montagen](https://github.com/MontagenAI/ComfyUI-Montagen)
  (AGPL-3.0): reference for node-controlled timeline composition.

These projects were reviewed for interaction and architecture ideas. No code
or assets from them are incorporated in Aftertake at this milestone.

## REA investigation

[REA](https://github.com/morluto/rea) 6.5.0 (MIT) was run as a local CLI on two
public Higgsfield JavaScript files observed in the browser. Static parsing
completed: 203,090 text bytes, 48,363 AST nodes visited, no parse failures.
The local Evidence ID is
`ev_b0bb5b3bbe6eb33c85ab4e91e88badc4127fc3ca6fdf248f210f8eb021cc459c`.

The evidence is partial: dynamic imports and server behavior are outside that
two-file scope. No downloaded JavaScript was executed. REA was not registered
as an MCP server, and no user credentials or private account data were read.
Downloaded proprietary bundles stay in ignored local research storage.

## Next replacement milestones

1. Expand motion-transfer testing across natural footage, body proportions,
   camera movement and facial action. The new Wan Animate 2 mode has passed
   controlled original-animation pilots; arbitrary human identity and general
   motion fidelity remain unestablished.

The separate **Transfer motion** mode now combines a driving video with an
appearance image through the native Wan Animate 2 distilled workflow. It can
generate the whole frame or use Aftertake's painted/timed composite. A matched
pair of controlled pilots used the same appearance, seed and neutral prompts;
mirroring only the driver changed which arm waved. This supplies an actual
video-driven capability alongside the earlier LTX edited-first-frame path.

The [current official inpainting guide](https://docs.ltx.io/open-source-model/feature-guides/editing-effects/in-outpainting)
supports an edited first frame as an object-replacement aid. Draft and finish
pilots passed, followed by a real finished app render. The product now supports
uploading/selecting this reference, exporting the starting frame, and preserving
its hash through recipe sharing. The sixth bundled case contains both images
and its actual workflow. This does not establish arbitrary identity replacement.
The separate
[Ingredients adapter](https://huggingface.co/Lightricks/LTX-2.3-22b-IC-LoRA-Ingredients)
targets LTX-2.3 reference sheets and has a separate publisher access gate; it
has not been downloaded or represented as an installed capability.

First-frame animation, saved film looks and guided framing have completed real
SDK renders. The film desk now trims and orders up to 48 takes or imported media,
adds timed type and voiceover, exports 720p MP4s and saves a hash-bound editable
project. Upright phone-video handling and trimmed source sound also passed a
native masked-edit render on the local RTX 5080.

## Agent behavior audit — October 18

The official public agent guidance separates workflow discovery from model
selection, gives media explicit roles, and defines resumable generation jobs.
Its narrated-explainer workflow measures voice before visuals, pairs each block
explicitly, and assembles a finished film. These are useful orchestration
patterns; the explainer's fixed ten-second blocks are specific to that product.

Aftertake has the underlying typed assets, local workflows, persistent jobs and
editable film format. The current narrated demo uses a measured beat ledger,
but a general agent that owns an edit plan and targeted revisions is still
pending. The implementation mapping and official source revision are recorded
in `higgsfield-agent-audit.json`.

The live MCP initialization returned HTTP 401 without authentication. Its
private video-editing instruction payload and authenticated tool behavior have
not been inspected. Public skill files were reviewed as reference material;
they were not installed or executed.
