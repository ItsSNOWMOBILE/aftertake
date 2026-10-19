# One performance. Your next take.

[Watch the 39-second edit](https://aftertake-studio.right-bard-9761.chatgpt.site/edit-preview/)
or [download the MP4](https://aftertake-studio.right-bard-9761.chatgpt.site/edit-preview/review.mp4).

The edit combines tracked subject copies, native H3 character replacement,
color finishing, LTX reference animation, a portrait ad and editable typography.
Its final reveal shows the actual Film project used to assemble it.

All 19 cuts, 17 titles and 11 sound layers are native Aftertake Film operations.
The 39-second output has 936 frames at 24 fps. Headline timing follows measured
Kokoro word onsets; original synthesized music is a separate sound layer.
The UI footage consists of held captures from the real editor, with generation
waits omitted. These captures demonstrate the workflow, rather than replaying
every model execution in real time.

## Reopen the edit

Start the local studio with the CPU Film runtime installed. Download the
[optional input bundle](https://aftertake-studio.right-bard-9761.chatgpt.site/edit-preview/film-inputs-a3a8d7660417c10a.zip).
It contains only the additional screen captures, high-resolution stock inserts,
narration and music. Existing example sources come from this repository.
The bundle stays outside Git history; `media-bundle.json` records every checksum.

```sh
python examples/product-film/import-media.py /path/to/film-inputs-a3a8d7660417c10a.zip
python scripts/import-film-project.py examples/product-film/project.json --url http://127.0.0.1:4312
```

Open **Film assembly → Import film project**, select `project.json`, then inspect
the draft or export it. You can change the narration, titles, footage, framing
and timing. Assembling the existing footage needs no diffusion GPU. Generating
new footage uses the corresponding model profiles and hardware checks.

`output-receipt.json` identifies the reviewed export. Different FFmpeg builds or
encoders may produce different container bytes; the source hashes and native
project retain the exact edit. The full-motion review and creative approval
remain with the viewer.

## Sources and reproduction

- Dance footage and tracked masks: [subject-duplicates](../subject-duplicates/README.md).
- Character result: [character-h3-high](../character-h3-high/README.md).
- Reference animation: [observatory recipe](../observatory/recipe.json).
- Coffee footage: Michael Burrows, Pexels; see `coffee-source-receipts.json` and
  [the original source credits](../social-ad/sources.json). High-resolution
  inserts retain the original encoded packets; creative framing happens in Film.
- Narration: local Kokoro; `voice-receipts.json` includes requests, model hashes
  and measured word timing. `headline-speech-ledger.json` maps titles to speech.
- Original score: CC0-1.0; generator source is MIT. See [MUSIC.md](MUSIC.md).
- `capture-receipts.json` identifies actual editor captures and their timing limits.

The reference video's footage, soundtrack, branding and narration are not included.
