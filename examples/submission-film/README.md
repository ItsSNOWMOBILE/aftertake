# Made in Aftertake — review cut 9

This editable 41.79-second review project has 17 shots, 18 typography layers,
18 complete local Kokoro voice recordings and 11 brief dissolves. It is 27%
shorter than review 8. It is awaiting Jay's review and is not a contest submission.

The story opens with a finished portrait coffee ad, demonstrates editable hooks,
shows coastal VFX and actual character-prompt typing, then reveals its editing project.
Each narration beat owns its visual and caption. Scene length is derived from
the complete voice recording plus reading time. `storyboard.json` records the
spoken line, caption, shot numbers and exact voice/scene windows.

To open it in a fresh checkout:

```sh
pnpm install
python scripts/setup-film.py
pnpm demo
```

Keep the demo running. In another terminal, import the bundled media:

```sh
python scripts/import-film-project.py examples/submission-film/project.json
```

Open **Film assembly**, choose **Import film project**, and select `project.json`.
Use **Expand film editor** for a dedicated editing view. Cuts, dissolves, zoom framing,
typography and sound remain editable. Press **Export film** for the final movie.
Bundled WAVs need no voice-model download. New narration optionally needs
`python scripts/setup-narration.py`.

`project.json` binds original media by SHA-256. Local IDs may differ; restoration
matches exact content. `sourceFiles` lists additional media, `narration.txt` is
the timed script, and `exported-project.json` retains the app's export receipt.
`beats.json` is the editable narration/hold plan used by
`scripts/prepare-submission-film.py`; the preparer caches matching local voices
or generates them through the app before measuring scene lengths. Its capture
pass must never be published with placeholders.

The prompt and editor clips are actual browser captures, sampled with wall-clock
timestamps and encoded at 24 fps. The final reveal shows playback of this real
41.79-second project immediately before export. Typing and generated takes play
at their recorded speeds. All final cuts, dissolves, typography, voice synthesis
and export run in Aftertake. Generation waits are omitted.

Narration: Kokoro-82M v1.0, generic `af_heart`, 1.05 speed; the opening coffee ad
retains its original 1.0-speed voice clips. No speech is time-stretched. See
`docs/models-narration.json` for Apache-2.0 provenance and pinned checksums.
Coast footage: [Dean Diemert / Pexels](https://www.pexels.com/video/a-lighthouse-is-seen-from-above-on-the-coast-20730898/).
Coffee footage: Michael Burrows / Pexels; the companion ad projects retain source
links and credits in `examples/social-ad/`. Both use the
[Pexels License](https://www.pexels.com/license/). The silent character-scene
excerpt is Tears of Steel (2012), Blender Foundation, CC BY 3.0; see
`examples/character-replacement/ATTRIBUTION.txt`. Its soundtrack is excluded.
The fictional human reference is generated from text with local Z-Image Turbo.
Z-Image, Qwen Image Edit, Wan Animate 2 and LTX-2.5 retain their model terms.
Aftertake UI/code: MIT; fonts: OFL.

Generated image quality still needs work. Repairing the edit does not establish
that the model pipeline is ready for the competition. Jay retains the final
review and submission decision.
