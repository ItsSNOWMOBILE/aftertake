# More possibilities — original Aftertake demo bed

`music-bed.wav` is the ready-to-import **39.000-second, 48 kHz stereo PCM24** bed for the locked 936-frame / 24 fps reference-style cut. Use **Film volume 1**. Narration is not embedded: the delivered bed already contains gentle pre-ducks/releases for the ten supplied voice windows and the retained ad voice at 22.5–24.0 seconds. The opening uses the actual One (0–0.794s) and Three (0.727333–1.566625s) audio, then releases to the full bed by 1.806625s. If the edit or narration timing changes, update the generator's windows and regenerate.

The arrangement uses soft Cmaj9 / Am9 / Fmaj9 / G6 voicings, a restrained muted kick/sub pulse, fine closed hats and short filtered-air transitions. Sparse two-note answers appear in gaps. Section pulses restart at the editorial anchors; the edit is not stretched to an unrelated fixed-length bar grid. The final 1.75 seconds fade to zero.

Every music sound is synthesized from sine partials or seeded numerical noise. No third-party audio sample, music recording or reference-film soundtrack was used. The existing narration and spoken-type audio are **only measured** to set ducking; none of their samples is present in this bed.

## Level and checks

- Delivered, already-ducked bed: **−30.35 LUFS integrated**, **−12.41 dBTP**, no clipped samples.
- Unducked reference of the same original composition: **−26.39 LUFS / −12.25 dBTP**. This reference is not the intended Film import.
- The ready bed is quieter than the initial −24-ish aim because the actual raw narration measures approximately −26 LUFS. Each supplied narration window has at least **10 dB voice-to-bed RMS margin**; the retained ad voice has at least **15 dB**. These are measured window averages, not a listening/intelligibility certificate.
- Exact length: **1,872,000 samples per channel = 936 frames at 24 fps**.
- Two fresh generator processes produced the identical WAV SHA-256: `aece5ce0048f626367951e0710a025f4a1e09e5ab0a2d51c243e25d793c40ff9`.
- `music-waveform.png` shows both channels with **4× display gain**; it does not modify the audio. Clipping, tail amplitude, loudness and per-window margins are recorded in `music-provenance.json`.
- Review scope: waveform and numeric/clock checks. No human listening or full-film creative approval is claimed.

## Editorial anchors

| Marker | Time | Picture frame |
| --- | ---: | ---: |
| Three-dancer reveal | 0.750s | 18 |
| Brand card | 3.041667s | 73 |
| Character result | 9.000s | 216 |
| Finishing result | 12.541667s | 301 |
| Create result | 15.000s | 360 |
| Ad montage | 18.000s | 432 |
| Agent workspace | 24.000s | 576 |
| Open weights | 28.000s | 672 |
| Made in Aftertake reveal | 32.000s | 768 |
| Closing CTA | 35.000s | 840 |

`music-events.json` retains actual event starts/sample indices and their associated editorial markers. Air transitions extend briefly around the marked cut; they are not constant risers.

## Reproduce

Run from this repository with the ten measured voice WAVs, `voice-receipts.json` and the existing public spoken-type example available:

```sh
.runtime/venv/Scripts/python.exe examples/product-film/generate-music-bed.py
```

The checked runtime is Python 3.12.14, NumPy 2.5.2 and the repository's bundled FFmpeg 7.1. It requires no model, GPU, paid API or external audio download. The FFmpeg loudness filter is used for analysis only; mastering uses scalar gain and explicit envelopes. Exact WAV reproduction was verified in this runtime, with no cross-runtime byte guarantee.

## License

Original synthesized music and sound design: **CC0-1.0**, created for Aftertake by Aftertake contributors. Generator source: **MIT**, under the repository's code license. No rights in the separate narration, source clips or reference video are granted by this music dedication. The other assets retain their own terms.
