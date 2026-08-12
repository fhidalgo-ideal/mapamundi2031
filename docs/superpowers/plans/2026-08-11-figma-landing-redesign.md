# Figma Landing Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild all 9 sections of `web/index.html` (Nav, Hero, Ticker, Pasos, Mapa vivo, Cita + stats overlay, Galería, Newsletter, Footer) to match the Figma "Granada es de to' el mundo — Landing" design, without regressing any dynamic behavior in `web/app.js`.

**Architecture:** Section-by-section rewrite of `web/index.html` + `web/styles.css`, with matching `web/app.js` updates wherever a section's IDs change. A new page-frame/card-stack wrapper (Task 0) establishes the structural pattern every later section builds on. Each task is verified visually against the running dev stack before moving to the next.

**Tech Stack:** Static HTML/CSS/vanilla JS, no build step, no automated test suite for the frontend. Verification is manual (dev stack + browser), per the spec's Testing/verification section.

## Global Constraints

- Preserve every existing element ID that `web/app.js` queries by selector, unless a task explicitly renames it and updates `app.js` in the same step (never leave a dangling selector).
- No backend/API changes.
- No pixel-perfect cloning of Figma's placeholder content (city names, testimonial quotes, stat numbers) — those stay wired to real API data; Figma is the layout/style reference only.
- Dark-panel tokens `--bg-dark`, `--surface`, `--surface-2`, `--ink-on-dark`, `--line`, `--muted` stay untouched (used by map controls / story panel / modal chrome, unrelated to this redesign).
- New CSS custom properties introduced by this plan (all added in Task 0): `--ticker-bg` (`#1c1914`), `--map-panel-bg` (`#12181f`), `--accent-bright` (`#f2954a`), `--stats-overlay-bg` (`#221d15`), `--footer-bg` (`#14151c`), `--page-margin` (`24px`), `--card-radius` (`24px`), `--card-gap` (`16px`).
- After each task, load `http://localhost/` (dev stack via `docker compose watch`) and compare against the Figma screenshot for that section before starting the next task.

---

## Task 0: Page-frame foundation (tokens + card-stack wrapper)

**Files:**
- Modify: `web/styles.css:1-44` (tokens), `web/styles.css:77-81` (insert new architecture rules after the `a { }` rule)
- Modify: `web/index.html:10-255` (wrap body content in the page-frame/card-stack structure)

**Interfaces:**
- Produces: CSS custom properties listed in Global Constraints above; CSS classes `.page-frame`, `.page-stack`, `.map-cita-wrap`, `.card` (all later tasks apply `.card` to their section and rely on `.page-frame`'s cream background showing through the 16px gaps).

- [ ] **Step 1: Replace `:root` with the full corrected token set**

A prior session's Figma-hero color/type token pass (`--bg-light`, `--ink-on-light`,
`--muted-on-light`, `--line-light`, `--coral`, `--blue`, `--gradient-wordmark`, and
the `--fs-*`/`--fw-*`/`--lh-*`/`--ls-*` type-scale tokens) was made only as an
uncommitted edit in the original checkout and was never committed — this worktree
branched from committed history, so it does not have them. Every later task in this
plan (Hero, Pasos, Cita, Newsletter, Footer) references these tokens by name as if
they already exist, so this step restores them alongside the new page-frame tokens.

Replace the entire `:root` block at the top of `web/styles.css` with:

```css
:root {
  color-scheme: light;
  --bg: #0b1020;
  --bg-light: #faf6ee;
  --bg-dark: #0b1020;
  --surface: #121a2b;
  --surface-2: #172136;
  --ink: #f6f1e8;
  --ink-on-light: #211c13;
  --ink-on-dark: #f6f1e8;
  --muted: #aeb8c7;
  --muted-on-light: rgba(33, 28, 19, 0.62);
  --line: rgba(255, 255, 255, 0.14);
  --line-light: rgba(33, 28, 19, 0.12);
  --gold: #f7c667;
  --coral: #c1622d;
  --blue: #5c78b4;
  --sage: #7c8a5a;
  --aqua: #67d7c4;
  --green: #9ccf6b;
  --violet: #b896ff;
  --danger: #e45252;
  --gradient-wordmark: linear-gradient(90deg, var(--blue), var(--coral));
  --ticker-bg: #1c1914;
  --map-panel-bg: #12181f;
  --accent-bright: #f2954a;
  --stats-overlay-bg: #221d15;
  --footer-bg: #14151c;
  --page-margin: 24px;
  --card-radius: 24px;
  --card-gap: 16px;

  --font-family-base: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --fw-regular: 400;
  --fw-semibold: 600;
  --fw-bold: 700;
  --fw-extrabold: 800;
  --fs-display: 168px;
  --fs-h1: 96px;
  --fs-body-lg: 18px;
  --fs-button: 15px;
  --fs-stat: 28px;
  --fs-label: 12px;
  --fs-caption: 11px;
  --lh-tight: 0.95;
  --lh-none: 1;
  --lh-normal: 1.4;
  --ls-wide: 5.04px;
  --ls-tight: -0.96px;

  font-family: var(--font-family-base);
}
```

Note this also changes some existing values the worktree currently has (e.g.
`--coral` from `#f26d5b` to `#c1622d`, `--bg-light` from `#f7f4ee` to `#faf6ee`,
`--ink-on-light` from `#1a1a1a` to `#211c13`) — these are the corrected Figma-derived
values, not a regression; every existing rule that references these tokens via
`var(...)` picks up the new values automatically.

- [ ] **Step 2: Add page-frame/card-stack CSS rules**

In `web/styles.css`, insert immediately after the existing `a { color: inherit; text-decoration: none; }` rule (currently lines 77-80), before `.topbar`:

```css
.page-frame {
  background: var(--bg-light);
  display: flex;
  flex-direction: column;
  gap: var(--card-gap);
  padding: var(--page-margin);
}

.page-stack {
  display: flex;
  flex-direction: column;
  gap: var(--card-gap);
}

.map-cita-wrap {
  display: flex;
  flex-direction: column;
  gap: var(--card-gap);
}

.card {
  border-radius: var(--card-radius);
}
```

- [ ] **Step 3: Restructure `web/index.html`**

Replace the block from `<header class="topbar">` through the closing `</footer>` (current lines 11-255) with:

```html
    <header class="topbar">
      <a class="brand" id="brandLink" href="#mapa" aria-label="Granada 2031">
        <span class="brand-mark" id="brandMark"></span>
        <img class="brand-logo hidden" id="brandLogo" alt="">
        <span>
          <strong id="brandName">Granada 2031</strong>
          <small id="brandSubtitle">Geolocalizacion del Sentimiento</small>
        </span>
      </a>
      <div class="topbar-nav">
        <nav aria-label="Navegacion principal">
          <a href="#mapa">Mapa</a>
        </nav>
        <button class="button nav-cta" type="button" data-open-contribute>Subir foto</button>
      </div>
    </header>

    <div class="page-frame">
      <main class="page-stack">
        <section class="hero card" id="mapa" aria-labelledby="hero-title">
          <div class="hero-inner">
            <figure class="polaroid polaroid-left" id="heroPolaroidLeft">
              <img alt="">
              <figcaption></figcaption>
            </figure>
            <div class="hero-copy">
              <h1 id="hero-title">
                <span class="hero-line-1">GRANADA</span>
                <span class="hero-line-2">es de to' el mundo</span>
              </h1>
              <p id="heroText">
                Cada foto compartida abre una luz: un recuerdo, una huella o una emocion
                que conecta a Granada con otra ciudad del planeta.
              </p>
              <div class="hero-actions">
                <button class="button primary" id="heroSubmit" type="button" data-open-contribute>Subir mi foto</button>
                <button class="button ghost" id="heroViewMap" type="button">Ver el mapa en vivo</button>
              </div>
              <dl class="hero-stats" id="heroStats" aria-label="Estadisticas de participacion">
                <div class="stat">
                  <dt id="statPhotos">0</dt>
                  <dd>fotos subidas</dd>
                </div>
                <div class="stat">
                  <dt id="statCountries">0</dt>
                  <dd>paises</dd>
                </div>
                <div class="stat">
                  <dt id="statCities">0</dt>
                  <dd>ciudades</dd>
                </div>
              </dl>
            </div>
            <figure class="polaroid polaroid-right" id="heroPolaroidRight">
              <img alt="">
              <figcaption></figcaption>
            </figure>
          </div>
        </section>

        <section class="how-to-contribute card" aria-labelledby="how-to-title">
          <div class="section-heading">
            <p class="eyebrow">COMO PARTICIPAR</p>
            <h2 id="how-to-title">Asi se sube una foto</h2>
          </div>

          <div class="step-cards">
            <article class="step-card">
              <div class="step-number">01</div>
              <h3>Comparte tu foto</h3>
              <p>Sube una fotografia y cuentanos que te conecta con Granada.</p>
            </article>

            <article class="step-card">
              <div class="step-number">02</div>
              <h3>Elige como participar</h3>
              <p>Busca tu ciudad en el mapa y elige la emocion que mejor describe tu recuerdo.</p>
            </article>

            <article class="step-card">
              <div class="step-number">03</div>
              <h3>Aparece en el mapa</h3>
              <p>Tras la revision, tu luz se enciende en el mapa vivo para todo el mundo.</p>
            </article>
          </div>
        </section>

        <div class="map-cita-wrap">
          <section class="map-section card" aria-label="Mapa de luces">
            <div class="section-heading">
              <p class="eyebrow" id="mapTitle">Mapa vivo</p>
              <h2 id="mapSectionTitle">Granada encendida en el mundo</h2>
            </div>

            <div class="map-shell">
              <div class="map-toolbar">
                <p><span id="approvedCount">0</span> luces aprobadas en <span id="countryCount">0</span> paises</p>
                <div class="filters" role="group" aria-label="Filtros de emocion">
                  <button class="chip active" type="button" data-filter="all">Todas</button>
                  <button class="chip" type="button" data-filter="nostalgia">Nostalgia</button>
                  <button class="chip" type="button" data-filter="pertenencia">Pertenencia</button>
                  <button class="chip" type="button" data-filter="asombro">Asombro</button>
                  <button class="chip" type="button" data-filter="futuro">Futuro</button>
                </div>
              </div>

              <div class="map-canvas-wrap">
                <div class="map-controls" aria-label="Controles del mapa">
                  <button class="icon-button map-control" id="zoomIn" type="button" aria-label="Acercar">+</button>
                  <button class="icon-button map-control" id="zoomOut" type="button" aria-label="Alejar">-</button>
                  <button class="icon-button map-control reset" id="zoomReset" type="button" aria-label="Restablecer zoom">1:1</button>
                </div>
                <div id="worldMap" role="application" aria-label="Mapamundi interactivo"></div>
                <div class="map-hint" id="mapHint">Rueda para acercar, arrastra para moverte y haz clic en una luz.</div>
              </div>
            </div>
          </section>

          <section class="dark-pullquote-banner card" aria-label="Cita inspiradora sobre Granada">
            <p class="pullquote-text">Cada foto es un vínculo con Granada, esté donde esté quien la comparte.</p>
          </section>
        </div>

        <section class="archive-section card" id="archivo" aria-labelledby="archive-title">
          <div class="section-heading">
            <p class="eyebrow" id="archiveEyebrow">GALERIA</p>
            <h2 id="archive-title">Todas las fotos, una a una</h2>
          </div>
          <div class="archive-grid" id="archiveGrid"></div>
          <div class="archive-actions">
            <button class="button outline" id="archiveLoadMore" type="button">Cargar mas fotos</button>
          </div>
        </section>
      </main>

      <section class="newsletter-banner card" aria-labelledby="newsletter-title">
        <div class="newsletter-inner">
          <h2 class="newsletter-title" id="newsletter-title">Enterate cuando tu foto se publique en el mapa</h2>
          <form class="newsletter-form" id="newsletterForm" novalidate>
            <div class="newsletter-control">
              <input class="newsletter-input" id="newsletterEmail" name="email" type="email"
                required autocomplete="email" placeholder="tu@correo.com" aria-label="Tu correo electronico">
              <button class="newsletter-submit" type="submit">Avisadme</button>
            </div>
            <p class="newsletter-status" id="newsletterStatus" role="status" aria-live="polite"></p>
          </form>
        </div>
      </section>

      <footer class="site-footer card">
        <div class="footer-inner">
          <p id="footerText">Granada 2031. Geolocalizacion del Sentimiento.</p>
          <nav class="footer-links" aria-label="Enlaces legales">
            <a id="privacyLink" href="/politica-de-privacidad">Politica de privacidad</a>
            <a id="legalLink" href="/aviso-legal">Aviso legal</a>
          </nav>
          <a class="footer-logo-link" id="idealLogoLink" href="https://www.ideal.es" aria-label="IDEAL">
            <img class="footer-logo hidden" id="idealLogo" alt="IDEAL">
            <span class="footer-logo-fallback" id="idealLogoFallback">IDEAL</span>
          </a>
        </div>
      </footer>
    </div>

    <div class="modal-overlay hidden" id="participa" aria-hidden="true">
      <div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="submit-title">
        <button class="icon-button modal-close" id="closeContribute" type="button" aria-label="Cerrar formulario">×</button>
      <div class="section-heading">
        <p class="eyebrow" id="submitEyebrow">Nueva contribucion</p>
        <h2 id="submit-title">Sube tu rastro de Granada</h2>
      </div>
      <form id="traceForm" class="trace-form">
        <label>
          Nombre
          <input name="name" autocomplete="name" required placeholder="Nombre y apellidos">
        </label>
        <label>
          Email de contacto
          <input name="email" type="email" autocomplete="email" required placeholder="nombre@email.com">
        </label>
        <div class="location-picker wide">
          <label>
            Tu ciudad
            <input id="citySearchInput" type="text" autocomplete="off" placeholder="Escribe tu ciudad y elige un resultado">
          </label>
          <ul class="location-picker-results" id="citySearchResults" hidden></ul>
          <div class="location-picker-map" id="locationMap" hidden></div>
          <p class="location-picker-summary" id="locationSummary" hidden></p>
          <p class="location-picker-message" id="locationMessage" role="alert" hidden></p>
          <input type="hidden" name="city" id="traceCityHidden">
          <input type="hidden" name="country" id="traceCountryHidden">
          <input type="hidden" name="lat" id="traceLatHidden">
          <input type="hidden" name="lng" id="traceLngHidden">
        </div>
        <label>
          Vinculo con Granada
          <select name="relation" required>
            <option value="">Selecciona una opcion</option>
            <option>Erasmus en Granada</option>
            <option>Nacido/a en Granada</option>
            <option>Visitante</option>
            <option>Familia o comunidad granadina</option>
            <option>Artista o investigador/a</option>
            <option>Otro vinculo cultural</option>
          </select>
        </label>
        <label>
          Emocion principal
          <select name="emotion" required>
            <option value="">Selecciona una emocion</option>
            <option value="nostalgia">Nostalgia</option>
            <option value="pertenencia">Pertenencia</option>
            <option value="asombro">Asombro</option>
            <option value="futuro">Futuro</option>
          </select>
        </label>
        <label class="wide">
          Describe el sentimiento
          <textarea name="feeling" required maxlength="360" placeholder="Cuenta que conecta esta foto con Granada"></textarea>
        </label>
        <div class="file-drop wide" id="fileDrop">
          <div class="file-drop-zone" id="fileDropZone">
            <input id="photoInput" name="photo" class="file-drop-input" type="file" accept="image/*" multiple required>
            <svg class="file-drop-icon" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
              <path d="M12 15V4m0 0-4 4m4-4 4 4" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span class="file-drop-label">Arrastra tus fotografias aqui o haz clic para elegir</span>
            <small>JPG, PNG o WEBP. Hasta 5 fotografias.</small>
          </div>
          <div class="file-drop-previews" id="filePreviews" hidden></div>
          <p class="file-drop-message" id="fileDropMessage" role="alert" hidden></p>
        </div>
        <label class="consent wide">
          <input name="consent" type="checkbox" required>
          <span id="consentText">Acepto que esta fotografia y el texto se usen en la accion cultural Granada 2031.</span>
        </label>
        <label class="hp-field wide" aria-hidden="true">
          Sitio web
          <input name="website" type="text" tabindex="-1" autocomplete="off">
        </label>
        <div class="form-actions wide">
          <button class="button primary" type="submit">Enviar a revision</button>
          <p id="formStatus" role="status"></p>
        </div>
      </form>
      </div>
    </div>
```

Everything after this block (the `story-panel` article, `archiveCardTemplate`, and the closing `</main>` that no longer exists — the two `<script>` tags and `</body></html>`) stays exactly as it was; only the region above is replaced. Since `<main>` and `</main>` moved, double-check there is no leftover stray `</main>` tag after this block in the file.

- [ ] **Step 4: Manual verification**

Run `docker compose watch` (restart Docker Desktop first if needed: `Start-Process "C:\Users\efaguilera\AppData\Local\Programs\DockerDesktop\Docker Desktop.exe"`, wait for the daemon, then `docker compose watch`). Load `http://localhost/` and confirm:
- A 24px cream margin surrounds the whole page, with a visible 16px gap between the hero/pasos/map/cita/archive/newsletter/footer blocks.
- Map, contribution modal, gallery, and newsletter still work exactly as before (this task changes structure only, not behavior).
- No console errors from missing `#` selectors.

- [ ] **Step 5: Commit**

```bash
git add web/index.html web/styles.css
git commit -m "feat: add page-frame and card-stack layout foundation"
```

---

## Task 1: Nav — floating pill

**Files:**
- Modify: `web/index.html` (topbar nav links + CTA label, add `id="como-participar"` to the Pasos section)
- Modify: `web/styles.css:82-99` (`.topbar`), `web/styles.css:1481-1502` (mobile `.topbar` override inside the `@media (max-width: 900px)` block)

**Interfaces:**
- Consumes: `.card`/page-frame tokens from Task 0 (`--page-margin`).
- Produces: nav anchor targets `#como-participar` and `#archivo` (the latter already exists on the archive section).

- [ ] **Step 1: Add nav links, relabel CTA, add anchor target**

In `web/index.html`, replace:

```html
        <nav aria-label="Navegacion principal">
          <a href="#mapa">Mapa</a>
        </nav>
        <button class="button nav-cta" type="button" data-open-contribute>Subir foto</button>
```

with:

```html
        <nav aria-label="Navegacion principal">
          <a href="#mapa">Mapa</a>
          <a href="#como-participar">Participa</a>
          <a href="#archivo">Archivo</a>
        </nav>
        <button class="button nav-cta" type="button" data-open-contribute>Subir una foto</button>
```

And add the anchor target to the Pasos section by replacing:

```html
        <section class="how-to-contribute card" aria-labelledby="how-to-title">
```

with:

```html
        <section class="how-to-contribute card" id="como-participar" aria-labelledby="how-to-title">
```

- [ ] **Step 2: Restyle `.topbar` as a floating white pill**

Replace the `.topbar` rule (`web/styles.css:82-99`):

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

- [ ] **Step 3: Adjust mobile topbar override**

In the `@media (max-width: 900px)` block, replace:

```css
  .topbar {
    align-items: flex-start;
    flex-direction: column;
    gap: 12px;
    position: fixed;
  }
```

with:

```css
  .topbar {
    align-items: flex-start;
    border-radius: 24px;
    flex-direction: column;
    gap: 12px;
    left: 12px;
    right: 12px;
    top: 12px;
    position: fixed;
  }
```

- [ ] **Step 4: Manual verification**

Load `http://localhost/`. Confirm the nav renders as an inset white pill with a soft shadow, all three links scroll to their sections (`#mapa`, `#como-participar`, `#archivo`), and the CTA button reads "Subir una foto" and still opens the contribution modal. Check the pill collapses sensibly at a narrow viewport (<900px).

- [ ] **Step 5: Commit**

```bash
git add web/index.html web/styles.css
git commit -m "feat: restyle nav as floating pill with full link set"
```

---

## Task 2: Hero — centered layout with floating photo cards

**Files:**
- Modify: `web/index.html` (hero section: add decorative cards, update stat labels)
- Modify: `web/styles.css:165-272` (`.hero`, `.hero-inner`, `.polaroid*`, `.hero-copy`), `web/styles.css:543-548` (768px polaroid-hide rule), `web/styles.css:1594-1642` (late `.hero-actions`/`.hero-stats` overrides)

**Interfaces:**
- Consumes: `--gradient-wordmark` (already defined), `#heroPolaroidLeft`/`#heroPolaroidRight` (populated by `renderHeroPolaroids()` in `app.js` — IDs must not change).
- Produces: `.hero-wordmark`, `.hero-decor` classes (purely decorative, no JS binding).

- [ ] **Step 1: Add decorative twin cards and update stat labels**

In `web/index.html`, replace the hero section's inner markup:

```html
        <section class="hero card" id="mapa" aria-labelledby="hero-title">
          <div class="hero-inner">
            <figure class="polaroid polaroid-left" id="heroPolaroidLeft">
              <img alt="">
              <figcaption></figcaption>
            </figure>
            <div class="hero-copy">
              <h1 id="hero-title">
                <span class="hero-line-1">GRANADA</span>
                <span class="hero-line-2">es de to' el mundo</span>
              </h1>
              <p id="heroText">
                Cada foto compartida abre una luz: un recuerdo, una huella o una emocion
                que conecta a Granada con otra ciudad del planeta.
              </p>
              <div class="hero-actions">
                <button class="button primary" id="heroSubmit" type="button" data-open-contribute>Subir mi foto</button>
                <button class="button ghost" id="heroViewMap" type="button">Ver el mapa en vivo</button>
              </div>
              <dl class="hero-stats" id="heroStats" aria-label="Estadisticas de participacion">
                <div class="stat">
                  <dt id="statPhotos">0</dt>
                  <dd>fotos subidas</dd>
                </div>
                <div class="stat">
                  <dt id="statCountries">0</dt>
                  <dd>paises</dd>
                </div>
                <div class="stat">
                  <dt id="statCities">0</dt>
                  <dd>ciudades</dd>
                </div>
              </dl>
            </div>
            <figure class="polaroid polaroid-right" id="heroPolaroidRight">
              <img alt="">
              <figcaption></figcaption>
            </figure>
          </div>
        </section>
```

with:

```html
        <section class="hero card" id="mapa" aria-labelledby="hero-title">
          <div class="hero-inner">
            <div class="hero-decor hero-decor-left" aria-hidden="true"></div>
            <figure class="polaroid polaroid-left" id="heroPolaroidLeft">
              <img alt="">
              <figcaption></figcaption>
            </figure>
            <div class="hero-copy">
              <h1 id="hero-title">
                <span class="hero-line-1 hero-wordmark">GRANADA</span>
                <span class="hero-line-2">es de to' el mundo</span>
              </h1>
              <p id="heroText">
                Cada foto compartida abre una luz: un recuerdo, una huella o una emocion
                que conecta a Granada con otra ciudad del planeta.
              </p>
              <div class="hero-actions">
                <button class="button primary" id="heroSubmit" type="button" data-open-contribute>Subir mi foto</button>
                <button class="button ghost" id="heroViewMap" type="button">Ver el mapa en vivo</button>
              </div>
              <dl class="hero-stats" id="heroStats" aria-label="Estadisticas de participacion">
                <div class="stat">
                  <dt id="statPhotos">0</dt>
                  <dd>Total de participaciones</dd>
                </div>
                <div class="stat">
                  <dt id="statCountries">0</dt>
                  <dd>Países activos</dd>
                </div>
                <div class="stat">
                  <dt id="statCities">0</dt>
                  <dd>Ciudades conectadas</dd>
                </div>
              </dl>
            </div>
            <figure class="polaroid polaroid-right" id="heroPolaroidRight">
              <img alt="">
              <figcaption></figcaption>
            </figure>
            <div class="hero-decor hero-decor-right" aria-hidden="true"></div>
          </div>
        </section>
```

- [ ] **Step 2: Rewrite hero layout CSS**

Replace `.hero`, `.hero-inner`, `.polaroid`, `.polaroid-left`, `.polaroid-right`, `.hero-copy` (`web/styles.css:165-230`):

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

.hero-inner {
  align-items: center;
  display: flex;
  flex-direction: column;
  gap: 28px;
  margin: 0 auto;
  max-width: 720px;
  min-width: 0;
  position: relative;
  width: 100%;
}

.hero-wordmark {
  background: var(--gradient-wordmark);
  background-clip: text;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  color: transparent;
}

.hero-decor {
  background: var(--surface-2);
  border: 1px solid var(--line-light);
  border-radius: 4px;
  box-shadow: 0 18px 40px rgba(26, 26, 26, 0.1);
  height: clamp(180px, 20vw, 250px);
  position: absolute;
  width: clamp(148px, 15vw, 208px);
  z-index: 0;
}

.hero-decor-left {
  left: -6vw;
  top: 14%;
  transform: rotate(-10deg);
}

.hero-decor-right {
  right: -6vw;
  top: 14%;
  transform: rotate(10deg);
}

.polaroid {
  background: #fffdf8;
  border: 1px solid var(--line-light);
  border-radius: 4px;
  box-shadow: 0 18px 40px rgba(26, 26, 26, 0.14);
  margin: 0;
  padding: 12px 12px 14px;
  position: absolute;
  width: clamp(148px, 15vw, 208px);
  z-index: 1;
}

.polaroid img {
  aspect-ratio: 4 / 5;
  border-radius: 2px;
  display: block;
  height: auto;
  object-fit: cover;
  width: 100%;
}

.polaroid figcaption {
  color: var(--muted-on-light);
  font-size: 13px;
  font-weight: 700;
  margin-top: 10px;
  text-align: center;
}

.polaroid-left {
  left: -2vw;
  top: 4%;
  transform: rotate(-6deg);
}

.polaroid-right {
  right: -2vw;
  top: 4%;
  transform: rotate(6deg);
}

.hero-copy {
  color: var(--ink-on-light);
  max-width: 640px;
  position: relative;
  text-align: center;
  z-index: 2;
}
```

- [ ] **Step 3: Update the 768px breakpoint to also hide the decor cards**

In the `@media (max-width: 768px)` block, replace:

```css
  /* The flanking polaroid figures don't shrink (flex-shrink: 0) and
     overflow the viewport on narrow screens; they're decorative, so hide
     them rather than force a cramped stacked layout. */
  .hero-inner .polaroid {
    display: none;
  }
```

with:

```css
  /* The flanking polaroid/decor cards are absolutely positioned outside the
     hero-copy column and overflow the viewport on narrow screens; they're
     decorative, so hide them rather than force a cramped stacked layout. */
  .hero-inner .polaroid,
  .hero-decor {
    display: none;
  }
```

- [ ] **Step 4: Manual verification**

Load `http://localhost/`. Confirm "GRANADA" renders with the blue-to-coral gradient text fill, the two real polaroid cards (with live data from `renderHeroPolaroids()`) sit rotated on either side with a decorative twin behind each, stats show the new labels with live counts, and both hero CTAs still work (modal open / scroll to map). Confirm hero collapses to a clean centered column with cards hidden below 768px.

- [ ] **Step 5: Commit**

```bash
git add web/index.html web/styles.css
git commit -m "feat: rebuild hero as centered layout with floating photo cards"
```

---

## Task 3: Ticker (new section)

**Files:**
- Modify: `web/index.html` (insert new section between Hero and Pasos, inside `.page-stack`)
- Modify: `web/styles.css` (new rules, inserted after the `.card` rule added in Task 0)

**Interfaces:**
- Consumes: `--ticker-bg` (Task 0).
- Produces: nothing consumed elsewhere — purely decorative, `aria-hidden="true"`.

- [ ] **Step 1: Insert the ticker section**

In `web/index.html`, insert between the closing `</section>` of the hero and the opening `<section class="how-to-contribute card" ...>`:

```html
        <section class="ticker card" aria-hidden="true">
          <div class="ticker-track">
            <span class="ticker-item">GRANADA 2031 · CANDIDATURA CULTURAL · TESTIMONIOS GLOBALES ·</span>
            <span class="ticker-item">GRANADA 2031 · CANDIDATURA CULTURAL · TESTIMONIOS GLOBALES ·</span>
          </div>
        </section>
```

- [ ] **Step 2: Add ticker CSS**

Append to `web/styles.css`, after the `.card` rule from Task 0:

```css
.ticker {
  background: var(--ticker-bg);
  overflow: hidden;
  padding: 20px 0;
}

.ticker-track {
  animation: ticker-scroll 24s linear infinite;
  display: flex;
  width: max-content;
}

.ticker-item {
  color: var(--ink);
  flex-shrink: 0;
  font-size: var(--fs-body-lg);
  font-weight: var(--fw-semibold);
  letter-spacing: var(--ls-wide);
  padding-right: 24px;
  text-transform: uppercase;
  white-space: nowrap;
}

@keyframes ticker-scroll {
  from {
    transform: translateX(0);
  }
  to {
    transform: translateX(-50%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .ticker-track {
    animation: none;
  }
}
```

- [ ] **Step 3: Manual verification**

Load `http://localhost/`. Confirm a dark rounded card between Hero and Pasos shows an infinitely-scrolling text marquee with no visible seam/jump. In DevTools, enable "Emulate CSS prefers-reduced-motion: reduce" and confirm the track stops scrolling.

- [ ] **Step 4: Commit**

```bash
git add web/index.html web/styles.css
git commit -m "feat: add decorative ticker section"
```

---

## Task 4: Pasos — chip eyebrow + translucent step numerals

**Files:**
- Modify: `web/styles.css:232-239` (`.eyebrow`), `web/styles.css:514-522` (`.step-number`)

**Interfaces:**
- Consumes: `--ink-on-light`, `--coral`, new `--fs-label`/`--fw-bold`/`--ls-wide` tokens (all already present from the earlier Hero tokens pass).
- Produces: the restyled base `.eyebrow` chip shape that Tasks 5 and 6 layer per-section color overrides onto (`.map-section .eyebrow`, `.eyebrow-coral`).

- [ ] **Step 1: Turn `.eyebrow` into a dark pill chip**

Replace `web/styles.css:232-239`:

```css
.eyebrow {
  background: var(--ink-on-light);
  border-radius: 999px;
  color: #fff;
  display: inline-block;
  font-size: var(--fs-label);
  font-weight: var(--fw-bold);
  letter-spacing: var(--ls-wide);
  margin: 0 0 14px;
  padding: 6px 16px;
  text-transform: uppercase;
}
```

- [ ] **Step 2: Restyle step numerals as translucent coral**

Replace `web/styles.css:514-522`:

```css
.step-number {
  color: rgba(193, 98, 45, 0.7);
  font-size: clamp(48px, 8vw, 90px);
  font-weight: var(--fw-semibold);
  letter-spacing: -0.02em;
  line-height: 0.9;
  margin-bottom: 16px;
}
```

- [ ] **Step 3: Manual verification**

Load `http://localhost/`. Confirm every section eyebrow (Pasos "COMO PARTICIPAR", the contribution modal's "Nueva contribucion", Galería's "GALERIA") now renders as a dark rounded pill with white uppercase text, and the 01/02/03 step numerals render as large translucent coral figures instead of the old thin-stroke gold digits.

- [ ] **Step 4: Commit**

```bash
git add web/styles.css
git commit -m "style: restyle eyebrow as chip and step numerals as translucent coral"
```

---

## Task 5: Mapa vivo — dark section card

**Files:**
- Modify: `web/index.html` (add `eyebrow-accent` is not needed — handled via descendant selector, no markup change required here)
- Modify: `web/styles.css:317-323` (split `.map-section` out of the shared padding rule), `web/styles.css:578-587` (`.map-shell` background)

**Interfaces:**
- Consumes: `--ink-on-light`, `--ink-on-dark`, `--accent-bright`, `--map-panel-bg` (Task 0).

- [ ] **Step 1: Remove `.map-section` from the shared padding selector**

Replace `web/styles.css:317-323`:

```css
.submit-section,
.archive-section,
.admin-section,
.how-to-contribute {
  padding: 64px clamp(18px, 4vw, 56px);
}
```

- [ ] **Step 2: Give `.map-section` its own dark-card rule**

Insert immediately after the rule from Step 1:

```css
.map-section {
  background: var(--ink-on-light);
  color: var(--ink-on-dark);
  padding: 64px clamp(18px, 4vw, 56px);
  position: relative;
}

.map-section h2,
.map-section .section-heading {
  color: var(--ink-on-dark);
}

.map-section .eyebrow {
  background: var(--accent-bright);
  color: var(--ink-on-light);
}
```

- [ ] **Step 3: Recolor the inner map panel**

In `.map-shell` (`web/styles.css:578-587`), change the `background` property:

```css
.map-shell {
  background: var(--map-panel-bg);
  border: 1px solid var(--line);
  border-radius: 28px;
  box-shadow: 0 30px 90px rgba(0, 0, 0, 0.4), 0 0 120px rgba(247, 198, 103, 0.08);
  color: var(--ink-on-dark);
  margin: 0 auto;
  max-width: 1280px;
  padding: clamp(18px, 3vw, 32px);
}
```

- [ ] **Step 4: Manual verification**

Load `http://localhost/`. Confirm the whole Mapa vivo card (not just the inner map panel) is dark (`--ink-on-light`, `#211c13`) with white heading text and a tangerine "Mapa vivo" chip, the inner map panel is now a slightly different near-black shade, and the Leaflet map/filters/zoom controls/marker clicks still work.

- [ ] **Step 5: Commit**

```bash
git add web/styles.css
git commit -m "feat: restyle Mapa vivo section as dark card"
```

---

## Task 6: Cita + stats overlay

**Files:**
- Modify: `web/index.html` (add chip to the quote section, add stats-overlay markup inside `.map-section`)
- Modify: `web/styles.css` (`.dark-pullquote-banner` at `web/styles.css:325-343`, new `.eyebrow-coral` and `.stats-overlay-*` rules)
- Modify: `web/app.js:264-281` (`renderStats()`)

**Interfaces:**
- Consumes: `--accent-bright`, `--stats-overlay-bg` (Task 0), `.map-section` with `position: relative` (Task 5).
- Produces: `#overlayStatTotal`, `#overlayStatCountries`, `#overlayStatCities` — new IDs `renderStats()` must populate alongside the existing `#statPhotos`/`#statCountries`/`#statCities`.

- [ ] **Step 1: Add the coral chip to the quote section**

In `web/index.html`, replace:

```html
          <section class="dark-pullquote-banner card" aria-label="Cita inspiradora sobre Granada">
            <p class="pullquote-text">Cada foto es un vínculo con Granada, esté donde esté quien la comparte.</p>
          </section>
```

with:

```html
          <section class="dark-pullquote-banner card" aria-label="Cita inspiradora sobre Granada">
            <p class="eyebrow eyebrow-coral">LA COMUNIDAD</p>
            <p class="pullquote-text">Cada foto es un vínculo con Granada, esté donde esté quien la comparte.</p>
          </section>
```

- [ ] **Step 2: Add the stats overlay card as the last child of `.map-section`**

In `web/index.html`, inside `<section class="map-section card" ...>`, insert right before the section's closing `</section>` tag (after the `.map-shell` div):

```html
            <div class="stats-overlay-card" aria-label="Estadisticas destacadas">
              <div class="stats-overlay-main">
                <span class="stats-overlay-number" id="overlayStatTotal">0</span>
                <span class="stats-overlay-label">fotos compartidas</span>
              </div>
              <dl class="stats-overlay-secondary">
                <div>
                  <dt id="overlayStatCountries">0</dt>
                  <dd>países</dd>
                </div>
                <div>
                  <dt id="overlayStatCities">0</dt>
                  <dd>ciudades</dd>
                </div>
              </dl>
            </div>
```

- [ ] **Step 3: Restyle the quote section and add the stats-overlay CSS**

Replace `.dark-pullquote-banner` (`web/styles.css:325-333`, keep `.pullquote-text` as-is):

```css
.dark-pullquote-banner {
  align-items: center;
  background: var(--accent-bright);
  display: flex;
  flex-direction: column;
  justify-content: center;
  margin: 0;
  padding: 96px clamp(18px, 4vw, 56px);
  text-align: center;
}
```

Then, in `.pullquote-text`, change the text color from `var(--ink-on-dark)` to `var(--ink-on-light)` since the background is now bright, not dark:

```css
.pullquote-text {
  color: var(--ink-on-light);
  font-size: clamp(28px, 5vw, 48px);
  font-weight: 700;
  line-height: 1.2;
  margin: 0;
  max-width: 900px;
  letter-spacing: -0.01em;
}
```

Append the new rules after the ticker CSS from Task 3:

```css
.eyebrow-coral {
  background: var(--coral);
  color: #fff;
}

.stats-overlay-card {
  background: var(--stats-overlay-bg);
  border-radius: var(--card-radius);
  bottom: 0;
  box-shadow: 0 30px 60px rgba(0, 0, 0, 0.35);
  left: 50%;
  padding: 32px 40px;
  position: absolute;
  text-align: center;
  transform: translate(-50%, 50%);
  width: min(420px, 90%);
  z-index: 3;
}

.stats-overlay-number {
  color: var(--accent-bright);
  display: block;
  font-size: clamp(48px, 6vw, 72px);
  font-weight: var(--fw-extrabold);
  line-height: 1;
}

.stats-overlay-label {
  color: var(--ink-on-dark);
  display: block;
  font-size: var(--fs-label);
  letter-spacing: var(--ls-wide);
  margin-top: 8px;
  text-transform: uppercase;
}

.stats-overlay-secondary {
  display: flex;
  gap: 32px;
  justify-content: center;
  margin: 20px 0 0;
}

.stats-overlay-secondary dt {
  color: #fff;
  font-size: var(--fs-stat);
  font-weight: var(--fw-bold);
}

.stats-overlay-secondary dd {
  color: var(--muted);
  font-size: var(--fs-caption);
  margin: 4px 0 0;
  text-transform: uppercase;
}

@media (max-width: 760px) {
  .stats-overlay-card {
    bottom: auto;
    left: auto;
    margin: -40px auto 0;
    position: relative;
    transform: none;
  }
}
```

- [ ] **Step 4: Extend `renderStats()` to populate the overlay numbers**

In `web/app.js`, replace the body of `renderStats()` (`web/app.js:264-281`):

```javascript
function renderStats() {
  const approved = approvedTraces();
  const countries = new Set(approved.map((trace) => normalize(trace.country))).size;
  const cities = new Set(
    approved.map((trace) => `${normalize(trace.city)}|${normalize(trace.country)}`),
  ).size;

  const setStat = (selector, value) => {
    const element = document.querySelector(selector);
    if (element) element.textContent = value;
  };

  setStat("#approvedCount", approved.length);
  setStat("#countryCount", countries);
  setStat("#statPhotos", approved.length);
  setStat("#statCountries", countries);
  setStat("#statCities", cities);
  setStat("#overlayStatTotal", approved.length);
  setStat("#overlayStatCountries", countries);
  setStat("#overlayStatCities", cities);
}
```

- [ ] **Step 5: Manual verification**

Load `http://localhost/`. Confirm the quote section's background is bright tangerine with a coral "LA COMUNIDAD" chip and dark quote text, and a near-black stats card visually straddles the boundary between the Mapa vivo card and the quote card, showing the same live totals as the Hero stats. Check the `@media (max-width: 760px)` fallback un-floats the card into normal flow on a narrow viewport.

- [ ] **Step 6: Commit**

```bash
git add web/index.html web/styles.css web/app.js
git commit -m "feat: restyle Cita section and add straddling stats overlay card"
```

---

## Task 7: Galería — polaroid-proportioned trace cards

**Files:**
- Modify: `web/styles.css:1056-1082` (`.trace-card`, `.trace-card img`, `.trace-card div`)

**Interfaces:**
- Consumes: existing `--tilt` custom property (set per-card by `renderArchive()` in `app.js`, unchanged).

- [ ] **Step 1: Update trace-card proportions and inset**

Replace `web/styles.css:1056-1082`:

```css
.trace-card {
  background: #fffdf8;
  border: 1px solid var(--line-light);
  border-radius: 4px;
  box-shadow: 0 14px 32px rgba(26, 26, 26, 0.16);
  padding: 16px 16px 20px;
  transform: rotate(var(--tilt, 0deg));
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.trace-card:hover,
.trace-card:focus-within {
  box-shadow: 0 22px 48px rgba(26, 26, 26, 0.24);
  transform: rotate(0deg);
  z-index: 2;
}

.trace-card img {
  aspect-ratio: 4 / 5;
  border-radius: 2px;
  object-fit: cover;
  width: 100%;
}

.trace-card div {
  padding: 14px 2px 0;
}
```

- [ ] **Step 2: Manual verification**

Load `http://localhost/`, scroll to the Galería section. Confirm the archive grid cards now have the taller polaroid proportions (4:5 photo) with a slightly deeper inset padding, still randomly tilted via `--tilt`, still open the story panel on click, and "Cargar más fotos" still works.

- [ ] **Step 3: Commit**

```bash
git add web/styles.css
git commit -m "style: give trace cards polaroid proportions to match Figma gallery"
```

---

## Task 8: Newsletter — blue banner with circular arrow submit

**Files:**
- Modify: `web/index.html` (submit button markup)
- Modify: `web/styles.css:345-441` (`.newsletter-banner`, `.newsletter-title`, `.newsletter-control`, `.newsletter-submit`, the 520px media override)

**Interfaces:**
- Consumes: `--blue` (already defined), `--coral`, `--bg-light`.

- [ ] **Step 1: Change the submit button to an icon-only circular button**

In `web/index.html`, replace:

```html
              <button class="newsletter-submit" type="submit">Avisadme</button>
```

with:

```html
              <button class="newsletter-submit" type="submit" aria-label="Avisadme">→</button>
```

- [ ] **Step 2: Recolor the banner and title**

Replace `.newsletter-banner` and `.newsletter-title` (`web/styles.css:345-366`):

```css
.newsletter-banner {
  background: var(--blue);
  padding: 72px clamp(18px, 4vw, 56px);
  display: flex;
  justify-content: center;
  text-align: center;
}

.newsletter-inner {
  max-width: 720px;
  width: 100%;
}

.newsletter-title {
  color: #fff;
  font-size: clamp(24px, 4vw, 40px);
  font-weight: 800;
  line-height: 1.15;
  letter-spacing: 0.02em;
  margin: 0 0 32px;
  text-shadow: 0 2px 12px rgba(0, 0, 0, 0.18);
  text-transform: uppercase;
}
```

- [ ] **Step 3: Recolor the input pill and turn the submit button circular**

Replace `.newsletter-control` and `.newsletter-submit` (`web/styles.css:372-413`):

```css
.newsletter-control {
  align-items: center;
  background: var(--bg-light);
  border-radius: 999px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
  display: flex;
  margin: 0 auto;
  max-width: 480px;
  padding: 6px;
}

.newsletter-input {
  background: transparent;
  border: 0;
  color: var(--ink-on-light);
  flex: 1;
  font-size: 16px;
  min-height: 44px;
  outline: none;
  padding: 0 18px;
}

.newsletter-input::placeholder {
  color: var(--muted-on-light);
}

.newsletter-submit {
  align-items: center;
  background: var(--coral);
  border: 0;
  border-radius: 50%;
  color: #fff;
  cursor: pointer;
  display: flex;
  flex-shrink: 0;
  font-size: 18px;
  height: 44px;
  justify-content: center;
  width: 44px;
}

.newsletter-submit:hover {
  filter: brightness(0.94);
}
```

- [ ] **Step 4: Fix the 520px override so the button stays circular**

Replace the `@media (max-width: 520px)` block (`web/styles.css:430-441`):

```css
@media (max-width: 520px) {
  .newsletter-control {
    border-radius: 20px;
    flex-direction: column;
    gap: 8px;
    padding: 10px;
  }

  .newsletter-submit {
    align-self: center;
    width: 44px;
  }
}
```

- [ ] **Step 5: Manual verification**

Load `http://localhost/`, scroll to Newsletter. Confirm the section background is exactly `--blue`, the input sits in a cream pill with a small coral circular arrow button, the button submits the form (invalid email shows the existing error text, valid email shows the existing success text), and the mobile stacked layout keeps the button centered and circular.

- [ ] **Step 6: Commit**

```bash
git add web/index.html web/styles.css
git commit -m "feat: restyle newsletter banner with circular arrow submit button"
```

---

## Task 9: Footer — richer two-column dark card

**Files:**
- Modify: `web/index.html` (footer markup)
- Modify: `web/styles.css:1426-1479` (`.site-footer`, `.footer-inner`, add `.footer-main`, `.footer-description`, `.footer-contact`)

**Interfaces:**
- Consumes: `--footer-bg` (Task 0).
- Preserves: `#footerText`, `#privacyLink`, `#legalLink`, `#idealLogoLink`, `#idealLogo`, `#idealLogoFallback` (all written by `applyPublicConfig()` in `app.js` — must not be renamed).

- [ ] **Step 1: Expand the footer markup**

Replace:

```html
      <footer class="site-footer card">
        <div class="footer-inner">
          <p id="footerText">Granada 2031. Geolocalizacion del Sentimiento.</p>
          <nav class="footer-links" aria-label="Enlaces legales">
            <a id="privacyLink" href="/politica-de-privacidad">Politica de privacidad</a>
            <a id="legalLink" href="/aviso-legal">Aviso legal</a>
          </nav>
          <a class="footer-logo-link" id="idealLogoLink" href="https://www.ideal.es" aria-label="IDEAL">
            <img class="footer-logo hidden" id="idealLogo" alt="IDEAL">
            <span class="footer-logo-fallback" id="idealLogoFallback">IDEAL</span>
          </a>
        </div>
      </footer>
```

with:

```html
      <footer class="site-footer card">
        <div class="footer-inner">
          <div class="footer-main">
            <p class="footer-description">Granada 2031 es una candidatura cultural que conecta cada rincón del planeta con la ciudad a través de fotografías y recuerdos compartidos.</p>
            <p id="footerText">Granada 2031. Geolocalizacion del Sentimiento.</p>
            <p class="footer-contact">info@2031granadaideal.es</p>
            <nav class="footer-links" aria-label="Enlaces legales">
              <a id="privacyLink" href="/politica-de-privacidad">Politica de privacidad</a>
              <a id="legalLink" href="/aviso-legal">Aviso legal</a>
            </nav>
          </div>
          <a class="footer-logo-link" id="idealLogoLink" href="https://www.ideal.es" aria-label="IDEAL">
            <img class="footer-logo hidden" id="idealLogo" alt="IDEAL">
            <span class="footer-logo-fallback" id="idealLogoFallback">IDEAL</span>
          </a>
        </div>
      </footer>
```

- [ ] **Step 2: Restyle the footer as a dark card**

Replace `.site-footer` and `.footer-inner` (`web/styles.css:1426-1444`):

```css
.site-footer {
  background: var(--footer-bg);
  padding: 56px clamp(18px, 4vw, 56px);
}

.footer-inner {
  align-items: flex-end;
  display: flex;
  gap: 18px;
  justify-content: space-between;
  margin: 0 auto;
  max-width: 1280px;
}

.footer-main {
  display: grid;
  gap: 12px;
  max-width: 640px;
}

.footer-description {
  color: var(--ink);
  font-size: var(--fs-body-lg);
  line-height: var(--lh-normal);
  margin: 0;
}

.footer-inner p {
  color: var(--muted);
  margin: 0;
}

.footer-contact {
  color: var(--ink);
  font-weight: var(--fw-semibold);
}
```

- [ ] **Step 3: Manual verification**

Load `http://localhost/`, scroll to the footer. Confirm it renders as a near-black rounded card with a description paragraph, the existing config-driven `#footerText`, a static contact email, the two legal links, and the IDEAL logo on the right (or its fallback badge if no logo is configured). Confirm the existing `@media (max-width: 900px)` rule still stacks it into a single column on narrow viewports.

- [ ] **Step 4: Commit**

```bash
git add web/index.html web/styles.css
git commit -m "feat: expand footer into two-column dark card"
```

---

## Task 10: Full-page regression pass

**Files:** none (verification only — fix forward in the relevant task's files if something regressed)

- [ ] **Step 1: Full click-through at desktop width**

Against `http://localhost/`: nav anchors scroll correctly; hero CTAs open the modal / scroll to map; map filters, zoom, and marker click open the story panel; the contribution form submits end-to-end (photo upload, city geocode picker, consent, deletion-token display); gallery "load more" reveals additional cards; newsletter form submits and shows success/error states.

- [ ] **Step 2: Full click-through at a narrow viewport (~375px)**

Repeat Step 1's interactions at a mobile width. Confirm the breakpoints noted in the spec (`web/styles.css` mobile blocks at 900px/768px/760px/560px/520px) still apply correctly against the new markup — nothing should overflow horizontally, and the `.hero-decor`/`.polaroid` hide rules, stats-overlay static fallback, and stacked footer/newsletter all engage as expected.

- [ ] **Step 3: Compare every section against its Figma node**

Side-by-side each of the 9 sections against the Figma screenshots referenced in the design spec (`docs/superpowers/specs/2026-08-11-figma-landing-redesign-design.md`), confirming colors, chip placement, and the card-stack/gap rhythm match.

- [ ] **Step 4: Commit (only if fixes were needed)**

If Step 1-3 surfaced any regressions, fix them in the owning task's files, then:

```bash
git add web/index.html web/styles.css web/app.js
git commit -m "fix: address regressions found in full-page verification pass"
```
