// Cookie consent banner, shared by every public page (landing + legal pages).
// Self-contained — builds its own markup — so it works without each page
// carrying duplicate static HTML, the same way nav-toggle.js is shared
// without depending on app.js.
(function () {
  const STORAGE_KEY = "granada2031_cookie_consent"; // "accepted" only — a
  // denial is never persisted, so a later visit shows the banner again
  // instead of auto-redirecting based on a past decision.
  const DENY_REDIRECT_URL = "cookies-denegadas.html";

  function getStoredConsent() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  }

  function setStoredConsent(value) {
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // Private browsing / blocked storage: consent still applies to this
      // page view, it just won't be remembered on the next visit.
    }
  }

  function clearStoredConsent() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Nothing to clean up if storage was never writable in the first place.
    }
  }

  function buildBanner() {
    const banner = document.createElement("aside");
    banner.className = "cookie-banner hidden";
    banner.id = "cookieBanner";
    banner.setAttribute("role", "dialog");
    banner.setAttribute("aria-live", "polite");
    banner.setAttribute("aria-label", "Preferencias de cookies");
    banner.innerHTML = `
      <p class="cookie-banner__text">Para ofrecer las mejores experiencias, utilizamos tecnologías como las cookies para almacenar y/o acceder a la información del dispositivo. El consentimiento de estas tecnologías nos permitirá procesar datos como el comportamiento de navegación o las identificaciones únicas en este sitio. No consentir el consentimiento, puede afectar negativamente a ciertas características y funciones.</p>
      <p class="cookie-banner__links">
        <a href="https://2031granadaideal.es/politica-de-cookies/" target="_blank" rel="noopener">Política de cookies</a>
        <a href="https://2031granadaideal.es/politica-de-privacidad/" target="_blank" rel="noopener">Política de privacidad</a>
      </p>
      <div class="cookie-banner__actions">
        <button type="button" class="button ghost" id="cookieDenyButton">Denegar</button>
        <button type="button" class="button primary" id="cookieAcceptButton">Aceptar</button>
      </div>
    `;
    return banner;
  }

  function buildTab() {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "cookie-tab hidden";
    tab.id = "cookieTabButton";
    tab.setAttribute("aria-label", "Abrir preferencias de cookies");
    tab.title = "Preferencias de cookies";
    tab.textContent = "🍪";
    return tab;
  }

  const banner = buildBanner();
  const tab = buildTab();
  document.body.append(banner, tab);

  function showBanner() {
    banner.classList.remove("hidden");
    tab.classList.add("hidden");
  }

  function collapseToTab() {
    banner.classList.add("hidden");
    tab.classList.remove("hidden");
  }

  banner.querySelector("#cookieAcceptButton").addEventListener("click", () => {
    setStoredConsent("accepted");
    collapseToTab();
  });

  banner.querySelector("#cookieDenyButton").addEventListener("click", () => {
    // Overrides a stale "accepted" from before, so changing your mind later
    // shows the full banner again on the next visit instead of the tab.
    clearStoredConsent();
    window.location.href = DENY_REDIRECT_URL;
  });

  tab.addEventListener("click", showBanner);

  if (getStoredConsent() === "accepted") {
    collapseToTab();
  } else {
    showBanner();
  }
})();
