# Native text-to-video examples

These invented fragrance-bottle scenes were generated directly from text using
native LTX-2.5 joint audio/video sampling through the official Comfy SDK.
There is no source photograph, product footage, brand or real product claim.

- `portrait/`: preferred 73-frame, 576 × 1024 take with generated ambience.
- `square/`: separate 49-frame, 512 × 512 silent draft and MCP integration test.
  The bottle proportions/exposure drift; the requested camera is prompt
  guidance. This alternate draft does not establish product-identity locking.

Each directory contains the raw MP4, request/recipe, executed API graph,
completed job record, clip metadata, decoded-media receipt and review frames.
The portrait and square depict independent invented bottles. They are not
reference-preserving transformations or evidence of consistent product identity.

In the local studio, open **Create video**, import the selected `recipe.json`,
review its settings and create a deliberate new take. Identical output bytes
are not guaranteed across runtimes. `pnpm demo` loads these recorded completed
jobs and sources without starting inference. See `docs/text-video.md` for setup.

`mcp-evidence.json` records a real stdio transport test: one native silent job,
exact rejoin after reconnect, rejection of changed inputs under its original
key, decoded review frames, and content-verified Film import/reuse. `studio.jpg`
is an actual local UI capture after recipe reimport. No contest entry was sent.

App code is MIT. Model and output terms are separate; see `ATTRIBUTION.txt`.
