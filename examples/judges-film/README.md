# Aftertake — the next take

One final 53.04-second editable Film: 19 cuts,
24 title layers and 13 complete outer Kokoro narrator clips.
The portrait coffee excerpt retains one embedded utterance. The home and judges
pages show this same movie; `submission-film` and `judges-film` are compatibility
project locations, not separate current edits.

From a fresh checkout, install the app and CPU Film dependencies:

```sh
pnpm install
python scripts/setup-film.py
pnpm demo
```

Keep the demo running, then import the hash-verified media in another terminal:

```sh
python scripts/import-film-project.py examples/judges-film/project.json
```

In Film assembly choose **Import film project** and select `project.json`.
Existing WAVs require no voice-model download. Source paths resolve from the
repository root and every source is bound by SHA-256. `exported-project.json`
retains the actual ready native export; `storyboard.json` and `narration.txt`
describe the thirteen measured beats. `voices.json`, `voice-receipts.json`,
`capture-receipts.json`, `fresh-capture-receipts.json`, `agent-session.json` and
`native-export-receipt.json` preserve the actual provenance. `review.json`
contains decoded frame/audio checks and their limits.

The film develops one coastal cue/composite edit, tracked H3 character
replacement, one native portrait LTX product creation, an editable coffee hook,
an actual MCP session receipt and a genuine final Film editor reveal.
The receipt graphic is labeled as a receipt and is not a screenshot of a tool
interface. Generation and preparation waits are omitted. No exact facial
performance or general output-quality guarantee is implied.

Footage: Michael Burrows and Dean Diemert / Pexels; silent Tears of Steel excerpt,
Blender Foundation, CC BY 3.0. Coffee and fragrance concepts are fictional.
The human reference is fictional. App code: MIT; fonts: OFL; model and media
licenses apply separately. See `docs/media-attribution.md` and model receipts.
Final review and submission remain separate decisions; installation does not
publish the site or submit an entry.
