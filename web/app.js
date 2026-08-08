const API_BASE = "/api";

const emotionLabels = {
  nostalgia: "Nostalgia",
  pertenencia: "Pertenencia",
  asombro: "Asombro",
  futuro: "Futuro"
};

const ARCHIVE_BATCH_SIZE = 8;

let traces = [];
let archiveVisibleCount = ARCHIVE_BATCH_SIZE;
let activeFilter = "all";
let selectedTraceId = null;

const worldMapEl = document.querySelector("#worldMap");
const form = document.querySelector("#traceForm");
const archiveGrid = document.querySelector("#archiveGrid");
const archiveLoadMoreButton = document.querySelector("#archiveLoadMore");
const storyPanel = document.querySelector("#storyPanel");
const zoomInButton = document.querySelector("#zoomIn");
const zoomOutButton = document.querySelector("#zoomOut");
const zoomResetButton = document.querySelector("#zoomReset");

const INITIAL_CENTER = [20, 0];
const INITIAL_ZOOM = 2;

const map = L.map(worldMapEl, {
  center: INITIAL_CENTER,
  zoom: INITIAL_ZOOM,
  minZoom: 2,
  maxZoom: 18,
  zoomControl: false,
  worldCopyJump: true,
});

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 18,
}).addTo(map);

// Leaflet needs a sized container; recompute once painted and on resize so
// tiles don't render gray or half-loaded.
requestAnimationFrame(() => map.invalidateSize());
window.addEventListener("resize", () => map.invalidateSize());

// Approved traces are shown as custom glowing markers (see .trace-marker in
// styles.css). They live in a single LayerGroup so emotion filters can add or
// remove markers without recreating them or redrawing the whole map.
const markerLayer = L.layerGroup().addTo(map);
let traceMarkers = [];

function traceMarkerIcon() {
  return L.divIcon({
    className: "trace-marker",
    html: '<span class="trace-marker__dot"></span>',
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

function buildMarkers() {
  traceMarkers = approvedTraces().map((trace) => {
    const marker = L.marker([trace.lat, trace.lng], {
      icon: traceMarkerIcon(),
      title: `${trace.city}, ${trace.country}`,
    });
    marker.on("click", () => openStory(trace));
    return { trace, marker };
  });
  renderMarkers();
}

function renderMarkers() {
  markerLayer.clearLayers();
  traceMarkers
    .filter(({ trace }) => activeFilter === "all" || trace.emotion === activeFilter)
    .forEach(({ marker }) => marker.addTo(markerLayer));
}

async function apiRequest(path, options = {}) {
  if (window.location.protocol === "file:") {
    throw new Error("Abre el MVP desde el servidor Bun, no directamente como archivo. Ejecuta: bun run api/server.ts --host 0.0.0.0 --port 8080");
  }

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, options);
  } catch {
    throw new Error("No hay conexion con la API. Comprueba que api/server.ts esta ejecutandose y abre la URL del servidor, por ejemplo http://localhost:8080.");
  }

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : await response.text();

  if (!response.ok) {
    if (response.status === 404 && !contentType.includes("application/json")) {
      throw new Error("La ruta /api/traces devuelve 404 fuera de api/server.ts. Revisa Nginx o arranca la app con: bun run api/server.ts --host 0.0.0.0 --port 8080");
    }

    const message = typeof payload === "object" && payload.error
      ? payload.error
      : `La API no respondio correctamente (${response.status}). Asegurate de abrir la web desde api/server.ts, no desde un servidor estatico.`;
    throw new Error(message);
  }

  return payload;
}

function setText(selector, value) {
  const element = document.querySelector(selector);
  if (element && value) element.textContent = value;
}

function setLink(selector, label, url) {
  const element = document.querySelector(selector);
  if (!element) return;
  if (label) element.textContent = label;
  if (url) element.href = url;
}

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

function applyPublicConfig(config) {
  if (!config) return;

  if (config.site_title) document.title = config.site_title;
  setText("#brandName", config.brand_name);
  setText("#brandSubtitle", config.brand_subtitle);
  setText("#heroText", config.hero_text);
  setText("#mapTitle", config.map_title);
  setText("#mapSectionTitle", config.hero_title);
  setText("#mapHint", config.map_hint);
  setText("#submitEyebrow", config.submit_eyebrow);
  setText("#submit-title", config.submit_title);
  setText("#archiveEyebrow", config.archive_eyebrow);
  setText("#archive-title", config.archive_title);
  setText("#consentText", config.consent_text);
  setText("#footerText", config.footer_text);
  setLink("#privacyLink", config.privacy_label, config.privacy_url);
  setLink("#legalLink", config.legal_label, config.legal_url);
  setLink("#idealLogoLink", null, config.ideal_url);
  applyLogo("#brandLogo", "#brandMark", config.brand_logo, config.brand_logo_alt);
  applyLogo("#idealLogo", "#idealLogoFallback", config.ideal_logo, config.ideal_logo_alt);

  const brandLabel = [config.brand_name, config.brand_subtitle].filter(Boolean).join(" | ");
  if (brandLabel) document.querySelector("#brandLink")?.setAttribute("aria-label", brandLabel);
  if (config.ideal_logo_alt) document.querySelector("#idealLogoLink")?.setAttribute("aria-label", config.ideal_logo_alt);
}

async function loadPublicConfig() {
  const payload = await apiRequest("/config");
  applyPublicConfig(payload.config);
}

async function loadTraces() {
  const payload = await apiRequest("/traces");
  traces = payload.traces;
  renderAll();
}

function normalize(value) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function approvedTraces() {
  return traces;
}

function visibleTraces() {
  return approvedTraces().filter((trace) => activeFilter === "all" || trace.emotion === activeFilter);
}

function openStory(trace) {
  selectedTraceId = trace.id;
  document.querySelector("#storyImage").src = trace.photo;
  document.querySelector("#storyImage").alt = `Fotografia subida por ${trace.name}`;
  document.querySelector("#storyEmotion").textContent = emotionLabels[trace.emotion];
  document.querySelector("#storyEmotion").className = `emotion ${trace.emotion}`;
  document.querySelector("#storyTitle").textContent = trace.name;
  document.querySelector("#storyLocation").textContent = `${trace.city}, ${trace.country}`;
  document.querySelector("#storyFeeling").textContent = trace.feeling;
  document.querySelector("#storyRelation").textContent = trace.relation;
  document.querySelector("#storyDate").textContent = new Intl.DateTimeFormat("es-ES", { dateStyle: "medium" }).format(new Date(trace.createdAt));
  document.querySelector("#storyContact").textContent = trace.email;
  document.querySelector("#storyContact").href = `mailto:${trace.email}`;
  storyPanel.classList.remove("hidden");
}

function closeStory() {
  selectedTraceId = null;
  storyPanel.classList.add("hidden");
}

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
}

const HERO_POLAROID_FALLBACKS = [
  { photo: "/demo/berlin.svg", city: "Berlin" },
  { photo: "/demo/buenos-aires.svg", city: "Buenos Aires" },
];

function renderHeroPolaroids() {
  const approved = approvedTraces()
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const cards = [
    document.querySelector("#heroPolaroidLeft"),
    document.querySelector("#heroPolaroidRight"),
  ];

  cards.forEach((card, index) => {
    if (!card) return;
    const source = approved[index] || HERO_POLAROID_FALLBACKS[index];
    const img = card.querySelector("img");
    const caption = card.querySelector("figcaption");
    img.src = source.photo;
    img.alt = `Rastro de Granada en ${source.city}`;
    caption.textContent = source.city;
  });
}

const POLAROID_TILT_MAGNITUDES = [1.5, 3, 2, 2.75, 1.75, 2.25];

function polaroidTilt(index) {
  const direction = index % 2 === 0 ? -1 : 1;
  const magnitude = POLAROID_TILT_MAGNITUDES[index % POLAROID_TILT_MAGNITUDES.length];
  return direction * magnitude;
}

function renderArchive() {
  archiveGrid.innerHTML = "";
  const template = document.querySelector("#archiveCardTemplate");
  const approved = approvedTraces().slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  if (approved.length === 0) {
    archiveGrid.innerHTML = `<p class="empty-state">Todavia no hay luces aprobadas.</p>`;
    archiveLoadMoreButton.classList.add("hidden");
    return;
  }

  approved.slice(0, archiveVisibleCount).forEach((trace, index) => {
    const node = template.content.cloneNode(true);
    const article = node.querySelector("article");
    const img = node.querySelector("img");
    img.src = trace.photo;
    img.alt = `Rastro de Granada en ${trace.city}`;
    node.querySelector(".emotion").textContent = emotionLabels[trace.emotion];
    node.querySelector(".emotion").className = `emotion ${trace.emotion}`;
    node.querySelector("h3").textContent = `${trace.city}, ${trace.country}`;
    node.querySelector("p").textContent = trace.feeling;
    article.style.setProperty("--tilt", `${polaroidTilt(index)}deg`);
    node.querySelector("button").addEventListener("click", () => {
      document.querySelector("#mapa").scrollIntoView({ behavior: "smooth" });
      openStory(trace);
    });
    archiveGrid.appendChild(node);
  });

  archiveLoadMoreButton.classList.toggle("hidden", archiveVisibleCount >= approved.length);
}

archiveLoadMoreButton.addEventListener("click", () => {
  archiveVisibleCount += ARCHIVE_BATCH_SIZE;
  renderArchive();
});

function renderAll() {
  buildMarkers();
  renderStats();
  renderHeroPolaroids();
  renderArchive();
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const status = document.querySelector("#formStatus");
  const photo = data.get("photo");

  if (!photo || !photo.size) {
    status.textContent = "Selecciona una fotografia para continuar.";
    return;
  }

  status.textContent = "Subiendo contribucion al servidor...";

  try {
    const response = await apiRequest("/traces", {
      method: "POST",
      body: data
    });
    form.reset();
    
    // Display deletion token to user
    if (response.deletionToken) {
      const tokenMessage = `Recibido. Tu luz esta guardada en el servidor y queda en revision.\n\n⚠️ GUARDA ESTE CODIGO PARA ELIMINAR TU CONTRIBUCION:\n\n${response.deletionToken}\n\nSi lo pierdes, no podras borrar tu aportacion. Cópialo a un lugar seguro.`;
      status.textContent = tokenMessage;
      status.style.whiteSpace = "pre-wrap";
    } else {
      status.textContent = "Recibido. Tu luz esta guardada en el servidor y queda en revision.";
    }
    
    await loadTraces();
  } catch (error) {
    status.textContent = error.message;
  }
});

const newsletterForm = document.querySelector("#newsletterForm");
newsletterForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = document.querySelector("#newsletterStatus");
  const input = document.querySelector("#newsletterEmail");
  const email = input.value.trim();
  status.classList.remove("error", "success");

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    status.textContent = "Introduce un correo electronico valido.";
    status.classList.add("error");
    return;
  }

  status.textContent = "Enviando...";

  try {
    await apiRequest("/notify-signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    newsletterForm.reset();
    status.textContent = "Listo. Te avisaremos cuando tu foto se publique en el mapa.";
    status.classList.add("success");
  } catch (error) {
    status.textContent = error.message;
    status.classList.add("error");
  }
});


document.querySelectorAll("[data-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    activeFilter = button.dataset.filter;
    document.querySelectorAll("[data-filter]").forEach((item) => item.classList.toggle("active", item === button));
    renderMarkers();
    closeStory();
  });
});

zoomInButton.addEventListener("click", () => map.zoomIn());
zoomOutButton.addEventListener("click", () => map.zoomOut());
zoomResetButton.addEventListener("click", () => map.setView(INITIAL_CENTER, INITIAL_ZOOM));

document.querySelector("#closeStory").addEventListener("click", closeStory);
storyPanel.addEventListener("click", (event) => {
  if (event.target === storyPanel) closeStory();
});

const contributeModal = document.querySelector("#participa");

function openContributeModal() {
  if (!contributeModal) return;
  contributeModal.classList.remove("hidden");
  contributeModal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  const firstField = contributeModal.querySelector('.trace-form [name="name"]');
  if (firstField) firstField.focus();
}

function closeContributeModal() {
  if (!contributeModal) return;
  contributeModal.classList.add("hidden");
  contributeModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
}

document.querySelectorAll("[data-open-contribute]").forEach((trigger) => {
  trigger.addEventListener("click", (event) => {
    event.preventDefault();
    openContributeModal();
  });
});

document.querySelector("#closeContribute")?.addEventListener("click", closeContributeModal);
contributeModal?.addEventListener("click", (event) => {
  if (event.target === contributeModal) closeContributeModal();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeStory();
    closeContributeModal();
  }
});

document.querySelector("#heroViewMap")?.addEventListener("click", () => {
  document.querySelector(".map-section")?.scrollIntoView({ behavior: "smooth" });
});

loadPublicConfig().catch(() => {
  // Si la configuracion publica falla, la portada conserva sus textos por defecto.
});

loadTraces().catch((error) => {
  archiveGrid.innerHTML = `<p class="empty-state">${error.message}</p>`;
});
