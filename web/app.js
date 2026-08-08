const API_BASE = "/api";

const emotionLabels = {
  nostalgia: "Nostalgia",
  pertenencia: "Pertenencia",
  asombro: "Asombro",
  futuro: "Futuro"
};

const mapPointColor = "#f7a94a";
const ARCHIVE_BATCH_SIZE = 8;

let traces = [];
let archiveVisibleCount = ARCHIVE_BATCH_SIZE;
let activeFilter = "all";
let selectedTraceId = null;
let animationFrame;
let mapView = { scale: 1, x: 0, y: 0 };
let isDraggingMap = false;
let dragStart = { x: 0, y: 0, viewX: 0, viewY: 0 };
const activePointers = new Map();
let pinchStart = null;
let wasPinching = false;

const canvas = document.querySelector("#worldMap");
const ctx = canvas.getContext("2d");
const form = document.querySelector("#traceForm");
const archiveGrid = document.querySelector("#archiveGrid");
const archiveLoadMoreButton = document.querySelector("#archiveLoadMore");
const storyPanel = document.querySelector("#storyPanel");
const zoomInButton = document.querySelector("#zoomIn");
const zoomOutButton = document.querySelector("#zoomOut");
const zoomResetButton = document.querySelector("#zoomReset");

async function apiRequest(path, options = {}) {
  if (window.location.protocol === "file:") {
    throw new Error("Abre el MVP desde el servidor Python, no directamente como archivo. Ejecuta: python3 server.py --host 0.0.0.0 --port 8080");
  }

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, options);
  } catch {
    throw new Error("No hay conexion con la API. Comprueba que server.py esta ejecutandose y abre la URL del servidor, por ejemplo http://localhost:8080.");
  }

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : await response.text();

  if (!response.ok) {
    if (response.status === 404 && !contentType.includes("application/json")) {
      throw new Error("La ruta /api/traces devuelve 404 fuera de server.py. Revisa Nginx o arranca la app con: python3 server.py --host 0.0.0.0 --port 8080");
    }

    const message = typeof payload === "object" && payload.error
      ? payload.error
      : `La API no respondio correctamente (${response.status}). Asegurate de abrir la web desde server.py, no desde un servidor estatico.`;
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

function project(lat, lng) {
  const base = {
    x: ((lng + 180) / 360) * canvas.width,
    y: ((90 - lat) / 180) * canvas.height
  };

  const europeCenter = {
    x: ((12 + 180) / 360) * canvas.width,
    y: ((90 - 49) / 180) * canvas.height
  };
  const dx = base.x - europeCenter.x;
  const dy = base.y - europeCenter.y;
  const distance = Math.hypot(dx / 250, dy / 170);
  const influence = Math.exp(-(distance * distance));
  const scale = 1 + influence * 0.95;

  return {
    x: europeCenter.x + dx * scale,
    y: europeCenter.y + dy * scale
  };
}

function screenToWorld(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const screenX = (clientX - rect.left) * scaleX;
  const screenY = (clientY - rect.top) * scaleY;

  return {
    x: (screenX - mapView.x) / mapView.scale,
    y: (screenY - mapView.y) / mapView.scale,
    screenX,
    screenY
  };
}

function zoomMap(factor, anchorX = canvas.width / 2, anchorY = canvas.height / 2) {
  const nextScale = Math.max(1, Math.min(7, mapView.scale * factor));
  const worldX = (anchorX - mapView.x) / mapView.scale;
  const worldY = (anchorY - mapView.y) / mapView.scale;
  mapView = {
    scale: nextScale,
    x: anchorX - worldX * nextScale,
    y: anchorY - worldY * nextScale
  };
  clampMapView();
}

function resetMapView() {
  mapView = { scale: 1, x: 0, y: 0 };
}

function setMapZoom(scale, anchorX, anchorY) {
  const nextScale = Math.max(1, Math.min(7, scale));
  const worldX = (anchorX - mapView.x) / mapView.scale;
  const worldY = (anchorY - mapView.y) / mapView.scale;
  mapView = {
    scale: nextScale,
    x: anchorX - worldX * nextScale,
    y: anchorY - worldY * nextScale
  };
  clampMapView();
}

function clampMapView() {
  if (mapView.scale <= 1) {
    resetMapView();
    return;
  }

  const maxX = canvas.width * (mapView.scale - 1);
  const maxY = canvas.height * (mapView.scale - 1);
  mapView.x = Math.min(0, Math.max(-maxX, mapView.x));
  mapView.y = Math.min(0, Math.max(-maxY, mapView.y));
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

function drawMap(time = 0) {
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);

  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "#111e31");
  gradient.addColorStop(1, "#07111f");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.translate(mapView.x, mapView.y);
  ctx.scale(mapView.scale, mapView.scale);
  drawGrid(width, height);
  drawLand();
  drawEuropeDetail();
  drawConnections(time);
  drawLights(time);
  ctx.restore();

  animationFrame = requestAnimationFrame(drawMap);
}

function drawEuropeDetail() {
  const countries = [
    { shape: [[-9.5, 42.2], [-6.3, 41.8], [-6.6, 37.0], [-8.9, 36.9], [-9.5, 42.2]] },
    { shape: [[-9.3, 43.7], [3.3, 42.5], [2.9, 39.0], [-0.7, 36.0], [-6.0, 36.0], [-9.0, 38.7], [-9.3, 43.7]] },
    { shape: [[-5.0, 51.0], [2.0, 51.2], [7.7, 48.5], [7.2, 43.8], [3.0, 42.5], [-1.8, 43.4], [-5.0, 48.5], [-5.0, 51.0]] },
    { shape: [[-10.6, 55.4], [-6.0, 55.2], [-6.2, 51.4], [-10.4, 51.6], [-10.6, 55.4]] },
    { shape: [[-6.3, 58.8], [-1.0, 58.4], [1.6, 53.8], [0.2, 50.6], [-5.7, 50.1], [-7.4, 55.0], [-6.3, 58.8]] },
    { shape: [[2.4, 51.5], [6.4, 51.2], [6.0, 49.5], [2.5, 49.6], [2.4, 51.5]] },
    { shape: [[3.4, 53.6], [7.1, 53.4], [6.5, 51.2], [3.2, 51.4], [3.4, 53.6]] },
    { shape: [[6.0, 55.1], [14.7, 54.8], [15.1, 50.1], [12.0, 47.3], [7.7, 47.6], [6.0, 50.0], [6.0, 55.1]] },
    { shape: [[6.0, 47.8], [10.5, 47.8], [10.4, 45.8], [6.2, 46.0], [6.0, 47.8]] },
    { shape: [[9.5, 48.9], [17.2, 48.8], [16.7, 46.4], [10.2, 46.2], [9.5, 48.9]] },
    { shape: [[7.5, 45.9], [12.5, 46.4], [14.5, 43.8], [16.4, 41.5], [18.3, 39.0], [16.0, 37.3], [12.6, 41.2], [9.1, 44.0], [7.5, 45.9]] },
    { shape: [[8.0, 57.8], [12.8, 57.5], [12.2, 54.6], [8.4, 54.8], [8.0, 57.8]] },
    { shape: [[4.5, 58.2], [12.0, 61.8], [18.5, 68.0], [25.0, 71.0], [29.0, 69.0], [21.5, 64.0], [12.5, 58.0], [4.5, 58.2]] },
    { shape: [[11.0, 58.0], [18.0, 56.5], [24.0, 65.0], [21.0, 69.3], [14.0, 66.0], [11.0, 58.0]] },
    { shape: [[20.0, 60.0], [31.0, 60.5], [31.2, 69.5], [24.0, 70.0], [20.0, 64.5], [20.0, 60.0]] },
    { shape: [[14.2, 54.8], [24.2, 54.2], [24.0, 49.1], [15.0, 49.0], [14.2, 54.8]] },
    { shape: [[12.0, 51.1], [18.8, 50.7], [18.0, 48.6], [12.2, 48.7], [12.0, 51.1]] },
    { shape: [[14.0, 46.5], [23.5, 46.0], [27.0, 42.0], [20.0, 39.0], [15.0, 42.0], [14.0, 46.5]] },
    { shape: [[20.0, 40.2], [26.0, 41.0], [28.0, 37.0], [23.0, 35.0], [20.0, 37.5], [20.0, 40.2]] },
    { shape: [[26.0, 42.0], [42.0, 41.0], [43.2, 37.0], [28.0, 36.0], [26.0, 42.0]] },
    { shape: [[-13.0, 35.8], [-1.0, 35.8], [-2.0, 28.5], [-10.0, 27.0], [-13.0, 35.8]] }
  ];
  const labels = [
    ["Espana", 40.1, -3.7],
    ["Francia", 46.2, 2.1],
    ["Alemania", 51.0, 10.0],
    ["Italia", 42.8, 12.4],
    ["Reino Unido", 54.0, -2.8],
    ["Suecia", 61.0, 16.5],
    ["Polonia", 52.1, 19.0],
    ["Marruecos", 32.0, -6.0]
  ];

  ctx.save();
  ctx.fillStyle = "rgba(247, 198, 103, .055)";
  ctx.strokeStyle = "rgba(246, 241, 232, .34)";
  ctx.lineWidth = 1.2 / mapView.scale;
  countries.forEach((country) => {
    ctx.beginPath();
    country.shape.forEach(([lng, lat], index) => {
      const point = project(lat, lng);
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  });

  ctx.fillStyle = "rgba(246, 241, 232, .7)";
  ctx.font = `700 ${Math.max(8, 12 / Math.sqrt(mapView.scale))}px Inter, Arial, sans-serif`;
  labels.forEach(([label, lat, lng]) => {
    const point = project(lat, lng);
    ctx.fillText(label, point.x + 5, point.y - 6);
  });

  const granada = project(37.1773, -3.5986);
  ctx.fillStyle = "#f7c667";
  ctx.font = `800 ${Math.max(9, 14 / Math.sqrt(mapView.scale))}px Inter, Arial, sans-serif`;
  ctx.fillText("Granada", granada.x + 9, granada.y + 4);
  ctx.restore();
}

function drawGrid(width, height) {
  ctx.strokeStyle = "rgba(255,255,255,.08)";
  ctx.lineWidth = 1 / mapView.scale;

  for (let lng = -150; lng <= 180; lng += 30) {
    const x = project(0, lng).x;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }

  for (let lat = -60; lat <= 60; lat += 30) {
    const y = project(lat, 0).y;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
}

function drawLand() {
  const shapes = [
    [[-168, 71], [-150, 72], [-135, 69], [-124, 61], [-116, 50], [-104, 49], [-95, 55], [-82, 51], [-64, 48], [-53, 58], [-58, 45], [-76, 36], [-81, 25], [-97, 19], [-111, 24], [-124, 39], [-137, 45], [-152, 58], [-168, 71]],
    [[-86, 14], [-77, 9], [-70, 11], [-60, 7], [-50, -5], [-44, -18], [-49, -31], [-58, -46], [-68, -55], [-76, -42], [-79, -25], [-84, -10], [-86, 14]],
    [[-17, 36], [-10, 44], [0, 50], [10, 56], [23, 58], [33, 55], [40, 47], [33, 41], [21, 38], [13, 42], [2, 44], [-6, 43], [-10, 36], [-17, 36]],
    [[-17, 35], [-6, 37], [8, 36], [23, 32], [34, 31], [43, 15], [51, 9], [44, -12], [33, -28], [21, -35], [10, -31], [2, -18], [-8, 4], [-17, 20], [-17, 35]],
    [[38, 57], [55, 67], [82, 72], [115, 72], [142, 62], [164, 55], [172, 43], [154, 28], [126, 19], [108, 7], [96, 16], [78, 23], [65, 20], [53, 30], [41, 36], [31, 45], [38, 57]],
    [[100, 5], [112, -8], [128, -8], [142, -18], [154, -28], [153, -41], [135, -44], [117, -36], [108, -24], [100, 5]],
    [[-52, 60], [-42, 68], [-26, 73], [-12, 70], [-18, 61], [-35, 59], [-52, 60]],
    [[-180, -72], [-120, -70], [-60, -72], [0, -70], [60, -72], [120, -70], [180, -72], [180, -84], [-180, -84], [-180, -72]]
  ];

  ctx.fillStyle = "rgba(114, 139, 146, .18)";
  ctx.strokeStyle = "rgba(188, 208, 214, .28)";
  ctx.lineWidth = 2 / mapView.scale;

  shapes.forEach((shape) => {
    ctx.beginPath();
    shape.forEach(([lng, lat], index) => {
      const point = project(lat, lng);
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  });

  const coastDetails = [
    [[-10, 36], [-6, 43], [2, 43], [8, 44], [13, 45], [18, 41], [25, 39], [30, 41], [36, 45]],
    [[-6, 50], [2, 51], [8, 50], [15, 52], [24, 55], [31, 58]],
    [[-74, 40], [-82, 31], [-90, 20], [-82, 9], [-78, -5], [-74, -16], [-70, -32], [-66, -50]],
    [[45, 30], [58, 23], [72, 19], [88, 22], [104, 10], [119, 0], [130, -5]],
    [[118, 36], [125, 43], [139, 39], [146, 45], [142, 54], [132, 50]],
    [[-125, 49], [-118, 35], [-107, 25], [-98, 19], [-90, 29], [-78, 36], [-67, 45]]
  ];

  ctx.strokeStyle = "rgba(246, 241, 232, .16)";
  ctx.lineWidth = 1 / mapView.scale;
  coastDetails.forEach((line) => {
    ctx.beginPath();
    line.forEach(([lng, lat], index) => {
      const point = project(lat, lng);
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();
  });
}

function drawConnections(time) {
  const granada = project(37.1773, -3.5986);

  visibleTraces().forEach((trace, index) => {
    const point = project(trace.lat, trace.lng);
    const pulse = (Math.sin(time / 700 + index) + 1) / 2;
    ctx.strokeStyle = `rgba(247, 198, 103, ${0.12 + pulse * 0.18})`;
    ctx.lineWidth = 1.2 / mapView.scale;
    ctx.beginPath();
    const midX = (granada.x + point.x) / 2;
    const midY = Math.min(granada.y, point.y) - 90;
    ctx.moveTo(granada.x, granada.y);
    ctx.quadraticCurveTo(midX, midY, point.x, point.y);
    ctx.stroke();
  });
}

function drawLights(time) {
  visibleTraces().forEach((trace, index) => {
    const point = project(trace.lat, trace.lng);
    const color = mapPointColor;
    const isSelected = trace.id === selectedTraceId;
    const pulse = (Math.sin(time / 420 + index * 1.8) + 1) / 2;
    const radius = (isSelected ? 10 : 6) / Math.sqrt(mapView.scale);
    const glowRadius = (30 + pulse * 12) / Math.sqrt(mapView.scale);

    const glow = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, glowRadius);
    glow.addColorStop(0, color);
    glow.addColorStop(0.25, `${color}aa`);
    glow.addColorStop(1, `${color}00`);
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(point.x, point.y, glowRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius + (pulse * 2) / Math.sqrt(mapView.scale), 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "rgba(255,255,255,.72)";
    ctx.lineWidth = (isSelected ? 2 : 1) / mapView.scale;
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius + 5 / Math.sqrt(mapView.scale), 0, Math.PI * 2);
    ctx.stroke();
  });
}

function findTraceAt(clientX, clientY) {
  const { x, y } = screenToWorld(clientX, clientY);

  return visibleTraces().find((trace) => {
    const point = project(trace.lat, trace.lng);
    return Math.hypot(point.x - x, point.y - y) < 34 / mapView.scale;
  });
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
    closeStory();
  });
});

canvas.addEventListener("pointerdown", (event) => {
  activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  canvas.setPointerCapture(event.pointerId);

  if (activePointers.size === 2) {
    wasPinching = true;
    const points = Array.from(activePointers.values());
    const first = screenToWorld(points[0].x, points[0].y);
    const second = screenToWorld(points[1].x, points[1].y);
    pinchStart = {
      distance: Math.hypot(first.screenX - second.screenX, first.screenY - second.screenY),
      scale: mapView.scale,
      anchorX: (first.screenX + second.screenX) / 2,
      anchorY: (first.screenY + second.screenY) / 2
    };
    isDraggingMap = false;
    return;
  }

  isDraggingMap = true;
  dragStart = {
    x: event.clientX,
    y: event.clientY,
    viewX: mapView.x,
    viewY: mapView.y
  };
});

canvas.addEventListener("pointermove", (event) => {
  if (activePointers.has(event.pointerId)) {
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  }

  if (activePointers.size === 2 && pinchStart) {
    const points = Array.from(activePointers.values());
    const first = screenToWorld(points[0].x, points[0].y);
    const second = screenToWorld(points[1].x, points[1].y);
    const distance = Math.hypot(first.screenX - second.screenX, first.screenY - second.screenY);
    const anchorX = (first.screenX + second.screenX) / 2;
    const anchorY = (first.screenY + second.screenY) / 2;
    setMapZoom(pinchStart.scale * (distance / pinchStart.distance), anchorX, anchorY);
    canvas.style.cursor = "grabbing";
    return;
  }

  if (isDraggingMap) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    mapView.x = dragStart.viewX + (event.clientX - dragStart.x) * scaleX;
    mapView.y = dragStart.viewY + (event.clientY - dragStart.y) * scaleY;
    clampMapView();
    canvas.style.cursor = "grabbing";
    return;
  }

  canvas.style.cursor = findTraceAt(event.clientX, event.clientY) ? "pointer" : "grab";
});

canvas.addEventListener("pointerup", (event) => {
  const moved = Math.hypot(event.clientX - dragStart.x, event.clientY - dragStart.y);
  activePointers.delete(event.pointerId);
  pinchStart = null;
  isDraggingMap = false;
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  canvas.style.cursor = "grab";
  if (activePointers.size > 0) return;
  if (wasPinching) {
    wasPinching = false;
    return;
  }
  if (moved > 6) return;

  const trace = findTraceAt(event.clientX, event.clientY);
  if (trace) openStory(trace);
});

canvas.addEventListener("pointercancel", (event) => {
  activePointers.delete(event.pointerId);
  pinchStart = null;
  wasPinching = false;
  isDraggingMap = false;
  canvas.style.cursor = "grab";
});

canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  const { screenX, screenY } = screenToWorld(event.clientX, event.clientY);
  zoomMap(event.deltaY < 0 ? 1.18 : 0.84, screenX, screenY);
}, { passive: false });

zoomInButton.addEventListener("click", () => zoomMap(1.35));
zoomOutButton.addEventListener("click", () => zoomMap(0.75));
zoomResetButton.addEventListener("click", resetMapView);

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

window.addEventListener("beforeunload", () => cancelAnimationFrame(animationFrame));

loadPublicConfig().catch(() => {
  // Si la configuracion publica falla, la portada conserva sus textos por defecto.
});

loadTraces().catch((error) => {
  archiveGrid.innerHTML = `<p class="empty-state">${error.message}</p>`;
});
drawMap();
