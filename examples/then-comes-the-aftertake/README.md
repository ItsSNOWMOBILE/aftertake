# THEN COMES THE AFTERTAKE

A 93-second, beat-cut product film for the Open Source Higgsfield challenge,
made entirely in Aftertake. Every moving picture is an Aftertake output or a real
recording of the app. Every title, graphic, transition and cut is a layer in
seven native Film projects, rendered by Aftertake's own CPU Film renderer.

[![Watch the film](poster.jpg)](film.mp4)

**[Watch the film](film.mp4)** · [Editable projects](project/) · [Build scripts](build/)

|             |                                                                                            |
| :---------- | :----------------------------------------------------------------------------------------- |
| Length      | 93.458 s, 1920 × 1080, 24 fps                                                              |
| Edit        | 71 shots in 7 scene projects, 1.3 s average shot, each section under its sung line         |
| Typography  | 96 titles: slam, pop, line reveal, glitch, scramble, typewriter                            |
| Transitions | 25 styled: whip pan, zoom punch, flash, glitch cut                                         |
| Graphics    | 15 animated Film graphics (the architecture diagram and logo)                              |
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

| Time        | Scene           | Sung                                                                   | Real Aftertake work shown                                                                                                                                                  |
| :---------- | :-------------- | :--------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0–12.3 s    | Every shot ends | “Every shot ends… then comes the…”                                     | The HD source plates: rooftop walk, orange-hoodie dancer, loft window                                                                                                      |
| 12.3–21.7 s | The drop        | (drop)                                                                 | Generated results on every beat: portal, crystal, golden falls, castle, winter, Reclaimed, observatory, text-to-video, Wan motion transfer, five tracked dancers           |
| 21.7–31.1 s | Paint it        | “Paint it, change it, make it new. Same scene, a different view.”      | Recorded cue painting and before/after reveal (LTX-2.5), the room before and after                                                                                         |
| 31.1–40.5 s | How it's built  | “Open weights on your own machine. Make the next take, run the scene.” | The HD window repaint's executed 50-node ComfyUI graph, the `@comfyorg/sdk` calls that submit it, ComfyUI's recorded run time, and the stack with eight open-weight models |
| 40.5–52.9 s | Change          | “Recast the lead… Five more dancers… Words to video… Pull the camera…” | SAM 3 tracking and MiniMax H3 recast, subject copies, text-to-video, Z-Image still to LTX motion, camera pull-backs                                                        |
| 52.9–61.7 s | Agents and Film | “An agent cuts it, frame by frame. Forty-four tools… Cut to the beat.” | Real MCP results, an ad assembled through MCP, the Film editor snapping this film's cuts to beats                                                                          |
| 61.7–93.5 s | Your call       | “Your clip! Your models! Your call!”, second chorus, “Aftertake.”      | Finishing looks, Wan Animate 2 motion transfer, repainted takes, depth lens blur, layers, montage, end card, credits                                                       |

The UI shots in `recordings/` were captured from the running studio's example
workspace in Chromium at 1920 × 1080, with a drawn cursor. The film crops into
them with Film camera keyframes. Generation is not re-run in these recordings:
the takes shown are the repository's recorded example outputs. Paint strokes,
compare sweeps, typing, look changes, title and transition menus, and the beat
snap are real interactions with the app.

Four kinds of picture were made new for this film, all on the CPU and with no
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
- The MCP lines quote a real `aftertake_detect_beats` call (102 BPM in 0.9 s)
  through the official MCP SDK; the client listed 44 tools. The other three
  lines name tools without quoting results.

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

## Boundaries

This is a promotional cut, not a benchmark. Generated takes come from the
reviewed examples in this repository at their native resolutions. The HD
examples (recast, copies, echoes, gesture transfer, window repaint, lighthouse,
depth) are 1280 × 720; the older takes in the drop, the second chorus and the
montage are mostly 768 × 432. The 1080p canvas enlarges them; it does not add
detail. The HD source plates are generated, not filmed, and every person in
them is fictional. The
dancer copies and colour echoes reuse source pixels. Lighting, depth and
occlusion are not re-inferred. Transition smears, zoom blur and glitch bands
are export effects; the browser preview shows the poses.

See [CREDITS.md](CREDITS.md) for sources and licences.
