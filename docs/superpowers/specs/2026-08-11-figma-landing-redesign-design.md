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

## Section-by-section design

### 1. Nav

Currently a fixed, blurred dark-glass topbar (`.topbar`) with a single
"Mapa" link. Figma shows a plain light nav on `--bg-light` with a
thin bottom border, three links (Mapa / Participa / Archivo), and a
pill CTA "Subir una foto".

- Restyle `.topbar` to the light palette (background `--bg-light` at
  high opacity, `--line-light` border).
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

New, purely decorative section — doesn't exist today. An infinite
horizontal marquee of repeating text ("GRANADA 2031 · CANDIDATURA
CULTURAL · ... · TESTIMONIOS GLOBALES ·"), implemented with a CSS
`@keyframes` translateX loop over a duplicated content list for a
seamless wrap. Marked `aria-hidden="true"` since it carries no
information not available elsewhere on the page. Animation is paused
under `prefers-reduced-motion: reduce`.

### 4. Pasos (how it works)

Existing `.how-to-contribute` section with 3 real `.step-card`s stays
structurally the same. Visual changes only:

- `.eyebrow` becomes a pill/chip (background + border + rounded),
  replacing today's plain colored text — this chip styling is shared
  by every section eyebrow (Pasos, Mapa vivo, Galería, Cita), so it's
  a single CSS change reused everywhere.
- Each step card gets a large outlined numeral (01/02/03) behind the
  title, per Figma's `73:150`/`73:152`/`73:154` nodes.

### 5. Mapa vivo

No functional change — same Leaflet map, same filter chips, same
zoom controls, same IDs. Only the containing panel and heading get
restyled (chip eyebrow, left-aligned heading, corner radius/spacing)
to sit visually consistent with the rest of the page.

### 6. Cita + stats overlay

Keep `.dark-pullquote-banner` (chip "LA COMUNIDAD" + centered quote)
as-is functionally. Add the white stats card that overlaps the top of
this section in Figma (node `74:2`), using a negative margin-top to
create the overlap. Populated with real data:

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

Existing `#newsletterForm` stays functionally identical. The submit
button changes from a text pill ("Avisadme") to a small circular
arrow ("→") button sitting inside the rounded input group, per
Figma's `5:58` node. Accessible label preserved via `aria-label`.

### 9. Footer

Existing `.site-footer` is minimal (one line of text + 2 legal links
+ IDEAL logo). Figma's footer is richer: project description
paragraph, contact email, tagline, and a two-column layout. Expand
`.footer-inner` to match, while keeping `#footerText`,
`#privacyLink`, `#legalLink`, `#idealLogoLink`, `#idealLogo`,
`#idealLogoFallback` untouched since `applyPublicConfig()` writes to
them.

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
