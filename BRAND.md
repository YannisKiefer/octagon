# Octagon brand

This is the single source of truth for the Octagon identity. If a design
decision is not covered here, prefer restraint and consistency over invention.

## Logo

The mark is an octagonal band with a gap on the top-right diagonal and a bronze
parallelogram set into that gap at 45 degrees, offset outward. The wordmark is
"Octagon" set in DM Sans Medium.

- Master file: `assets/brand/octagon-mark.png` (full color on transparency,
  from the approved artwork) and `assets/brand/octagon-mark-reversed.png`
  (ivory band for dark backgrounds). `assets/brand/logo-reference.png` is the
  approved reference artwork. Do not redraw, trace or approximate the mark.
- Variants: mark alone (icons, avatars, favicon), mark + wordmark (headers,
  documents), wordmark alone (rare; only where the mark already appears nearby).
- Clear space: keep at least the height of the band around the mark on all sides.
- Minimum sizes: 24 px mark alone, 90 px wide primary lockup.
- Do not: rotate the mark, recolor it outside the palette, stretch or distort
  it, add effects (shadows, glows, outlines), or rearrange the accent.

## Color

| Name | Hex | Use |
|---|---|---|
| Obsidian | `#0F1F17` | Dark surfaces, primary text on light |
| Forest | `#1F3A2E` | The band, panels on dark, filled buttons on light |
| Bronze | `#C58E5B` | The accent: interactive highlights, the mark's parallelogram |
| Ivory | `#F8F6F1` | Light backgrounds, text on dark |

Rules: light pages are Ivory with Obsidian text. Dark surfaces are Obsidian or
Forest with Ivory text. Bronze is an accent, never a background for body text.
One accent per view; do not introduce new hues. Functional status colors
(green for running, red for failure) may exist in the product interface where
semantics demand it, but they are not brand colors and stay out of marketing
surfaces.

## Typography

DM Sans (SIL OFL, self-hosted in this repository; no font CDNs).

- Wordmark and headlines: DM Sans Medium or Bold, tight leading.
- Body: DM Sans Regular, generous leading.
- Labels and eyebrows: uppercase, letter-spaced, small size.

Fallback stack when the font files are unavailable: system-ui sans-serif.

## Voice

Plain, concrete, honest. Short sentences. No hype adjectives, no emoji, no
fabricated numbers. The brand tagline is "Your iPhone farm, on your Mac."

Never describe the product with language about defeating moderation, looking
human to platforms, warming accounts, or avoiding bans. State what the software
does and does not do. If a claim cannot be verified by running the code, it
does not ship. Aspirational statements are allowed only when clearly labeled
as direction (see VISION.md).

## Applications

- Repository: mark as favicon and social avatar, this file linked from README.
- Website: Ivory page background, Obsidian type, Forest buttons, Bronze links
  and highlights, the mark in the header.
- Product UI: dark surfaces use Obsidian and Forest, Ivory text, Bronze as the
  single accent; status colors follow the rule above.
- Documents and slides: Ivory background, Obsidian type, one bronze rule per
  page at most.

## Files

- `assets/brand/octagon-mark.png` - full-color mark on transparency
- `assets/brand/octagon-mark-reversed.png` - reversed mark for dark surfaces
- `apps/dashboard/app/icon.png`, `website/assets/favicon.png` - app icon tile
- `website/assets/fonts/`, `apps/dashboard/public/fonts/` - DM Sans (OFL)
