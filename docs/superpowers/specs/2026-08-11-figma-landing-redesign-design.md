# Figma landing redesign

## Context

The Figma file "Granada es de to' el mundo — Landing"
(`kdt8Ra45lRX5lHbf6tEzEb`) defines the target visual design for the
existing `web/index.html` landing page. A prior session already pulled
the Hero's color palette and typography into CSS custom properties in
`web/styles.css:1-37` (`--bg-light`, `--ink-on-light`,
`--muted-on-light`, `--line-light`, `--coral`, `--blue`,
`--gradient-wordmark`, plus the `--fs-*`/`--fw-*`/`--lh-*`/`--ls-*`
type-scale tokens). Dark-panel tokens (`--bg-dark`, `--surface`,
`--surface-2`, `--ink-on-dark`, `--line`, `--muted`) were deliberately
left untouched because the Figma file has no dark-panel equivalent —
they're used by the map controls, story panel, and other overlay
chrome, unrelated to this redesign.

This spec covers the next step: rebuilding the landing page's markup
and styling to match the Figma structure section-by-section, while
keeping all existing dynamic behavior (Leaflet map, contribution
form, gallery, newsletter) working against the live API.

## Goal

Rebuild all 9 sections of `web/index.html` (Nav, Hero, Ticker, Pasos,
Mapa vivo, Cita + stats overlay, Galería, Newsletter, Footer) so the
layout and visuals match the Figma design, without regressing any
existing functionality wired up in `web/app.js`.

## Non-goals

- No backend/API changes.
- No new tracked metrics (e.g. Figma's "Testimonios visuales" stat is
  dropped — see Section 6 below — rather than inventing a number we
  don't have).
- No pixel-perfect cloning of Figma's placeholder content (city
  names, testimonial quotes, stat numbers) — those slots stay wired
  to real data from the API, using Figma only as the layout/style
  reference.

## Approach

Section-by-section rewrite of `web/index.html` + `web/styles.css`,
with matching updates to `web/app.js` wherever a section's IDs or
classes change. After each section is rebuilt, view it in the running
dev stack (`docker compose watch`, already running against
`http://localhost/`) and compare against the Figma screenshot for
that node before moving to the next section. This avoids a "big bang"
rewrite that risks breaking the map/form/newsletter wiring silently.

Existing element IDs that `app.js` depends on are preserved unless a
section explicitly calls for renaming (in which case `app.js` is
updated in the same step, never left dangling).

## Page frame & section-card architecture

Pulling `get_design_context` for every top-level frame (not just
Hero) revealed a structural pattern that applies to the whole page,
confirmed with the user to replicate exactly:

- The entire page sits inside a fixed **24px cream margin** on all
  four sides (Figma's "Page frame (border)" node, `--bg-light`
  colored).
- Every section from Ticker onward is its own full-width **rounded
  card** (`border-radius: 24px`) stacked with a consistent **16px
  gap** between cards, each with its own background color — they are
  not edge-to-edge sections on a single page background.
- The Nav is a **floating white pill** (`border-radius: 999px`,
  `box-shadow: 0 6px 20px rgba(33, 28, 18, 0.08)`), not an
  edge-to-edge bar — it sits inset the same 24px from the sides, ~20px
  below the top margin.
- Section background colors, confirmed via `get_design_context` on
  each frame (hex values are exact, taken directly from the Figma
  file):
  - Hero: `--bg-light` (`#faf6ee`)
  - Ticker: `#1c1914` (new token `--ticker-bg`)
  - Pasos: `--bg-light`
  - Mapa vivo: `#211c13` — this is exactly `--ink-on-light`'s value,
    reused as a dark section background rather than adding a
    duplicate token
  - Mapa vivo's inner map panel: `#12181f` (new token
    `--map-panel-bg`)
  - Cita (quote): `#f2954a` — a bright tangerine distinct from
    `--coral`, new token `--accent-bright`. This is **not** a dark
    banner as the current `.dark-pullquote-banner` name implies —
    the background changes to `--accent-bright`.
  - Stats overlay card: `#221d15` (near-black, new token
    `--stats-overlay-bg`), **not white** — its big number is colored
    `--accent-bright`.
  - Galería: `--bg-light`
  - Newsletter: `#5c78b4` — exactly `--blue`, reused directly
  - Footer credits: `#14151c` (new token `--footer-bg`)
- New chip/eyebrow background colors observed: most eyebrow chips use
  `--ink-on-light` (`#211c13`) as a dark pill with white text (Pasos,
  Galería), but Mapa vivo's chip uses `--accent-bright`
  (`#f2954a`) and Cita's chip uses `--coral` (`#c1622d`) — the chip
  is not a single fixed style, it's a shared shape (pill, ~11-12px
  uppercase text, wide tracking) with a per-section background/text
  color pair.
- The stats overlay card (`74:2`) straddles the seam between the
  Mapa vivo card and the Cita card in Figma's Y coordinates (it
  starts before Mapa vivo ends and ends after Cita begins) — it's
  positioned to visually float across the boundary between the two,
  not fully inside either. Implementation: wrap the Mapa vivo and
  Cita cards in a shared `position: relative` container and
  absolutely position the stats card centered on that boundary.
- The Nav's fixed/sticky-on-scroll behavior is not something Figma's
  static frame encodes one way or the other — keeping it sticky at
  the top while scrolling (as the current `.topbar` already does) is
  a reasonable carry-over from existing UX, not a deviation from the
  approved design.

## Section-by-section design

### 1. Nav

Currently a fixed, blurred dark-glass topbar (`.topbar`) spanning the
full viewport width, with a single "Mapa" link. Figma shows a white
floating pill (see Page frame section above), inset from the sides,
with three links (Mapa / Participa / Archivo) and a coral pill CTA
"Subir una foto".

- Restyle `.topbar` into the floating pill: white background,
  `border-radius: 999px`, `box-shadow: 0 6px 20px rgba(33, 28, 18,
  0.08)`, inset by the page's 24px margin, staying sticky/fixed at
  the top on scroll (existing behavior, not a Figma-specified detail
  — see Page frame section).
- Add two nav links: "Participa" (anchors to the Pasos section) and
  "Archivo" (anchors to the Galería section, `#archivo` already
  exists as the section's id).
- Rename the CTA button label to "Subir una foto" (currently "Subir
  foto").
- Keep `#brandLink`, `#brandMark`, `#brandLogo`, `#brandName`,
  `#brandSubtitle` untouched — `loadPublicConfig()` in `app.js`
  writes to these.

### 2. Hero

Already has the right palette/type tokens; the layout needs to
change from a 3-column flex (polaroid / copy / polaroid) to a
centered column (wordmark, subtitle, CTA row, stats row) with 4
decorative floating photo cards positioned around the edges,
matching Figma's `18:5`/`72:52`/`18:8`/`72:56` nodes.

- `.hero-inner` becomes a centered flex column.
- The wordmark ("GRANADA") is rendered with the
  `--gradient-wordmark` background-clip text treatment already
  defined; "es de to' el mundo" sits below it.
- The two real photo cards (`#heroPolaroidLeft`, `#heroPolaroidRight`,
  populated dynamically by `renderHeroPolaroids()` in `app.js`) are
  repositioned as absolutely-positioned rotated cards, one per side.
  Each gets a second, purely decorative card stacked behind it (no
  `img`, just a tinted rect) to reproduce the "double card" depth
  effect Figma uses — this second card carries no data binding.
- CTA row and stats row (`#statPhotos`, `#statCountries`,
  `#statCities`) restyled to Figma's pill buttons and stat
  typography; stat labels updated to Figma's wording ("Total de
  participaciones", "Países activos", "Ciudades conectadas").

### 3. Ticker

New, purely decorative section — doesn't exist today. A dark
(`--ticker-bg`, `#1c1914`) rounded card containing an infinite
horizontal marquee of repeating text ("GRANADA 2031 · CANDIDATURA
CULTURAL · ... · TESTIMONIOS GLOBALES ·"), implemented with a CSS
`@keyframes` translateX loop over a duplicated content list for a
seamless wrap. Marked `aria-hidden="true"` since it carries no
information not available elsewhere on the page. Animation is paused
under `prefers-reduced-motion: reduce`.

### 4. Pasos (how it works)

Existing `.how-to-contribute` section with 3 real `.step-card`s stays
structurally the same. Visual changes only:

- `.eyebrow` becomes a pill/chip: dark background (`--ink-on-light`),
  white uppercase text, wide letter-spacing — this base chip shape is
  shared by every section eyebrow, with each section supplying its
  own background/text color pair (see Page frame section for the
  per-section colors).
- Each step card gets a large numeral (01/02/03) above the title,
  90px, medium weight, colored `rgba(193, 98, 45, 0.7)` (a
  translucent `--coral`, not a stroked/outlined glyph — just a
  low-opacity fill), per Figma's `73:150`/`73:152`/`73:154` nodes.

### 5. Mapa vivo

No functional change — same Leaflet map, same filter chips, same
zoom controls, same IDs. The section wrapper becomes a dark rounded
card (`--ink-on-light` background, white heading text, `--accent-bright`
chip), with the map widget itself sitting in an inner panel colored
`--map-panel-bg` (`#12181f`).

### 6. Cita + stats overlay

`.dark-pullquote-banner` is renamed in spirit but keeps its role
(chip + centered quote) — its background becomes `--accent-bright`
(`#f2954a`), not dark, with a `--coral` chip "LA COMUNIDAD". Add the
stats card that straddles the seam between the Mapa vivo card and
this one (node `74:2`, see Page frame section for the overlap
mechanics): background `--stats-overlay-bg` (`#221d15`), big central
number colored `--accent-bright`. Populated with real data:

- Big central number: total approved count (same value as
  `#statPhotos`).
- Secondary row: countries count, cities count.

Figma's card has a 4th stat, "Testimonios visuales" (13,100), that
doesn't correspond to anything we track separately from the total —
it's dropped rather than duplicating the total count under a
different label. The secondary row therefore has 2 entries, not 3.

Since `#statPhotos`/`#statCountries`/`#statCities` IDs are already
used in the Hero, the overlay card's numbers get their own IDs (e.g.
`#overlayStatTotal`, `#overlayStatCountries`,
`#overlayStatCities`) and `renderStats()` in `app.js` is extended to
set all of them from the same computed values.

### 7. Galería

Existing `#archiveGrid` + `.trace-card` template + "Cargar más fotos"
button stay structurally the same — this section already matches
Figma's intent (tilted polaroid cards from real data via
`renderArchive()`). Only `.trace-card` CSS changes: proportions,
16px image inset, shadow, and caption layout to match Figma's
polaroid look. The existing `--tilt` custom property mechanism is
reused as-is.

### 8. Newsletter

Existing `#newsletterForm` stays functionally identical. The section
background becomes `--blue` (`#5c78b4`, exact match), heading text
white with a subtle text-shadow. The submit button changes from a
text pill ("Avisadme") to a small circular `--coral` arrow ("→")
button sitting inside the rounded cream input group, per Figma's
`5:58` node. Accessible label preserved via `aria-label`.

### 9. Footer

Existing `.site-footer` is minimal (one line of text + 2 legal links
+ IDEAL logo). Figma's footer is richer: a dark (`--footer-bg`,
`#14151c`) rounded card with a project description paragraph,
contact email, tagline, and a two-column layout (text block left,
IDEAL logo right). Expand `.footer-inner` to match, while keeping
`#footerText`, `#privacyLink`, `#legalLink`, `#idealLogoLink`,
`#idealLogo`, `#idealLogoFallback` untouched since
`applyPublicConfig()` writes to them.

The contact email shown in Figma (`info@2031granadaideal.es`) has no
corresponding field in the public config today. Confirmed with the
user: use that same address as static text in the footer markup.

## Testing / verification

No automated test suite covers this static frontend. Verification is
manual, per section:

1. Load `http://localhost/` in the browser after each section's
   rewrite (dev stack already running via `docker compose watch`,
   which syncs `web/` changes live).
2. Compare against the Figma screenshot for that section's node.
3. Exercise the section's interactive behavior where applicable:
   nav anchors scroll correctly; hero CTAs open the modal / scroll to
   map; map filters, zoom, and marker click still work; the
   contribution form still submits; gallery "load more" still works;
   newsletter form still submits.
4. Check responsive behavior at a narrow viewport for each section,
   since the current stylesheet has mobile breakpoints
   (`web/styles.css:538`, `:1534`, `:1551`, `:1575`, `:1690`) that
   must keep working.
