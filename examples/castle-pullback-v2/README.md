# Lighthouse storm — guided camera pullback

A fictional Z-Image lighthouse still is animated with the original camera recipe: seed **2960**, final quality, pull movement, wide lens, source lighting/palette and motion-track guidance. The folder keeps its legacy `castle-pullback-v2` name; the prompt is explicitly adapted to the new lighthouse rather than claiming it is a castle.

`source.png` is the original 1280 × 720 still and `result.mp4` is the 1280 × 720 animation. The source-aware storm prompt, exact settings, native raw output and camera guide are retained where the app exposes them. The camera model's aligned canvas and final crop are recorded in the graph; no resized 768-pixel result is represented as native 720p generation.

To reproduce, import the included still, replace its local clip ID in `request.json`, and submit the same request through Aftertake's normal `/api/renders` route. Preserve all cinema, cue, seed and quality fields. `recipe.json`, `render.json`, `executed-workflow.json` and `models.json` record the workflow, observed execution and pinned model provenance. Source generation recipes are included. This input is a still and has no source audio to preserve.

Visual review: the lighthouse stays recognizable during the pullback and waves move across the clip. The source lightning bolt persists unusually long, so this should be presented as a stylized storm animation rather than physically accurate lightning. See visual-review.json and the nine-time contact.
