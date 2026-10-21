# Optional moderate depth blur

This alternate uses blur8 and normalized focus0 selected from the actual face depth sample in `../focus-sample.json`. All haze and lighting parameters match the primary original preset. The original blur2/focus0.05 result remains `../result.png`.

Replay through the same `/api/depth-effects` endpoint using `request.json` after importing the included source and rebinding its local clip ID. This is an ordinary app request. `recipe.json`, `render.json`, executed graph, native depth witnesses, model pins and verification are included.

The face and body remain sharp, with stronger background separation. Some blocky or stepped defocus persists on the left background, and fine silhouette artifacts remain possible. It is a relative-depth approximation rather than a physical lens simulation.
