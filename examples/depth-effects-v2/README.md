# Silver-haired portrait — preserved depth recipe

`source.png` and `result.png` are the native 1280 × 720 portrait and depth-effect result. The original settings are preserved exactly: focus 0.05, blur 2, haze 0.18, haze color `#cbd7e3`, light azimuth −45°, elevation 35° and strength 0.25. This is a recipe reproduction, not a silently strengthened blur example.

The generated source already has substantial background bokeh and appears closer to dusk/daylight than the requested night prompt. Consequently this original blur setting may add only a subtle change. The source prompt and seed are retained honestly in its generation metadata.

`depth.png` and `raw-depth.npz` preserve the depth witnesses. Reproduce by importing the still, rebinding its clip ID in `request.json`, and submitting through the normal `/api/depth-effects` route. Keep the exact settings object. `recipe.json`, `render.json`, `executed-workflow.json` and `models.json` retain parameters, graph and pinned Depth Anything 3 provenance. Application code and model weights have separate license terms.


An optional moderate result lives in `stronger-blur/`: blur 8 and sampled focus 0, with all other settings unchanged. The face sample and normalization method are in `focus-sample.json`. A stronger blur 24 stress test was rejected privately for exaggerated depth bands and hair-edge rim. Even blur 8 retains some blocky left-background defocus and thin edge artifacts; this is a relative-depth approximation, not physically perfect lens bokeh. The source was not degraded for the comparison.
