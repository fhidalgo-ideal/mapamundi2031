// Mobile hamburger menu, shared by every page that uses the .topbar header
// (landing, admin, legal pages): collapses the nav links + CTA into a
// toggleable panel below the logo/toggle row (see the 900px CSS query in
// styles.css) so the header stays a single line instead of stacking every
// element. Self-contained — no dependency on app.js — so pages that don't
// load the full app bundle (admin, legal pages) still get the same behavior.
(function () {
  const topbarEl = document.querySelector("#topbar");
  const navToggle = document.querySelector("#navToggle");
  if (!topbarEl || !navToggle) return;

  function closeMobileNav() {
    if (!topbarEl.classList.contains("nav-open")) return;
    topbarEl.classList.remove("nav-open");
    navToggle.setAttribute("aria-expanded", "false");
    navToggle.setAttribute("aria-label", "Abrir menú");
  }

  navToggle.addEventListener("click", () => {
    const isOpen = topbarEl.classList.toggle("nav-open");
    navToggle.setAttribute("aria-expanded", String(isOpen));
    navToggle.setAttribute("aria-label", isOpen ? "Cerrar menú" : "Abrir menú");
  });

  // Picking a link or the CTA closes the panel instead of leaving it open
  // over the section/page it just jumped to. A submenu toggle (aria-haspopup)
  // opens more options instead of navigating, so it leaves the panel open.
  document.querySelector("#topbarNav")?.addEventListener("click", (event) => {
    if (event.target.closest("a, button:not([aria-haspopup])")) closeMobileNav();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMobileNav();
  });
})();
