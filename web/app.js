const API_BASE = "/api";

const emotionLabels = {
  nostalgia: "Nostalgia",
  pertenencia: "Pertenencia",
  asombro: "Asombro",
  futuro: "Futuro"
};

// 20 = 5 rows on desktop's 4-column archive grid.
const ARCHIVE_BATCH_SIZE = 20;

let traces = [];
let archiveVisibleCount = ARCHIVE_BATCH_SIZE;
let activeFilter = "all";
let selectedTraceId = null;
let storyPhotos = [];
let currentStoryPhotoId = null;

const worldMapEl = document.querySelector("#worldMap");
const form = document.querySelector("#traceForm");
const archiveGrid = document.querySelector("#archiveGrid");
const archiveLoadMoreButton = document.querySelector("#archiveLoadMore");
const storyPanel = document.querySelector("#storyPanel");
const storyThumbs = document.querySelector("#storyThumbs");
const storyVoteButton = document.querySelector("#storyVoteButton");
const storyVoteCount = document.querySelector("#storyVoteCount");
const zoomInButton = document.querySelector("#zoomIn");
const zoomOutButton = document.querySelector("#zoomOut");
const zoomResetButton = document.querySelector("#zoomReset");
const photoInput = document.querySelector("#photoInput");
const photoDropZone = document.querySelector("#fileDropZone");
const photoPreviews = document.querySelector("#filePreviews");
const photoMessage = document.querySelector("#fileDropMessage");
const MAX_PHOTOS = 5;
const citySearchInput = document.querySelector("#citySearchInput");
const citySearchResults = document.querySelector("#citySearchResults");
const locationMapEl = document.querySelector("#locationMap");
const locationSummary = document.querySelector("#locationSummary");
const locationMessage = document.querySelector("#locationMessage");
const traceCityHidden = document.querySelector("#traceCityHidden");
const traceCountryHidden = document.querySelector("#traceCountryHidden");
const traceLatHidden = document.querySelector("#traceLatHidden");
const traceLngHidden = document.querySelector("#traceLngHidden");

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

L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?key=cb1_3lqo_2_adc208e454c29d5f597d933b", {
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  subdomains: "abcd",
  maxZoom: 20,
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
  applyLogo("#brandLogo", "#brandMark", config.brand_logo, config.brand_logo_alt, "#brandText");
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

function renderStoryThumbs() {
  storyThumbs.innerHTML = "";
  if (storyPhotos.length <= 1) {
    storyThumbs.classList.add("hidden");
    return;
  }
  storyThumbs.classList.remove("hidden");
  storyPhotos.forEach((photo, index) => {
    const thumbButton = document.createElement("button");
    thumbButton.type = "button";
    thumbButton.className = "story-thumb";
    thumbButton.setAttribute("aria-label", `Foto ${index + 1} de ${storyPhotos.length}`);
    const thumbImage = document.createElement("img");
    thumbImage.src = photo.url;
    thumbImage.alt = "";
    thumbButton.appendChild(thumbImage);
    thumbButton.addEventListener("click", () => setStoryPhoto(index));
    storyThumbs.appendChild(thumbButton);
  });
}

function renderStoryVote(photo) {
  if (!storyVoteButton || !storyVoteCount) return;
  storyVoteButton.disabled = false;
  storyVoteButton.classList.remove("is-voted");
  storyVoteButton.textContent = "Votar esta foto";
  storyVoteCount.textContent = photo.voteCount;
}

function setStoryPhoto(index) {
  const photo = storyPhotos[index];
  if (!photo) return;
  currentStoryPhotoId = photo.id;
  document.querySelector("#storyImage").src = photo.url;
  storyThumbs.querySelectorAll(".story-thumb").forEach((thumbButton, thumbIndex) => {
    thumbButton.classList.toggle("is-active", thumbIndex === index);
  });
  renderStoryVote(photo);
}

async function castStoryVote() {
  if (!currentStoryPhotoId || !storyVoteButton) return;
  storyVoteButton.disabled = true;
  try {
    const payload = await apiRequest(`/photos/${encodeURIComponent(currentStoryPhotoId)}/vote`, {
      method: "POST",
    });
    storyVoteCount.textContent = payload.count;
    storyVoteButton.textContent = payload.alreadyVoted ? "Ya has votado" : "Voto registrado";
    storyVoteButton.classList.add("is-voted");
    const voted = storyPhotos.find((photo) => photo.id === currentStoryPhotoId);
    if (voted) voted.voteCount = payload.count;
  } catch (error) {
    storyVoteButton.disabled = false;
    storyVoteButton.textContent = "No se pudo votar. Reintentar";
  }
}

storyVoteButton?.addEventListener("click", castStoryVote);

function openStory(trace) {
  selectedTraceId = trace.id;
  storyPhotos = trace.photos && trace.photos.length ? trace.photos : [{ id: trace.id, url: trace.photo, voteCount: 0 }];
  renderStoryThumbs();
  setStoryPhoto(0);
  document.querySelector("#storyImage").alt = `Fotografia subida por ${trace.name}`;
  document.querySelector("#storyEmotion").textContent = emotionLabels[trace.emotion];
  document.querySelector("#storyEmotion").className = `emotion ${trace.emotion}`;
  document.querySelector("#storyTitle").textContent = trace.name;
  document.querySelector("#storyLocation").textContent = `${trace.city}, ${trace.country}`;
  document.querySelector("#storyFeeling").textContent = trace.feeling;
  document.querySelector("#storyRelation").textContent = trace.relation;
  document.querySelector("#storyDate").textContent = new Intl.DateTimeFormat("es-ES", { dateStyle: "medium" }).format(new Date(trace.createdAt));
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
  setStat("#overlayStatTotal", approved.length);
  setStat("#overlayStatCountries", countries);
  setStat("#overlayStatCities", cities);
}

const HERO_POLAROID_FALLBACKS = [
  { photo: "/uploads/824f6704-0caa-4882-9786-6b79f5e9b6f6.jpg", city: "Berlin" },
  { photo: "/uploads/4bbd2721-5fd7-4132-8faa-158c564ee03f.jpg", city: "Buenos Aires" },
  { photo: "/uploads/b930a5a2-5c60-416b-aade-1e48a13532cf.jpg", city: "Tokio" },
  { photo: "/uploads/d4ab0d26-2df6-4c90-adad-dd3fe135f423.jpg", city: "Estambul" },
];

function renderHeroPolaroids() {
  const approved = approvedTraces()
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const cards = [
    document.querySelector("#heroPolaroidLeft"),
    document.querySelector("#heroPolaroidRight"),
    document.querySelector("#heroPolaroidLeftBack"),
    document.querySelector("#heroPolaroidRightBack"),
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

let photoPreviewUrls = [];

function revokePhotoPreviewUrls() {
  photoPreviewUrls.forEach((url) => URL.revokeObjectURL(url));
  photoPreviewUrls = [];
}

function filesToFileList(files) {
  const dataTransfer = new DataTransfer();
  files.forEach((file) => dataTransfer.items.add(file));
  return dataTransfer.files;
}

function setPhotoMessage(message) {
  photoMessage.textContent = message;
  photoMessage.hidden = !message;
}

function renderPhotoPreviews() {
  revokePhotoPreviewUrls();
  const files = Array.from(photoInput.files);
  photoPreviews.innerHTML = "";
  photoPreviews.hidden = files.length === 0;

  files.forEach((file, index) => {
    const url = URL.createObjectURL(file);
    photoPreviewUrls.push(url);

    const figure = document.createElement("figure");
    figure.className = "file-preview";

    const img = document.createElement("img");
    img.src = url;
    img.alt = file.name;
    figure.appendChild(img);

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "file-preview-remove";
    removeButton.setAttribute("aria-label", `Quitar ${file.name}`);
    removeButton.textContent = "×";
    removeButton.addEventListener("click", () => removePhotoAt(index));
    figure.appendChild(removeButton);

    photoPreviews.appendChild(figure);
  });
}

function removePhotoAt(index) {
  const remaining = Array.from(photoInput.files).filter((_, i) => i !== index);
  photoInput.files = filesToFileList(remaining);
  if (remaining.length === 0) setPhotoMessage("");
  renderPhotoPreviews();
}

function resetPhotoField() {
  revokePhotoPreviewUrls();
  photoPreviews.innerHTML = "";
  photoPreviews.hidden = true;
  setPhotoMessage("");
  photoDropZone.classList.remove("is-dragover");
}

photoInput.addEventListener("change", () => {
  const files = Array.from(photoInput.files);
  if (files.length > MAX_PHOTOS) {
    setPhotoMessage(`Solo puedes seleccionar hasta ${MAX_PHOTOS} fotografias. Se han descartado las demas.`);
    photoInput.files = filesToFileList(files.slice(0, MAX_PHOTOS));
  } else {
    setPhotoMessage("");
  }
  renderPhotoPreviews();
});

["dragenter", "dragover"].forEach((eventName) => {
  photoInput.addEventListener(eventName, () => photoDropZone.classList.add("is-dragover"));
});
["dragleave", "drop"].forEach((eventName) => {
  photoInput.addEventListener(eventName, () => photoDropZone.classList.remove("is-dragover"));
});

// City picker: search Nominatim (proxied through our API) for a place name,
// then drop a draggable marker on a small map at the exact result the user
// picked. The marker's position IS what gets submitted as lat/lng, so the
// point that lands on the public map always matches what the user placed.
let pickerMap = null;
let pickerMarker = null;

function setLocationMessage(message) {
  locationMessage.textContent = message;
  locationMessage.hidden = !message;
}

function ensurePickerMap(lat, lng) {
  if (pickerMap) return;
  locationMapEl.hidden = false;
  pickerMap = L.map(locationMapEl, { zoomControl: true }).setView([lat, lng], 12);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?key=cb1_3lqo_2_adc208e454c29d5f597d933b", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: "abcd",
    maxZoom: 20,
  }).addTo(pickerMap);
  pickerMarker = L.marker([lat, lng], { draggable: true }).addTo(pickerMap);
  pickerMarker.on("dragend", () => {
    const { lat: draggedLat, lng: draggedLng } = pickerMarker.getLatLng();
    traceLatHidden.value = draggedLat;
    traceLngHidden.value = draggedLng;
  });
  // Leaflet needs a sized container; it was `hidden` until now so it never
  // received a layout pass.
  requestAnimationFrame(() => pickerMap.invalidateSize());
}

function selectPlace(place) {
  citySearchInput.value = `${place.city}, ${place.country}`;
  citySearchResults.hidden = true;
  citySearchResults.innerHTML = "";
  traceCityHidden.value = place.city;
  traceCountryHidden.value = place.country;
  traceLatHidden.value = place.lat;
  traceLngHidden.value = place.lng;
  setLocationMessage("");
  locationSummary.hidden = false;
  locationSummary.textContent = `Ubicacion: ${place.displayName}. Arrastra el marcador para ajustarla.`;

  if (pickerMap) {
    pickerMap.setView([place.lat, place.lng], 12);
    pickerMarker.setLatLng([place.lat, place.lng]);
  } else {
    ensurePickerMap(place.lat, place.lng);
  }
}

let citySearchDebounce = null;
citySearchInput.addEventListener("input", () => {
  const query = citySearchInput.value.trim();
  traceCityHidden.value = "";
  traceCountryHidden.value = "";
  traceLatHidden.value = "";
  traceLngHidden.value = "";

  clearTimeout(citySearchDebounce);
  if (query.length < 2) {
    citySearchResults.hidden = true;
    citySearchResults.innerHTML = "";
    return;
  }

  citySearchDebounce = setTimeout(async () => {
    let payload;
    try {
      payload = await apiRequest(`/geocode/search?q=${encodeURIComponent(query)}`);
    } catch {
      return;
    }
    const results = payload.results ?? [];
    citySearchResults.innerHTML = "";
    citySearchResults.hidden = results.length === 0;
    results.forEach((place) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = place.displayName;
      button.addEventListener("click", () => selectPlace(place));
      item.appendChild(button);
      citySearchResults.appendChild(item);
    });
  }, 350);
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const status = document.querySelector("#formStatus");

  if (!traceLatHidden.value || !traceLngHidden.value) {
    setLocationMessage("Busca tu ciudad y elige un resultado del mapa antes de continuar.");
    return;
  }

  if (!photoInput.files.length) {
    status.textContent = "Selecciona al menos una fotografia para continuar.";
    return;
  }

  status.textContent = "Subiendo contribucion al servidor...";

  try {
    const response = await apiRequest("/traces", {
      method: "POST",
      body: data
    });
    form.reset();
    resetPhotoField();
    locationSummary.hidden = true;
    setLocationMessage("");

    // Display the deletion code (trace id + token, joined) so it can later be
    // pasted as-is into the "eliminar tu foto" form further down the page.
    if (response.deletionToken && response.trace?.id) {
      const deletionCode = `${response.trace.id}:${response.deletionToken}`;
      const tokenMessage = `Recibido. Tu luz esta guardada en el servidor y queda en revision.\n\n⚠️ GUARDA ESTE CODIGO PARA ELIMINAR TU CONTRIBUCION:\n\n${deletionCode}\n\nSi lo pierdes, no podras borrar tu aportacion. Cópialo a un lugar seguro.`;
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
    // The mobile nav's own Escape handling lives in nav-toggle.js, shared
    // with the admin/legal pages that don't load this file.
  }
});

document.querySelector("#heroViewMap")?.addEventListener("click", () => {
  document.querySelector(".map-section")?.scrollIntoView({ behavior: "smooth" });
});

// Self-service deletion: the code shown after uploading is "<trace id>:<deletion
// token>" (see the trace form handler above) joined into one string so a
// visitor only has to copy-paste a single value here, instead of needing two.
const deleteTraceForm = document.querySelector("#deleteTraceForm");
deleteTraceForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = document.querySelector("#deleteTraceStatus");
  const input = document.querySelector("#deleteTraceCode");
  const code = input.value.trim();
  status.classList.remove("error", "success");

  const [traceId, token] = code.split(":");
  if (!traceId || !token) {
    status.textContent = "Codigo no valido. Pega el codigo completo que recibiste al subir tu foto.";
    status.classList.add("error");
    return;
  }

  status.textContent = "Eliminando...";

  try {
    await apiRequest(`/traces/${encodeURIComponent(traceId)}`, {
      method: "DELETE",
      headers: { "X-Deletion-Token": token },
    });
    deleteTraceForm.reset();
    status.textContent = "Listo. Tu contribucion fue eliminada.";
    status.classList.add("success");
    await loadTraces();
  } catch (error) {
    status.textContent = error.message;
    status.classList.add("error");
  }
});

loadPublicConfig().catch(() => {
  // Si la configuracion publica falla, la portada conserva sus textos por defecto.
});

loadTraces().catch((error) => {
  archiveGrid.innerHTML = `<p class="empty-state">${error.message}</p>`;
});

// Keeps the hero polaroids, map markers, stats and gallery in sync with
// newly approved contributions for anyone who already has the page open,
// without them having to reload. Paused while the tab isn't visible so an
// idle background tab doesn't keep polling, and a failed background refresh
// stays silent rather than replacing already-working content with an error.
const TRACES_POLL_INTERVAL_MS = 60_000;

function pollTraces() {
  if (document.hidden) return;
  loadTraces().catch(() => {});
}

setInterval(pollTraces, TRACES_POLL_INTERVAL_MS);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) pollTraces();
});
