# Make it yours

[Watch the narrated 40.5-second film](https://itssnowmobile.github.io/aftertake/make-it-yours/)
or [download the MP4](https://itssnowmobile.github.io/aftertake/make-it-yours/review.mp4).

A vertical coffee ad becomes a different hook. One performance becomes three
tracked dancers, then a finished grade. A native H3 comparison changes the
character. The closing reveal shows the actual Film project used for the edit.

The main film has **13 cuts, 12 titles and 12 sound clips**, rendered at
1280 × 720, 24 fps. It uses the saved portrait-ad export as footage;
`coffee-ad-project.json` separately retains that ad's cuts, camera moves,
typography and sound. Both projects were exported through Aftertake's native
Film tools. The UI sections are genuine still captures with authored camera
movement. Source/result pairs replay the same short performance for comparison.

## Reopen the edit

Install dependencies and the small CPU Film runtime, then start the example
workspace. Python setup uses Python 3.12.

```sh
pnpm install --frozen-lockfile
python scripts/setup-film.py
pnpm demo
```

Download the [40.7 MB input bundle](https://github.com/ItsSNOWMOBILE/aftertake/releases/download/demo-make-it-yours-2026-10-19/film-inputs-aa6e20876a7f044d.zip).
It contains the additional footage, UI stills, narration, music and saved
portrait-ad output. Four existing dance and H3 inputs remain in this checkout.
The manifest records every checksum; the importer checks the complete archive
and refuses to overwrite changed local inputs.

In another terminal, run:

```sh
python examples/product-film/import-media.py /path/to/film-inputs-aa6e20876a7f044d.zip
python scripts/import-film-project.py examples/product-film/coffee-ad-project.json --url http://127.0.0.1:4312
python scripts/import-film-project.py examples/product-film/project.json --url http://127.0.0.1:4312
```

Open **Film assembly → Import film project** and select either JSON project.
Importing starts no render. Change the shots, words, framing and timing, then
export through Film assembly. To carry a change from the coffee ad into the
main film, export the revised ad and deliberately replace its source footage.

Assembling these existing inputs needs no diffusion GPU. Generating new
footage uses the corresponding model profiles and hardware checks.

## Sources and verification

- Dance footage and original tracked pixels: [subject-duplicates](../subject-duplicates/README.md).
- Native H3 performance: [character-h3-high](../character-h3-high/README.md).
- Coffee footage: Michael Burrows / Pexels; see `coffee-source-receipts.json`
  and [the original attribution](../social-ad/sources.json).
- Local Kokoro narration and measured words are retained in both projects.
  `headline-speech-ledger.json` records the main film's spoken timeline.
- Original score: CC0-1.0; see [MUSIC.md](MUSIC.md).
- `source-provenance.json` maps all 30 unique inputs to their source hashes
  and attribution. `output-receipt.json` identifies the native export.

Source hashes, the native Film record and the project decoded from the MP4
were checked, alongside selected frames and every cut boundary. Container
bytes can differ between FFmpeg builds. Watch the film to assess its motion,
sound and creative quality.

A [fresh-workspace replay](replay-receipt.json) imported both packaged projects
through the normal importer and exported the main film through MCP with Comfy
offline. All 972 decoded frames, audio samples and timestamps matched this film.

The [earlier 39-second edit](https://itssnowmobile.github.io/aftertake/edit-preview/)
remains available with its original project and input bundle.
