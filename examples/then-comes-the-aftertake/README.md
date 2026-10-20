# THEN COMES THE AFTERTAKE

A 93-second, beat-cut product film for the Open Source Higgsfield challenge,
made entirely in Aftertake. Every moving picture is an Aftertake output or a real
recording of the app. Every title, graphic, transition and cut is a layer in
seven native Film projects, rendered by Aftertake's own CPU Film renderer.

[![Watch the film](poster.jpg)](film.mp4)

**[Watch the film](film.mp4)** · [Editable projects](project/) · [Build scripts](build/)

| | |
| :--- | :--- |
| Length | 93.458 s, 1920 × 1080, 24 fps |
| Edit | 58 shots in 7 scene projects, 1.9 s average shot |
| Typography | 80 titles: slam, pop, line reveal, glitch, scramble, typewriter |
| Transitions | 23 styled: whip pan, zoom punch, flash, glitch cut |
| Graphics | 15 animated Film graphics (the architecture diagram and logo) |
| Music | “Aftertake”, an original song made with open-weight ACE-Step 1.5 on Comfy Cloud, 102.3 BPM |
| Audio | −16.1 LUFS integrated, −1.5 dBTP |

## How it was cut

1. The song was written for the film. Its lyrics, tempo and structure are in
   `build/song.json`. ACE-Step 1.5 XL Turbo, an open-weight model, rendered it
   on Comfy Cloud from `build/aftertake-song-ace-step.json`.
   `aftertake_detect_beats` measured 102.3 BPM, and the drums enter on the
   downbeat at 10.542 s. `build/music.json` records that drop, and the
   Aftertake logo lands on it. The song's two near-silent breaks fall under
   “ONE IMAGE.” and “YOUR CALL.”. The music re-enters on “A MOVING SHOT.”, and
   again as the end-card logo slams in.
2. Each scene is a native Film project authored on that beat grid
   (`build/edit.mjs`). A styled transition is centred on its beat, so flash,
   glitch and zoom punches switch pictures exactly on the hit. Measured on the
   export, every hard cut is within one frame of a beat.
3. `build/run.mjs` exported each scene through the studio's `/api/films`
   endpoint, the same path the editor and MCP use. Each produced an
   `aftertake-film/5` project. `build/master.mjs` joined the seven scene renders
   with the music. Scene boundaries fall on downbeats, and every scene's frame
   count is checked against the grid.
4. The Film-editor shots near the end are a real recording of this film's
   second scene, open in the editor. **Snap cuts to beats** reports
   “102 BPM · 10 cuts on the beat” for the film's song.

## What is on screen

| Time | Scene | Real Aftertake work shown |
| :--- | :--- | :--- |
| 0–12.3 s | Every shot ends | Source excerpts: empty room, forest falls, Tears of Steel bridge |
| 12.3–21.7 s | The drop | Generated results on every beat: portal, crystal, golden falls, castle, winter, Reclaimed, observatory, text-to-video, Wan motion transfer, five tracked dancers |
| 21.7–31.1 s | How it's built | Architecture diagram drawn with Film graphics: Aftertake → Comfy SDK → your ComfyUI, eight open-weight models |
| 31.1–49.9 s | Create | Recorded cue painting and before/after reveal (LTX-2.5), text-to-video, Z-Image still to LTX motion, camera pull-backs |
| 49.9–69.3 s | Change | SAM 3 tracking and MiniMax H3 recast, subject copies and colour echoes, Wan Animate 2 motion transfer, four finishing looks, depth lens blur, layers |
| 69.3–78.8 s | Agents and Film | Real MCP results, an ad assembled through MCP, the Film editor cutting this film |
| 78.8–93.5 s | Your call | Finale montage, end card on the song's last re-entry, credits |

The UI shots in `recordings/` were captured from the running studio's example
workspace in Chromium at 1920 × 1080, with a drawn cursor. The film crops into
them with Film camera keyframes. Generation is not re-run in these recordings:
the takes shown are the repository's recorded example outputs. Paint strokes,
compare sweeps, typing, look changes, title and transition menus, and the beat
snap are real interactions with the app.

Three kinds of footage were made new for this film, all on the CPU and with no
model:

- `echoes` and `ensemble` reuse `examples/subject-duplicates`' saved SAM 3 mask
  in the subject compositor (Color silhouette echoes, and four copies).
- `castle-warm`, `-cool`, `-noir` and `-vintage` are Color & finish exports of
  the castle pull-back take.
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
reviewed examples in this repository at their native resolutions (mostly
768 × 432). The 1080p canvas enlarges them; it does not add detail. The
dancer copies and colour echoes reuse source pixels. Lighting, depth and
occlusion are not re-inferred. Transition smears, zoom blur and glitch bands
are export effects; the browser preview shows the poses.

See [CREDITS.md](CREDITS.md) for sources and licences.
