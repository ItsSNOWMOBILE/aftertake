# Submission draft — awaiting Jay's review

Jay reviews and personally submits the entry. This document sends no
registration, submission or social post.

Project: **Aftertake**. Primary target: **Open Weights Only**. Secondary:
**Most Innovative**. The LTX workflows may also support the LTX bonus.

## Description

Aftertake is an open creative studio for ads, reels and impossible scenes.
Cut licensed footage into landscape, square or portrait films. Add editable
kinetic typography, generate generic local narration and retain every cut,
voice clip and source receipt in a portable project.

The narrated-cut builder pairs user-written lines with selected pictures,
measures whole local voices and prepares editable cuts and captions for review.
Changing a hook reuses unchanged body voices and media. The original draft can
be restored after trying the prepared version.
Its Follow voice style highlights short phrases using model word timings;
individual word times remain editable. Changing wording clears stale timing.

For generated scenes, create an image with Z-Image Turbo, edit a source or
subject reference with Qwen Image Edit, animate a frame with LTX, or transfer
a driving performance with Wan Animate 2. Optional ending frames and framing
tracks guide a new shot. These are soft generative constraints, not guaranteed
camera geometry or arbitrary identity preservation.

A painted and timed cue directs where a video transformation belongs. Its
spatial mask conditions generation and its envelope controls compositing over
the original source. A source-matched boundary correction reduces broad color
casts. Saved motion generations can be finished through an annotated local
SAM 2.1 subject matte, with a separate protected foreground subject, without
resampling the performance. Every take retains its recipe and executed graph.

The sixteen-tool local MCP interface lets an agent generate an image, edit a
reference, render a native video recipe, inspect actual results and assemble
measured narration and editable type. The actual product-shot chain retains
its original image/take IDs across studio restart. Film refuses insufficient
picture coverage and overlapping narration; stable keys rejoin recorded jobs.
The finished project remains editable in the same Film UI. General autonomous
creative direction and arbitrary generation quality remain unproven.

## Tools and techniques to explain in the final video

- React/TypeScript app and official Comfy SDK with a local Comfy v2 proxy.
- Local Z-Image Turbo, Qwen Image Edit, Wan Animate 2 and LTX-2.5 workflows;
  native masked-edit and optional motion-track adapters.
- Painted/erased spatial cues, timed compositing, optional optical-flow mask
  tracking, boundary-color correction and native source-aspect exports.
- Optional annotated SAM 2.1 mattes for exact saved-generation finishing.
- Local open-weight Kokoro narration; PyAV, Pillow and FFmpeg film assembly.
- Official MCP SDK stdio tools, content-bound beat plans, idempotent exports
  and decoded review frames. No LLM or hosted inference dependency is embedded.

The innovation explanation should show the combination in action: one reusable
cue, source-preserving finishing, inspectable generation provenance, and agent
editing that leaves the same native project editable. Do not claim an
unverified industry first or full Higgsfield feature parity.

## Current review links and evidence

- Main showcase: https://aftertake-studio.right-bard-9761.chatgpt.site/
- Narrated tools/workflow review: `/judges/`, 71.67 seconds, 29 cuts, 44 titles,
  21 complete outer voices and three voices in the opening ad. Explains the
  model roles, cue/composite combination,
  tracked subject protection, MCP editing, implementation tools and contribution.
  Retains the ads opening and authentic made-in-Aftertake reveal. Awaiting review.
- Repaired 44-second review cut: `/?review=10#demo`. Includes ads and hooks,
  image generation, animation, region control, natural character replacement,
  recipe reuse and the actual editor reveal. Jay has not approved it.
- Browser editor: `/studio/`, with thirteen real recorded examples. It
  exports edited recipes; new generation and film export use the local app.
- Local MCP proof: `examples/agent-edit/result.mp4`, 6.5 seconds at
  720 × 1280 / 24 fps. Its plan, complete voices and editable project are
  bundled. The public companion page is `/agent/` after publication.
- Narrated-cut workflow: `/ads/workflow.html`, 20.08 seconds. Actual UI typing,
  preparation, two six-second ad variants and a native-project reveal. The final
  project was saved and exported through the local MCP. Supplied footage,
  voices, UI captures and editable projects are in `examples/narrated-cut/`.
- Follow voice: `/type/spoken.html`, a 5.96-second native portrait export with
  twelve timed words. Model timing estimates, manual word controls, exact voice
  reuse and independent timing-review limits are included with the project.
- Current complete source, workflows and media: matching showcase ZIPs
  with SHA-256 receipts. Model weights are downloaded separately.
- Public GitHub: https://github.com/ItsSNOWMOBILE/aftertake . Its branch is
  stale; synchronization remains required before entry. Connector and Git
  authentication fail on October 18 despite the earlier reconnection.

Technical evidence is in `narrated-film-evidence.json`,
`visual-repair-evidence.json`, `agent-edit-evidence.json`,
`judges-film-evidence.json` and the native
generation examples. A fresh CPU-only MCP run completed import, local narration,
export and decoded review with unavailable Comfy endpoints. Image/video
generation still needs the documented GPU engine and model profiles.

## Remaining submission gates

The official requirements were rechecked October 18: a runnable licensed GitHub
repository, a demo of at most two minutes, and a demo-linked social post with
the competition hashtag. The final video must explain the combined techniques;
Most Innovative additionally needs a clear novelty explanation. The separate
72-second judges’ review now narrates both explanations; Jay must review and
choose the final video. The original 44-second creative cut remains unchanged.

Jay must review the final entry, synchronize the GitHub source, publish the
chosen social post and personally complete registration/submission. Deadline:
October 30, 2026, 9am Pacific. No entry, social post or award is claimed.

Known limitations: general generation quality and camera adherence vary;
the reviewed human replacement under-follows the head turn; SAM masks need
reviewed annotations; other GPU/OS combinations are unverified. Managed cloud
rendering, persistent identity, batch generation and full marketing-suite parity
are not implemented. See `higgsfield-benchmark.md` for the broader inventory.

## Social post draft — send only after Jay reviews

Aftertake: an open studio for ads, reels and impossible scenes.
Paint what changes. Voice the story locally. Keep the cuts, kinetic words,
recipes and executed workflows editable. Agents can inspect footage and build
the same native Film project through a local MCP interface.

Local open weights, official Comfy SDK, MIT app code. Thirteen recorded
examples and complete source packages to explore before installing models.

https://aftertake-studio.right-bard-9761.chatgpt.site/
https://github.com/ItsSNOWMOBILE/aftertake

#OpenSourceHiggsfield
