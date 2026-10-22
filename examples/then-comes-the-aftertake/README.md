# THEN COMES THE AFTERTAKE

A 93-second, beat-cut product film for the Open Source Higgsfield challenge,
made entirely in Aftertake. Every moving picture is an Aftertake output or a real
recording of the app. Every title, graphic, transition and cut is a layer in
seven native Film projects, rendered by Aftertake's own CPU Film renderer.

[![Watch the film](poster.jpg)](https://itssnowmobile.github.io/aftertake/film/)

**[Watch the film](https://itssnowmobile.github.io/aftertake/film/)** · [Download the MP4](https://github.com/ItsSNOWMOBILE/aftertake/releases/download/then-comes-the-aftertake-2026-10-22/then-comes-the-aftertake.mp4) · [Editable projects](project/) · [Build scripts](build/)

The finished film is published as a [release download](https://github.com/ItsSNOWMOBILE/aftertake/releases/tag/then-comes-the-aftertake-2026-10-22) to keep the
repository small. Its SHA-256 is
`f80e3b10c57755e3f7833e66adc96a3011fb97b60c13dc4d460e2f7f789f617d`. This cut
is sharpened: its 23 generated plates below 1080p were upscaled ×2 with
SeedVR2 on Comfy Cloud through Aftertake's own Upscale studio, and the scenes
re-rendered unchanged ([how](#sharpened-on-comfy-cloud)). The first cut,
`824531b6…`, is the
[2026-10-21 release](https://github.com/ItsSNOWMOBILE/aftertake/releases/tag/then-comes-the-aftertake-2026-10-21).

|             |                                                                                            |
| :---------- | :----------------------------------------------------------------------------------------- |
| Length      | 93.458 s, 1920 × 1080, 24 fps                                                              |
| Edit        | 72 shots in 7 scene projects, 1.3 s average shot, each section under its sung line         |
| Typography  | 84 titles: slam, pop, line reveal, glitch, scramble, typewriter                            |
| Transitions | 26 styled: whip pan, zoom punch, flash, glitch cut                                         |
| Graphics    | 2 animated Film graphics (the logo slams)                              |
| Music       | “Aftertake”, an original song made with open-weight ACE-Step 1.5 on Comfy Cloud, 102.3 BPM |
| Audio       | −16.1 LUFS integrated, −1.5 dBTP                                                           |

## How it was cut

1. The song was written for the film. Its lyrics, tempo and structure are in
   `build/song.json`. ACE-Step 1.5 XL Turbo, an open-weight model, rendered it
   on Comfy Cloud from `build/aftertake-song-ace-step.json`.
   `aftertake_detect_beats` measured 102.3 BPM, and the drums enter on the
   downbeat at 10.542 s. `build/music.json` records that drop, and the
   Aftertake logo lands on it.
2. Whisper large-v3 transcribed the song with word timestamps, once on the
   mix and once on the vocal isolated by Demucs
   (`build/aftertake-song.words.json`, `build/aftertake-song.vocals.words.json`).
   The scenes follow the sung lines: each big title quotes the line being sung
   on the beat it is sung, and each feature appears under its own line, from
   “Paint it, change it, make it new” over region painting to “Cut to the
   beat” over Film's beat snap. The song's last break brings back the intro's
   “THEN COMES THE”, so the logo lands on the sung “Aftertake”.
3. Each scene is a native Film project authored on that beat grid
   (`build/edit.mjs`). A styled transition is centred on its beat, so flash,
   glitch and zoom punches switch pictures exactly on the hit. Measured on the
   export, every hard cut is within one frame of a beat.
4. `build/run.mjs` exported each scene through the studio's `/api/films`
   endpoint, the same path the editor and MCP use. Each produced an
   `aftertake-film/5` project. `build/master.mjs` joined the seven scene renders
   with the music. Scene boundaries fall on downbeats, and every scene's frame
   count is checked against the grid.
5. The Film-editor shots near the end are a real recording of this film's
   second scene, open in the editor. **Snap cuts to beats** reports
   “102 BPM · 10 cuts on the beat” for the film's song.

## What is on screen

| Time        | Scene           | Sung                                                                   | Real Aftertake work shown                                                                                                                                                                                                         |
| :---------- | :-------------- | :--------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0–12.3 s    | Every shot ends | “Every shot ends… then comes the…”                                     | The HD source plates: rooftop walk, orange-hoodie dancer, loft window                                                                                                                                                             |
| 12.3–21.7 s | The drop        | (drop)                                                                 | Generated results on every beat: portal, crystal, golden falls, castle, winter, Reclaimed, observatory, text-to-video, Wan motion transfer, five tracked dancers                                                                  |
| 21.7–31.1 s | Paint it        | “Paint it, change it, make it new. Same scene, a different view.”      | Recorded cue painting and before/after reveal (LTX-2.5), the room before and after                                                                                                                                                |
| 31.1–40.5 s | How it's built  | “Open weights on your own machine. Make the next take, run the scene.” | The HD window repaint's executed 50-node ComfyUI graph, the `@comfyorg/sdk` calls that submit it, then a recorded real run on an RTX 5080: Aftertake, the ComfyUI console and `nvidia-smi` from Create video to the finished clip |
| 40.5–52.9 s | Change          | “Recast the lead… Five more dancers… Words to video… Pull the camera…” | SAM 3 tracking and MiniMax H3 recast, subject copies, text-to-video, Z-Image still to LTX motion, camera pull-backs                                                                                                               |
| 52.9–61.7 s | Agents and Film | “An agent cuts it, frame by frame. Forty-four tools… Cut to the beat.” | A recorded real MCP session: the 44-tool list, an image generated, polled and inspected, and the image it made; then the Film editor snapping this film's cuts to beats                                                           |
| 61.7–93.5 s | Your call       | “Your clip! Your models! Your call!”, second chorus, “Aftertake.”      | Finishing looks, Wan Animate 2 motion transfer, repainted takes, depth lens blur, layers, montage, end card, credits                                                                                                              |

The UI shots in `recordings/` were captured from the running studio's example
workspace in Chromium at 1920 × 1080, with a drawn cursor. The film crops into
them with Film camera keyframes. Generation is not re-run in these recordings:
the takes shown are the repository's recorded example outputs. Paint strokes,
compare sweeps, typing, look changes, title and transition menus, and the beat
snap are real interactions with the app.

## Execution proof

`proof/` holds two uncut screen recordings from 20 October 2026 on an RTX 5080,
with their logs, job records, MCP trace and validation (`proof/capture-notes.txt`
describes the capture):

- `proof-render.mp4` (5:49): the Product showcase starter rendered in
  Aftertake through `@comfyorg/sdk`, beside the actual ComfyUI console and
  `nvidia-smi`. ComfyUI reports “Prompt executed in 80.97 seconds”.
- `proof-mcp.mp4` (1:04): a real stdio MCP client lists 44 tools, generates
  the Hero banner starter, polls it to `succeeded` and inspects the picture.

The film uses `proof-run.mp4` and `proof-mcp-run.mp4`, which `prepare.py`
cuts from them: one stretch of each recording, sped up 32× and 16×, ending
with a real-time hold. The render recording is cropped below the browser's
toolbar and letterboxed, not enlarged. The film's captions state both speeds. The engine console prints model paths
under the capture machine's user folder; Color & finish's Hide details blurs
that username wherever it scrolls (113 boxes in 55 frames, from its receipt).
The tool list plays in real time, and the hero banner is the image that MCP
call produced.

Three kinds of picture were made new for this film, all on the CPU and with no
model:

- `echoes` and `ensemble` reuse `examples/subject-duplicates-v2`' saved SAM 3
  mask in the subject compositor (Color silhouette echoes, and four copies).
- `castle-warm`, `-cool`, `-noir` and `-vintage` are Color & finish exports of
  the HD lighthouse pull-back take.
- `graph-portal.png` is drawn by `build/workflow-graph.py` from
  `examples/portal-v2/executed-workflow.json`, the graph ComfyUI executed for
  the window repaint. Every node and link is from the file; Aftertake's custom
  nodes are in lime. The code lines are quoted from `server/sdk-worker.mjs`.
  The job line (`f402b3b2`, 203 s) is ComfyUI's own `execution_start` to
  `execution_success` time, from `examples/portal-v2/native-engine-timing.json`.

The MCP and Film recordings quote real results: the 44-tool list and image
job from `proof-mcp.mp4`, and “102 BPM · 10 cuts on the beat” in the Film
editor.

## Rebuild it

Install the [local studio](../../README.md#run-locally) and its Film runtime.
Render the soundtrack by opening `build/aftertake-song-ace-step.json` in
ComfyUI or Comfy Cloud. `build/generate-song.mjs` submits the same graph
through the Comfy SDK, which requires a paid Comfy Cloud plan.
`build/prepare.py` checks the result against the hash in `build/music.json`;
a different take needs its own drop and end-card beats there. Then, from the
repository root:

```sh
node scripts/run-demo.mjs --port=4312          # example workspace with the takes
python examples/then-comes-the-aftertake/build/prepare.py path/to/aftertake-song.mp3
cd examples/then-comes-the-aftertake/build
node run.mjs ../work/scenes 01 02 03 04 05 06 07
node master.mjs ../work                         # writes ../work/then-comes-the-aftertake.mp4
```

`prepare.py` runs the beat analysis and writes the black and brand plates. It
also re-renders the CPU subject effects and looks, all from repository
examples. The recording scripts (`build/r*.cjs`) re-record the UI against
`--port=4312`. Playwright's Chromium cannot decode H.264, so convert the demo
workspace's MP4s to VP9-in-MP4 first, for recording only.

To open a scene in the editor, import the matching media, then use **Import
film project** with a file from `project/`. Project files hold content hashes,
not media. The master project references the seven scene renders by hash.

### Sharpened on Comfy Cloud

The released cut swaps 23 generated plates for ×2 upscales. In Render setup,
switch Upscale to Comfy Cloud (or keep it on a local GPU with the `--upscale`
profile), then:

```sh
python examples/then-comes-the-aftertake/build/sharpen.py     # needs the studio and build/prepare.py's work folder
cd examples/then-comes-the-aftertake/build
node rerender.mjs ../work/sharp path/to/soundtrack.wav       # the released film's audio track
```

`sharpen.py` finds every video plate the scene projects use below 1920 pixels
wide, upscales it with SeedVR2 3B through the Upscale studio and downloads the
result. It then rebuilds the four castle looks with Color & finish from the
upscaled castle. `rerender.mjs` re-renders the seven scene projects with each
plate swapped for its upscale, checks every scene's frame count and joins them.
[`sharpening.json`](sharpening.json) records every plate's source and output
hash, size and Cloud job, and the three 1344 × 736 clips left as they were:
the Upscale studio accepts sources up to 1280 pixels on the long side. The
upscales took 62 minutes from submission to download, on a Comfy Cloud
Standard plan.

## Boundaries

This is a promotional cut, not a benchmark. Generated takes come from the
reviewed examples in this repository at their native resolutions. The HD
examples (recast, copies, echoes, gesture transfer, window repaint, lighthouse,
depth) are 1280 × 720; the older takes in the drop, the second chorus and the
montage are mostly 768 × 432. In the released cut, SeedVR2 upscales most of
them ×2. That adds plausible detail, not recorded detail: dense foliage can
look slightly patterned. The HD source plates are generated, not filmed, and every person in
them is fictional. The
dancer copies and colour echoes reuse source pixels. Lighting, depth and
occlusion are not re-inferred. Transition smears, zoom blur and glitch bands
are export effects; the browser preview shows the poses.

See [CREDITS.md](CREDITS.md) for sources and licences.
