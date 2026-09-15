# Header redesign

## Context

The landing page (`web/index.html`) went through a full visual redesign
(see [[2026-08-11-figma-landing-redesign-design]]) that established a
"floating card" page architecture: a 24px cream page margin, every
section as its own rounded card, and the nav (`.topbar`) as a floating
white pill inset from the viewport edges, capped at `max-width: 1280px`.

A new reference image (`Landing/header.png`) shows a different target
for the header specifically: a full-width white bar (no side inset, no
corner radius), the wordmark logo `Landing/Granada2031Logo.png`
("GRANADA 2031", styled coral wordmark, 246×29px) in place of the
current coral circle + "Granada 2031 / Geolocalización del
Sentimiento" text pairing, and the "Subir una foto" CTA rendered as a
full pill (fully rounded ends).

While comparing the reference against the live code, two things came
up that belong in this pass:

1. **CTA pill bug**: `.nav-cta` (`web/styles.css:292`) already sets
   `border-radius: 999px`, but the generic `.button` rule
   (`web/styles.css:470`, applied to the same element) sets
   `border-radius: 8px` and wins the cascade because it's declared
   later with equal specificity. The button currently renders with an
   8px radius instead of a pill.
2. **Windows static-file 404 bug** (unrelated to the header visually,
   found while trying to preview locally): `api/server.ts`'s
   `confineToDir` and the `/uploads/*` path resolver called
   `normalize()` (from `node:path`) on a URL path before splitting on
   `"/"`. On Windows, `normalize()` rewrites `/` to `\` first, so the
   subsequent `.split("/")` never splits, and `resolve()` treats the
   single `\`-prefixed segment as drive-root-relative — escaping
   `WEB_DIR`/`UPLOAD_DIR` entirely and 404ing every static file. This
   was already fixed and verified (`api/server.ts:1305-1332`, commit
   pending) so local preview works; it's noted here only for the
   record, since it surfaced during this task.

## Goal

Make `.topbar` (`web/index.html`'s header) match `Landing/header.png`:
full width, the real logo image, and a correctly pill-shaped CTA
button — without touching any other section of the page.

## Non-goals

- No change to the floating-card treatment of any other section
  (hero, ticker, map, gallery, footer, etc.) — only the header.
- No change to the mobile (`max-width: 900px`) header layout. It stays
  the existing compact floating pill (inset margins, 24px radius,
  stacked nav) — the reference image is a desktop capture, and the
  mobile layout already solves the "many nav items in a small width"
  problem differently. Revisit only if asked.
- No redesign of the nav *links* themselves (Mapa / Participa /
  Archivo) — same text, order, and typography as today.

## Approach

### 1. Full-width bar

Change `.topbar` (`web/styles.css:219`) from a floating inset pill to
an edge-to-edge bar:

- Remove `left`/`right: var(--page-margin)` insets and `max-width:
  1280px` → span the full viewport width.
- Remove `border-radius: 999px` → square corners (`0`).
- Keep `position: fixed`, the white background, box-shadow, and
  `z-index`, and keep the inner content (brand + nav + CTA) padded and
  centered the same way it is today, so nothing inside the bar shifts
  besides the bar's own edges.
- `page-stack`/hero's top padding (currently tuned for a `top: 20px`
  floating pill of ~64px height) gets rechecked against the new
  full-width bar's actual height so content doesn't sit under/over it.

### 2. Logo

The site already supports a custom logo via `config.json`'s
`public.brand_logo` (wired in `web/app.js`'s `applyLogo()`): when set,
it shows `#brandLogo` and hides the fallback `#brandMark` circle.

- Copy `Landing/Granada2031Logo.png` into `web/assets/logo.png` (an
  already-public static path per `WEB_DIRS` in `api/server.ts`).
- Set `config.json`'s `public.brand_logo` to `/assets/logo.png` (and
  `brand_logo_alt` to `"Granada 2031"`).
- Since the logo image already contains the full "GRANADA 2031"
  wordmark, hide the adjacent `<strong>`/`<small>` text
  (`#brandName`/`#brandSubtitle`) whenever a logo image is active, to
  avoid showing the name twice. This means a small change to
  `applyLogo()` in `web/app.js` (or a sibling CSS rule keyed off the
  image no longer having the `hidden` class) so the text wrapper span
  gets `hidden` alongside `#brandMark`.

### 3. CTA pill fix

Fix the cascade bug directly: give `.nav-cta`'s `border-radius: 999px`
enough precedence to survive `.button`'s `8px`, by moving the
`.nav-cta` rule after `.button` in source order (matching the existing
convention elsewhere in the file of "more specific override comes
later") rather than reaching for `!important`. No markup change.

## Testing

Manual visual check only (no automated visual regression suite
exists): reload `http://localhost:8080` after each change and compare
against `Landing/header.png` at desktop width, then check the existing
`max-width: 900px` breakpoint is untouched. No API/behavior changes,
so no new automated tests are needed; existing `bun test` suite should
still pass unmodified.
