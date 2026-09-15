# Header Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the shared `.topbar` header (used by `web/index.html`, `admin/admin.html`, `web/aviso-legal.html`, `web/politica-de-privacidad.html`) a full-width bar with the real Granada 2031 wordmark logo and a correctly pill-shaped CTA button, matching `Landing/header.png`.

**Architecture:** Pure CSS/asset/config changes to an existing shared component — no new components, no markup restructuring beyond adding one `id` and one static asset. The dynamic logo swap already exists (`applyLogo()` in `web/app.js`, driven by `config.json`'s `public.brand_logo`); this plan wires a real image into it and extends it to also hide the now-redundant text wordmark.

**Tech Stack:** Static HTML/CSS/vanilla JS served directly by the Bun server (`api/server.ts`) from `web/`; no build step — a browser reload picks up any saved file immediately.

## Global Constraints

- CSS changes to `.topbar`, `.nav-cta`, `.button` apply globally to all 4 pages that include the shared header (confirmed with user) — do not scope them to the landing only.
- Do not change the `max-width: 900px` mobile `.topbar` override (`web/styles.css:1697-1706`) — mobile keeps today's compact floating pill.
- Do not touch `admin/admin.html`'s content/panel styling, or any section of `web/index.html` other than the header — out of scope for this pass.
- The logo swap only needs to touch `web/index.html` + `web/app.js`; `admin/admin.html` and the legal pages have no `#brandLogo`/`#brandMark` JS wiring and keep showing the plain coral circle regardless of `config.json`.

---

### Task 1: Commit the pre-existing Windows static-file path fix

This fix was already made and manually verified working during the design/discovery session (see `docs/superpowers/specs/2026-09-15-header-redesign-design.md`'s Context section) — it's blocking local preview of every subsequent task, so it needs to land first. This task is verification + commit only, no new code.

**Files:**
- Modify (already modified, uncommitted): `api/server.ts:22,1305-1332`

**Interfaces:**
- Produces: no interface change — `confineToDir()` and `resolveStaticPath()` keep their existing signatures, only their internal path-splitting logic changes.

- [ ] **Step 1: Confirm the working tree has the expected diff**

Run: `git diff api/server.ts`

Expected: the diff shows (a) `normalize` removed from the `node:path` import on line 22, (b) `confineToDir` splitting `cleaned` directly instead of `normalize(cleaned)`, (c) the `/uploads/*` branch doing the same. If the diff is empty or different, stop and re-apply the fix described in the spec's Context section before continuing.

- [ ] **Step 2: Verify the server starts and serves static files**

Run (from repo root, in the background):
```bash
bun run api/server.ts
```
Then:
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/styles.css
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/app.js
```

Expected: all three print `200`.

- [ ] **Step 3: Run the existing automated test suite**

Run: `bun test`

Expected: all existing tests still pass (this change only touches static-file path resolution, not any API route behavior the suite covers).

- [ ] **Step 4: Commit**

```bash
git add api/server.ts
git commit -m "fix: resolve static file paths correctly on Windows

normalize() rewrites \"/\" to \"\\\\\" before the code splits on \"/\",
so on Windows the split never fires and resolve() treats the
leftover backslash-prefixed segment as drive-root-relative,
escaping WEB_DIR/UPLOAD_DIR entirely and 404ing every static file.
Split on the URL's own \"/\" first instead."
```

---

### Task 2: Full-width header bar

**Files:**
- Modify: `web/styles.css:219-238` (`.topbar`)
- Modify: `web/styles.css:304-311` (`.hero` padding)
- Modify: `web/styles.css:642-650` (`.admin-page`, `.legal-page` padding)

**Interfaces:**
- Consumes: none (CSS-only).
- Produces: `.topbar` no longer reads `--page-margin` for its own left/right inset (other components still use `--page-margin` unchanged elsewhere in the file).

- [ ] **Step 1: Capture the current rendered header for comparison**

With the dev server running (from Task 1), open `http://localhost:8080/` in a browser and note today's look: a floating white pill inset ~24px from each edge, fully rounded corners, sitting ~20px below the top of the viewport.

- [ ] **Step 2: Change `.topbar` to a full-width bar**

Replace this block in `web/styles.css`:

```css
.topbar {
  align-items: center;
  background: #ffffff;
  box-shadow: 0 6px 20px rgba(33, 28, 18, 0.08);
  border-radius: 999px;
  display: flex;
  justify-content: space-between;
  left: var(--page-margin);
  right: var(--page-margin);
  margin: 0 auto;
  max-width: 1280px;
  min-height: 64px;
  padding: 10px 10px 10px 22px;
  position: fixed;
  top: 20px;
  /* Above the map's own stacked UI (.map-controls/.map-hint at 1000) so it
     can't peek over the fixed header's edge during scroll; below the
     modal/story-panel overlays (2000), which must sit above everything. */
  z-index: 1500;
}
```

with:

```css
.topbar {
  align-items: center;
  background: #ffffff;
  box-shadow: 0 6px 20px rgba(33, 28, 18, 0.08);
  display: flex;
  justify-content: space-between;
  left: 0;
  right: 0;
  margin: 0;
  min-height: 64px;
  padding: 10px var(--page-margin);
  position: fixed;
  top: 0;
  /* Above the map's own stacked UI (.map-controls/.map-hint at 1000) so it
     can't peek over the fixed header's edge during scroll; below the
     modal/story-panel overlays (2000), which must sit above everything. */
  z-index: 1500;
}
```

(Full-width edge-to-edge bar: no side inset, no `max-width` cap, no radius — square corners. Content padding switches from the pill's asymmetric `10px 10px 10px 22px` to a symmetric `10px var(--page-margin)` so the brand/nav/CTA line up with the same 24px inset every card below already uses.)

- [ ] **Step 3: Re-check dependent top offsets**

The bar's fixed position moved from `top: 20px` + `min-height: 64px` (bottom edge ~84px from viewport top) to `top: 0` + `min-height: 64px` (bottom edge ~64px) — 20px less. Reduce the three page-level top paddings that were tuned against the old floating pill by that same 20px, so the visual gap under the header stays the same as before.

Replace in `web/styles.css`:

```css
.hero {
  align-items: center;
  background: var(--bg-light);
  display: flex;
  justify-content: center;
  min-height: 92vh;
  padding: 140px clamp(22px, 6vw, 86px) 80px;
  position: relative;
}
```

with (only the `padding` line changes):

```css
.hero {
  align-items: center;
  background: var(--bg-light);
  display: flex;
  justify-content: center;
  min-height: 92vh;
  padding: 120px clamp(22px, 6vw, 86px) 80px;
  position: relative;
}
```

Replace:

```css
.admin-page {
  padding-top: 92px;
}

.legal-page {
  margin: 0 auto;
  max-width: 900px;
  padding: 92px clamp(18px, 4vw, 56px) 64px;
}
```

with:

```css
.admin-page {
  padding-top: 72px;
}

.legal-page {
  margin: 0 auto;
  max-width: 900px;
  padding: 72px clamp(18px, 4vw, 56px) 64px;
}
```

Do **not** touch the `max-width: 900px` media query block (`web/styles.css:1697-1706` and the `.legal-page { padding-top: 138px; }` override inside it, `web/styles.css:1724`) — mobile keeps the old floating-pill header untouched, per the Global Constraints.

- [ ] **Step 4: Verify with grep that the edits landed correctly**

Run:
```bash
grep -n "left: 0;" web/styles.css | head -3
grep -n "padding: 10px var(--page-margin);" web/styles.css
grep -n "padding: 120px clamp(22px, 6vw, 86px) 80px;" web/styles.css
grep -n "padding-top: 72px;" web/styles.css
grep -n "padding: 72px clamp(18px, 4vw, 56px) 64px;" web/styles.css
```

Expected: each prints at least one matching line; none error with no output.

- [ ] **Step 5: Visual check**

Reload `http://localhost:8080/`, `http://localhost:8080/admin`, `http://localhost:8080/aviso-legal`, and `http://localhost:8080/politica-de-privacidad`. On each: the header should now span edge-to-edge with square corners, and the page content below should start at roughly the same visual distance from the header as before (no overlap, no unusually large gap).

- [ ] **Step 6: Commit**

```bash
git add web/styles.css
git commit -m "feat: make shared header a full-width bar

Removes the floating-pill inset/radius/max-width from .topbar and
rebalances the three page-level top paddings that were tuned
against its old top:20px offset, so the visual gap under the
header is unchanged on index/admin/legal pages."
```

---

### Task 3: Fix the CTA pill border-radius cascade bug

**Files:**
- Modify: `web/styles.css:292-303` (remove `.nav-cta` / `.nav-cta:hover` from their current spot)
- Modify: `web/styles.css:470-478` (re-add `.nav-cta` / `.nav-cta:hover` immediately after `.button`)

**Interfaces:**
- Consumes: none.
- Produces: none (visual-only; no selector name changes, so nothing downstream is affected).

- [ ] **Step 1: Confirm the bug is still present**

Run:
```bash
grep -n "^\.nav-cta\|^\.button " web/styles.css
```

Expected: `.nav-cta` prints at a lower line number than `.button` (e.g. `292:.nav-cta` before `470:.button`) — confirming `.button`'s later `border-radius: 8px` currently wins the cascade over `.nav-cta`'s `border-radius: 999px` for any element carrying both classes (the "Subir una foto" button does, via `class="button nav-cta"` in `web/index.html`).

- [ ] **Step 2: Remove `.nav-cta` from its current location**

Delete this block from `web/styles.css` (currently sitting between `nav a:hover` and `.hero`):

```css
.nav-cta {
  background: var(--coral);
  border-radius: 999px;
  color: var(--bg-light);
  min-height: 40px;
  padding: 0 20px;
}

.nav-cta:hover {
  filter: brightness(0.92);
}

```

(leave the surrounding `nav a:hover { ... }` and `.hero { ... }` blocks untouched — just close the gap where `.nav-cta` used to be, with a single blank line separating `nav a:hover` from `.hero`.)

- [ ] **Step 3: Re-insert `.nav-cta` immediately after `.button`**

Change:

```css
.button {
  align-items: center;
  border-radius: 8px;
  display: inline-flex;
  font-weight: 800;
  justify-content: center;
  min-height: 46px;
  padding: 0 18px;
}
```

to:

```css
.button {
  align-items: center;
  border-radius: 8px;
  display: inline-flex;
  font-weight: 800;
  justify-content: center;
  min-height: 46px;
  padding: 0 18px;
}

.nav-cta {
  background: var(--coral);
  border-radius: 999px;
  color: var(--bg-light);
  min-height: 40px;
  padding: 0 20px;
}

.nav-cta:hover {
  filter: brightness(0.92);
}
```

- [ ] **Step 4: Verify with grep that `.nav-cta` now comes after `.button`**

Run:
```bash
grep -n "^\.nav-cta\|^\.button " web/styles.css
```

Expected: `.button` now prints at a lower line number than `.nav-cta`.

- [ ] **Step 5: Visual check**

Reload `http://localhost:8080/`. The "Subir una foto" button in the header should now render as a full pill (fully rounded left/right ends), not a slightly-rounded rectangle. Check the mobile breakpoint too (narrow the browser below 900px) — the button keeps the same pill shape there.

- [ ] **Step 6: Commit**

```bash
git add web/styles.css
git commit -m "fix: stop .button's 8px radius from overriding .nav-cta's pill shape

Same-specificity rules cascade by source order; .nav-cta's
border-radius: 999px was declared before .button's border-radius:
8px, so .button always won on any element (like the header CTA)
carrying both classes. Moving .nav-cta after .button restores the
intended pill shape."
```

---

### Task 4: Wire in the real logo

**Files:**
- Create: `web/assets/logo.png` (copy of `Landing/Granada2031Logo.png`)
- Modify: `config.json` (`public.brand_logo`)
- Modify: `web/index.html:15-22` (add `id="brandText"`)
- Modify: `web/app.js:141-156,178` (`applyLogo()` + its brand call site)

**Interfaces:**
- Consumes: `WEB_DIRS` in `api/server.ts:1303` already serves anything under `/assets/` from `web/assets/` — no server change needed.
- Produces: `applyLogo(imageSelector, fallbackSelector, src, alt, extraHideSelector?)` — the 5th parameter is new and optional; the existing call for `#idealLogo`/`#idealLogoFallback` (`web/app.js:179`) keeps working unchanged since it simply omits it.

- [ ] **Step 1: Copy the logo asset into the served assets folder**

```bash
mkdir -p web/assets
cp "Landing/Granada2031Logo.png" web/assets/logo.png
```

- [ ] **Step 2: Verify the asset is reachable through the server**

Run:
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/assets/logo.png
```

Expected: `200`. (If `404`, restart the dev server — Task 1 confirmed static serving works, but the process needs to be running.)

- [ ] **Step 3: Point `config.json` at the new logo**

In `config.json`, change:

```json
    "brand_logo": "",
```

to:

```json
    "brand_logo": "/assets/logo.png",
```

(`brand_logo_alt` is already `"Granada 2031"` — no change needed there.)

- [ ] **Step 4: Verify the config change is served**

Run:
```bash
curl -s http://localhost:8080/api/config | grep -o '"brand_logo":"[^"]*"'
```

Expected: `"brand_logo":"/assets/logo.png"`.

- [ ] **Step 5: Give the brand text wrapper an id to target**

In `web/index.html`, change:

```html
        <span>
          <strong id="brandName">Granada 2031</strong>
          <small id="brandSubtitle">Geolocalizacion del Sentimiento</small>
        </span>
```

to:

```html
        <span id="brandText">
          <strong id="brandName">Granada 2031</strong>
          <small id="brandSubtitle">Geolocalizacion del Sentimiento</small>
        </span>
```

- [ ] **Step 6: Extend `applyLogo()` to also hide/show an extra element**

In `web/app.js`, change:

```javascript
function applyLogo(imageSelector, fallbackSelector, src, alt) {
  const image = document.querySelector(imageSelector);
  const fallback = document.querySelector(fallbackSelector);
  if (!image) return;

  if (src) {
    image.src = src;
    image.alt = alt || "";
    image.classList.remove("hidden");
    if (fallback) fallback.classList.add("hidden");
    return;
  }

  image.removeAttribute("src");
  image.classList.add("hidden");
  if (fallback) fallback.classList.remove("hidden");
}
```

to:

```javascript
function applyLogo(imageSelector, fallbackSelector, src, alt, extraHideSelector) {
  const image = document.querySelector(imageSelector);
  const fallback = document.querySelector(fallbackSelector);
  const extra = extraHideSelector ? document.querySelector(extraHideSelector) : null;
  if (!image) return;

  if (src) {
    image.src = src;
    image.alt = alt || "";
    image.classList.remove("hidden");
    if (fallback) fallback.classList.add("hidden");
    if (extra) extra.classList.add("hidden");
    return;
  }

  image.removeAttribute("src");
  image.classList.add("hidden");
  if (fallback) fallback.classList.remove("hidden");
  if (extra) extra.classList.remove("hidden");
}
```

- [ ] **Step 7: Pass the new selector at the brand logo call site**

In `web/app.js`, change:

```javascript
  applyLogo("#brandLogo", "#brandMark", config.brand_logo, config.brand_logo_alt);
```

to:

```javascript
  applyLogo("#brandLogo", "#brandMark", config.brand_logo, config.brand_logo_alt, "#brandText");
```

Leave the very next line (`applyLogo("#idealLogo", "#idealLogoFallback", ...)`, no 5th argument) untouched — the footer's IDEAL logo has no adjacent text to hide.

- [ ] **Step 8: Verify with grep that all edits landed**

Run:
```bash
grep -n 'id="brandText"' web/index.html
grep -n "extraHideSelector" web/app.js
grep -n '"#brandText"' web/app.js
```

Expected: each prints exactly one matching line.

- [ ] **Step 9: Visual check**

Reload `http://localhost:8080/`. The header should now show only the "GRANADA 2031" wordmark image (no adjacent "Granada 2031 / Geolocalización del Sentimiento" text, no coral circle). Confirm `console --errors`-equivalent (browser devtools console) shows no image-load error for `/assets/logo.png`.

- [ ] **Step 10: Commit**

```bash
git add web/assets/logo.png config.json web/index.html web/app.js
git commit -m "feat: wire in the real Granada 2031 wordmark logo

Points config.json's brand_logo at the new web/assets/logo.png and
teaches applyLogo() to optionally hide a sibling element, used here
to hide the adjacent brand text now that the logo image already
contains the full wordmark."
```

---

### Task 5: Final full-page visual pass

**Files:** none (verification only).

- [ ] **Step 1: Run the full automated suite one more time**

Run: `bun test`

Expected: passes (no task in this plan touched any API route or test file).

- [ ] **Step 2: Compare against the reference image side by side**

Reload `http://localhost:8080/` and compare the header against `Landing/header.png`: full-width white bar, wordmark logo on the left, nav links, and a fully pill-shaped "Subir una foto" button on the right.

- [ ] **Step 3: Spot-check the other three pages and the mobile breakpoint**

Reload `http://localhost:8080/admin`, `/aviso-legal`, `/politica-de-privacidad` (full-width bar, plain coral circle — no logo image, as expected) and narrow the browser below 900px on the landing (compact floating pill, unchanged from before this plan).
