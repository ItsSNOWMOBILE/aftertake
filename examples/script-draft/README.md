# A reviewed brief-assisted cut

This is a real native UI workflow using the optional local Qwen3-4B script model,
existing Michael Burrows / Pexels coffee footage and local Kokoro narration.
The model sees the written descriptions, not the footage. Its original proposal
is retained in `script-job.json`; two lines were edited before narration.

The final inspected sequence is grounds into a filter, clear water over the
grounds, then brewed coffee poured into a cup. Final copy:

- Start with the grounds.
- Water meets the grounds.
- Make mornings yours.

The first export inspection caught swapped picture descriptions. That rejected
export was corrected before this proof was packaged. `result.mp4` is the final
5.33-second, 720 × 1280 / 24 fps native export: 128 frames, three cuts, three
editable titles, three complete voices and eleven word timings. The matching
native manifest, portable project, voice WAVs, decoded review frames, source
hashes, model receipt and complete-voice checks are included.

Import the three stock clips named by `project.json.sourceFiles` from
`examples/social-ad/media/` and the three WAVs from this folder's `media/`,
then import `project.json` through Film. The project restores the supplied voice
receipts and timings. Model installation is required only for new script
suggestions or new voice requests.

`joined-word-timing.json` records the actual model-duration boundary repair for
“Start with the grounds.” The concatenated individual phonemes exactly match
the timed sequence, including the joined “with the” group. The algorithm uses
measured phoneme boundaries rather than spreading written words over time.

Footage: Michael Burrows / Pexels, under the Pexels License; the original source
links and retained attribution are in `examples/social-ad/ATTRIBUTION.txt` and
`docs/media-attribution.md`. This is a fictional coffee concept with no offer,
affiliation or endorsement. Qwen3, its OpenVINO conversion and Kokoro retain
their Apache-2.0 model licenses; app code is MIT. No music or identity cloning.
Final listening, creative approval and competition submission remain with Jay.
