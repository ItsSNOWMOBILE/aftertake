# Aftertake identity

The mark is a lowercase **a** interrupted by a diagonal splice. Its detached shoulder is the next take: a small continuation of the same shape. The round counter keeps the silhouette readable in a dense editing interface. The logo uses one color and no effects.

## Production assets

| File | Use |
| --- | --- |
| `public/brand/aftertake-logo-dark.svg` | Full lockup on dark backgrounds: moss mark, paper lettering |
| `public/brand/aftertake-logo-light.svg` | Full lockup on light backgrounds: ink |
| `public/brand/aftertake-logo-mono.svg` | Full lockup in one color; inline SVG inherits `currentColor` |
| `public/brand/aftertake-mark-dark.svg` | Compact moss mark on dark backgrounds |
| `public/brand/aftertake-mark-light.svg` | Compact ink mark on light backgrounds |
| `public/brand/aftertake-mark-mono.svg` | Compact mark in one color; inline SVG inherits `currentColor` |
| `public/brand/favicon.svg` | Moss tile with an ink mark; tuned for a browser tab |
| `public/brand/identity-specimen.svg` | Vector review sheet with full, compact, inverse, and small uses |

Dark and light name the intended **background**, not the logo color. A monochrome SVG used through an `<img>` defaults to black; use the fixed light/dark asset when external SVG color cannot be inherited.

## App component

```tsx
import AftertakeBrand from './AftertakeBrand';

<AftertakeBrand />
<AftertakeBrand compact />
<AftertakeBrand compact className="studio-brand" />
<AftertakeBrand decorative />
```

The default component is a 174.21 by 32 SVG with an accessible `Aftertake` label. `compact` returns the 32 by 32 mark. Both inherit `currentColor`. Set the color and display size in the consuming stylesheet. Use `decorative` when a parent control or adjacent text already gives the brand an accessible name. The component is an image, not a control; wrap it in a semantic link when it navigates.

## Scale and space

Use the mark at 24 pixels or larger in the app. The favicon has a dedicated tile treatment for 16 pixels. The full lockup is intended for 130 pixels or wider. Preserve the SVG aspect ratio and give the mark at least one quarter of its width in clear space. Keep the diagonal cut open; do not add shadows, outlines, gradients, or a second symbol inside the counter.

## Color and typography

- Moss: `#D5E991` — mark and selected actions on ink.
- Ink: `#141615` — studio canvas and the logo on pale backgrounds.
- Paper: `#E9EAE4` — full wordmark and primary text on ink.

The lowercase wordmark uses Manrope at weight 650 with slightly tightened spacing. The export contains outlines rather than live text, so it does not require an installed font or a network request. The app may continue using its existing Manrope headings and DM Sans interface text. Keep the wordmark as supplied; use normal title case **Aftertake** in prose.

## Source and provenance

The splice mark was drawn directly as original SVG geometry for this project. The wordmark was outlined from the repository's existing `public/fonts/manrope.ttf` variable font at weight 650. No external font, stock logo, bitmap, or generated raster image was used. The font's existing SIL Open Font License is included as `public/brand/Manrope-OFL.txt`; the original remains in `public/fonts/manrope-OFL.txt`.

The SVGs are the production assets and `src/AftertakeBrand.tsx` carries the same geometry for the interface. There is no image-generation prompt: this identity is deterministic vector artwork, chosen to stay crisp at navigation and favicon sizes.
