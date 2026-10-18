# Make a narrated cut

Film's narrated-cut builder pairs written lines with the pictures you select.
It voices each line locally, measures the complete WAV, trims the picture to
cover it, and prepares matching editable titles. The main viewer shows the
prepared result before you use it.

1. Import footage or stills in Film and arrange up to 16 pictures. Set their
   In/Out ranges and choose portrait, square or landscape.
2. Open **Make a narrated cut** and write one short line per picture. Choose a
   generic voice, speed, typography, pace and transition.
3. Select **Prepare narrated cut**. Review the main viewer and timing ledger.
   The original draft remains available through **Return to current film**.
4. Select **Use this narrated cut**, then edit any picture, title or voice in
   the regular editor. **Restore previous cut** restores the prior draft.
5. Export the MP4 and editable project. An unchanged export rejoins its recorded
   job. A new attempt follows an observed failed export.

The selected In/Out range is the available picture coverage. A line that does
not fit is rejected with its required duration. Extend that Out trim or shorten
the line. The builder keeps the source start and framing, uses full voice clips,
and checks source and voice hashes again before saving the plan. It does not
loop footage, truncate speech or add camera movement.

Quick pace leaves a short breath after each line; relaxed pace leaves more
room. Three- and six-frame dissolves share the native 24 fps clock. Caption
windows follow the spoken line, and the builder prevents overlapping voices
and captions. Bold typography enlarges short opening and closing lines and
portrait captions. Longer lines use the caption layout. Entrance animation
remains distinct from forced word alignment.

**Follow voice** highlights spoken words in short, fixed-layout phrases. It
uses the pinned Kokoro model's phoneme-duration output from that exact generated
WAV, including synthesis trim and pause offsets. No extra runtime model is
downloaded. These are model timing estimates, not exact acoustic boundaries.
In **Typography → Speech timing**, adjust any word's From/Until value relative
to its title start. Changing title wording clears its speech timing and switches
to Fade; prepare the revised spoken line to regenerate matching timing.

The tokenizer groups expanded forms such as “20%” under the original written
unit. Ambiguous written/spoken unit counts refuse this style; choose clean
captions or simplify the line. The voice remains available even when its word
mapping is unusable. The recorded example is `examples/spoken-type/project.json`.

The prepared draft mutes original sound and normalizes the voice mix. Mastering
measures the complete mix and applies one constant gain with peak headroom,
preserving the volume envelope within each spoken line. Adjust
those controls after applying it if your source sound belongs in the edit.
Unprepared scripts and settings stay in this browser. Exported projects retain
the saved voice script, model receipts and word timings. Import verifies the
audio hash and duration before restoring that metadata. The UI identifies an
imported project receipt, and different receipts for identical WAVs stay separate.
Completed voices stay in the local media library. Matching script/voice/speed
requests reuse verified files; a timed voice also supports plain typography.
Stopping preparation lets the current operation finish and retains its voices.
Changing the draft or script requires a newly matched preview before applying.

The UI and local MCP use the same content-bound beat compiler. Both produce the
regular editable Film project. New lines require local Kokoro. Reusing the
supplied lines and exporting an existing project require only the CPU film runtime:

```sh
pnpm install
python scripts/setup-film.py
python scripts/setup-narration.py
pnpm demo
```

To reopen the recorded coffee example or walkthrough without revoicing:

```sh
python scripts/import-film-project.py examples/narrated-cut/project.json --url http://127.0.0.1:4312
python scripts/import-film-project.py examples/narrated-cut/workflow-project.json --url http://127.0.0.1:4312
python scripts/import-film-project.py examples/spoken-type/project.json --url http://127.0.0.1:4312
```

Then choose **Import film project** in Film and select the corresponding JSON.
For a short cut with one complete, uniform voice per picture, open **Make a
narrated cut → Use this film's narration**. It recovers the saved lines, voice
and typography settings. Prepare and review a new candidate before using it.
The supplied Follow voice ad can be re-prepared with its cached WAVs, including
a switch to bold typography, without installing the narration model. New copy
or a different voice still needs the optional narration runtime.
The complete source downloads retain the original licensed footage, exact
voices, UI recordings, two hook variants and projects. Footage is Michael
Burrows / Pexels; the coffee concept has no real offer or endorsement.

The renderer intersects title layers and trims their source frames on integer
frame ranges. This fixes the empty floating-point overlap found by this real
workflow. The decoded regression also checks that the next title stays absent
before its first frame. FFmpeg's frame counters and timeline enable expressions
are documented in its [official filter reference](https://ffmpeg.org/ffmpeg-filters.html#Timeline-editing).

This workflow prepares reviewed lines and user-selected pictures. The optional
[local script draft](script-draft.md) can suggest copy from a brief and written
picture descriptions. Suggestions require review and explicit application.
Automatic footage selection and campaign optimization remain separate work.
