const API_BASE = "/api";

let adminToken = sessionStorage.getItem("granada2031.adminToken") || "";
let adminTraces = [];

const adminLoginForm = document.querySelector("#adminLoginForm");
const adminStatus = document.querySelector("#adminStatus");
const adminLogout = document.querySelector("#adminLogout");
const reviewList = document.querySelector("#reviewList");
const pendingCount = document.querySelector("#pendingCount");
const adminCharts = document.querySelector("#adminCharts");
const adminVotes = document.querySelector("#adminVotes");
const votesList = document.querySelector("#votesList");
const chartFrom = document.querySelector("#chartFrom");
const chartTo = document.querySelector("#chartTo");
const chartByDate = document.querySelector("#chartByDate");
const chartByPlace = document.querySelector("#chartByPlace");
const chartByPlaceTitle = document.querySelector("#chartByPlaceTitle");
const chartToggleButtons = document.querySelectorAll(".chart-toggle-btn");
const reviewSearchInput = document.querySelector("#reviewSearch");
const statusFilterButtons = document.querySelectorAll("[data-status-filter]");
const adminQuickLinks = document.querySelector("#adminQuickLinks");
const photosMenu = document.querySelector("#photosMenu");
const photosMenuToggle = document.querySelector("#photosMenuToggle");
let chartGroupBy = "country";
let chartDefaultsSet = false;
let reviewSearchQuery = "";
let reviewStatusFilter = "all";
const reviewPager = document.querySelector("#reviewPager");
const votesPager = document.querySelector("#votesPager");
const PAGE_SIZE = 10;
let reviewPage = 1;
let votesPage = 1;

async function apiRequest(path, options = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, options);
  } catch {
    throw new Error("No hay conexion con la API. Comprueba que server.py esta ejecutandose.");
  }

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : await response.text();

  if (!response.ok) {
    const message = typeof payload === "object" && payload.error
      ? payload.error
      : `La API no respondio correctamente (${response.status}).`;
    throw new Error(message);
  }

  return payload;
}

async function loadAdminTraces() {
  if (!adminToken) {
    adminTraces = [];
    renderAdmin();
    return;
  }

  const payload = await apiRequest("/admin/traces", {
    headers: {
      Authorization: `Bearer ${adminToken}`
    }
  });
  adminTraces = payload.traces;
  renderAdmin();
}

function renderAdmin() {
  pendingCount.textContent = adminTraces.filter((trace) => trace.status === "pending").length;
  adminLoginForm.classList.toggle("hidden", Boolean(adminToken));
  adminLogout.classList.toggle("hidden", !adminToken);
  adminQuickLinks.classList.toggle("hidden", !adminToken);
  renderReviewList();
  renderCharts();
  renderVotes();
}

function normalize(value) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function toDateInputValue(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function toDateKey(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return toDateInputValue(date);
}

function escapeXml(value) {
  return String(value).replace(/[&<>"]/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
  })[char]);
}

function truncateLabel(value, max) {
  return value.length > max ? `${value.slice(0, max - 1)}\u2026` : value;
}

function enumerateDays(from, to) {
  const days = [];
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    return days;
  }
  const cursor = new Date(start);
  while (cursor <= end) {
    days.push(toDateInputValue(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function setChartDefaults() {
  if (chartDefaultsSet) return;
  const today = new Date();
  const start = new Date();
  start.setDate(today.getDate() - 29);
  chartTo.value = toDateInputValue(today);
  chartFrom.value = toDateInputValue(start);
  chartDefaultsSet = true;
}

function renderCharts() {
  if (!adminToken) {
    adminCharts.classList.add("hidden");
    return;
  }
  adminCharts.classList.remove("hidden");
  setChartDefaults();

  const from = chartFrom.value;
  const to = chartTo.value;
  const inRange = adminTraces.filter((trace) => {
    const key = toDateKey(trace.createdAt);
    if (!key) return false;
    if (from && key < from) return false;
    if (to && key > to) return false;
    return true;
  });

  renderDateChart(inRange, from, to);
  renderPlaceChart(inRange);
}

function renderDateChart(traces, from, to) {
  const counts = new Map();
  traces.forEach((trace) => {
    const key = toDateKey(trace.createdAt);
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  });

  let days = enumerateDays(from, to);
  if (days.length === 0) days = [...counts.keys()].sort();
  if (days.length === 0) {
    chartByDate.innerHTML = `<p class="chart-empty">Sin datos en este rango.</p>`;
    return;
  }

  const values = days.map((day) => counts.get(day) || 0);
  const maxValue = Math.max(1, ...values);
  const colW = 26;
  const chartH = 150;
  const topPad = 16;
  const axisH = 30;
  const width = days.length * colW;
  const height = chartH + topPad + axisH;
  const labelEvery = Math.ceil(days.length / 8);

  const bars = days.map((day, index) => {
    const value = values[index];
    const barH = value > 0 ? Math.max((value / maxValue) * chartH, 2) : 0;
    const x = index * colW;
    const y = topPad + (chartH - barH);
    const [, mm, dd] = day.split("-");
    const axisLabel = index % labelEvery === 0 || index === days.length - 1
      ? `<text class="chart-axis-label" x="${x + colW / 2}" y="${topPad + chartH + 18}" text-anchor="middle">${dd}/${mm}</text>`
      : "";
    const valueLabel = value > 0
      ? `<text class="chart-bar-value" x="${x + colW / 2}" y="${y - 4}" text-anchor="middle">${value}</text>`
      : "";
    return `<g><rect class="chart-bar" x="${x + 3}" y="${y}" width="${colW - 6}" height="${barH}" rx="2"><title>${dd}/${mm}: ${value}</title></rect>${valueLabel}${axisLabel}</g>`;
  }).join("");

  chartByDate.innerHTML = `<svg class="chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Contribuciones por dia">${bars}</svg>`;
}

function renderPlaceChart(traces) {
  const counts = new Map();
  traces.forEach((trace) => {
    const raw = (trace[chartGroupBy] || "").trim();
    const key = raw || "Sin especificar";
    counts.set(key, (counts.get(key) || 0) + 1);
  });

  const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  if (entries.length === 0) {
    chartByPlace.innerHTML = `<p class="chart-empty">Sin datos en este rango.</p>`;
    return;
  }

  const maxValue = Math.max(1, ...entries.map((entry) => entry[1]));
  const rowH = 24;
  const gap = 8;
  const labelW = 110;
  const countW = 26;
  const width = 360;
  const barArea = width - labelW - countW;
  const height = entries.length * (rowH + gap);

  const rows = entries.map((entry, index) => {
    const [label, value] = entry;
    const barW = Math.max((value / maxValue) * barArea, 2);
    const y = index * (rowH + gap);
    const full = escapeXml(label);
    const display = escapeXml(truncateLabel(label, 16));
    return `<g>`
      + `<text class="chart-hbar-label" x="0" y="${y + rowH / 2}" dominant-baseline="middle">${display}<title>${full}</title></text>`
      + `<rect class="chart-hbar" x="${labelW}" y="${y + 2}" width="${barW}" height="${rowH - 4}" rx="3"><title>${full}: ${value}</title></rect>`
      + `<text class="chart-hbar-value" x="${labelW + barW + 6}" y="${y + rowH / 2}" dominant-baseline="middle">${value}</text>`
      + `</g>`;
  }).join("");

  const groupLabel = chartGroupBy === "country" ? "pais" : "ciudad";
  chartByPlace.innerHTML = `<svg class="chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Contribuciones por ${groupLabel}">${rows}</svg>`;
}

const STATUS_LABELS = {
  pending: "Pendiente",
  approved: "Aprobada",
  rejected: "Rechazada",
};

function matchesReviewSearch(trace, normalizedQuery) {
  if (!normalizedQuery) return true;
  const haystack = [trace.name, trace.city, trace.country, trace.email]
    .map((value) => normalize(value || ""))
    .join(" ");
  return haystack.includes(normalizedQuery);
}

// Client-side for now: GET /api/admin/traces already returns everything.
// Kept as one helper so moving pagination to the API later only changes
// where the items and total come from, not the UI. Out-of-range pages clamp
// (e.g. after deleting the last card of the last page).
function paginate(items, page) {
  const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const current = Math.min(Math.max(1, page), pages);
  const start = (current - 1) * PAGE_SIZE;
  return { items: items.slice(start, start + PAGE_SIZE), page: current, pages, total: items.length, start };
}

// "‹ Anterior 1 … 4 [5] 6 … 20 Siguiente ›" plus "11–20 de 34". Hidden when
// everything fits on one page. First, last and the current page's
// neighbours are always shown; gaps collapse into an ellipsis.
function renderPager(container, result, onChange) {
  container.innerHTML = "";
  container.classList.toggle("hidden", result.pages < 2);
  if (result.pages < 2) return;

  const addButton = (label, page, { current = false, disabled = false, ariaLabel } = {}) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.disabled = disabled;
    if (ariaLabel) button.setAttribute("aria-label", ariaLabel);
    if (current) button.setAttribute("aria-current", "page");
    button.addEventListener("click", () => onChange(page));
    container.appendChild(button);
  };

  addButton("‹ Anterior", result.page - 1, { disabled: result.page === 1 });
  const shown = [...new Set([1, result.page - 1, result.page, result.page + 1, result.pages])]
    .filter((page) => page >= 1 && page <= result.pages)
    .sort((a, b) => a - b);
  shown.forEach((page, index) => {
    if (index > 0 && page - shown[index - 1] > 1) {
      const gap = document.createElement("span");
      gap.className = "pager-gap";
      gap.textContent = "…";
      container.appendChild(gap);
    }
    addButton(String(page), page, { current: page === result.page, ariaLabel: `Página ${page}` });
  });
  addButton("Siguiente ›", result.page + 1, { disabled: result.page === result.pages });

  const summary = document.createElement("p");
  summary.className = "pager-summary";
  summary.textContent = `${result.start + 1}–${result.start + result.items.length} de ${result.total}`;
  container.appendChild(summary);
}

function renderReviewList() {
  reviewList.innerHTML = "";
  reviewPager.classList.add("hidden");
  if (!adminToken) {
    reviewList.innerHTML = `<p class="empty-state">Introduce la password de administracion para revisar contribuciones.</p>`;
    return;
  }

  const normalizedQuery = normalize(reviewSearchQuery);
  const hasActiveFilters = reviewStatusFilter !== "all" || normalizedQuery.length > 0;
  const visible = adminTraces.filter((trace) => {
    const matchesStatus = reviewStatusFilter === "all" || trace.status === reviewStatusFilter;
    return matchesStatus && matchesReviewSearch(trace, normalizedQuery);
  });
  const template = document.querySelector("#reviewItemTemplate");

  if (visible.length === 0) {
    reviewList.innerHTML = hasActiveFilters
      ? `<p class="empty-state">No hay contribuciones que coincidan con la busqueda.</p>`
      : `<p class="empty-state">No hay contribuciones para revisar.</p>`;
    return;
  }

  const result = paginate(visible, reviewPage);
  reviewPage = result.page;
  renderPager(reviewPager, result, (page) => {
    reviewPage = page;
    renderReviewList();
    document.querySelector("#revision").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  result.items.forEach((trace) => {
    const node = template.content.cloneNode(true);
    const item = node.querySelector("article");
    const img = node.querySelector("img");
    const editForm = node.querySelector(".edit-form");
    // The big image is the one the rotate buttons act on. With several photos,
    // every one (cover included) gets a thumbnail that brings it up there —
    // the 26px thumbnails alone are too small to judge orientation.
    const photos = trace.photos || [{ id: trace.id, url: trace.photo }];
    let shownPhoto = photos[0];
    const showPhoto = (photo, index) => {
      shownPhoto = photo;
      img.src = photo.url;
      img.alt = index === 0 ? `Revision de ${trace.name}` : `Foto ${index + 1} de ${trace.name}`;
    };
    showPhoto(shownPhoto, 0);
    const extraPhotos = node.querySelector(".review-photos-extra");
    extraPhotos.innerHTML = "";
    extraPhotos.classList.toggle("hidden", photos.length < 2);
    if (photos.length > 1) {
      photos.forEach((photo, index) => {
        const thumb = document.createElement("button");
        thumb.type = "button";
        thumb.className = "review-thumb";
        thumb.setAttribute("aria-label", `Ver foto ${index + 1} de ${trace.name}`);
        const thumbImage = document.createElement("img");
        thumbImage.src = photo.url;
        thumbImage.alt = "";
        thumb.appendChild(thumbImage);
        thumb.addEventListener("click", () => showPhoto(photo, index));
        extraPhotos.appendChild(thumb);
      });
    }
    const rotateButtons = node.querySelectorAll(".rotate-photo");
    rotateButtons.forEach((button) => {
      button.addEventListener("click", async () => {
        const photo = shownPhoto;
        rotateButtons.forEach((other) => { other.disabled = true; });
        const rotated = await rotatePhoto(trace, photo, button.dataset.direction);
        rotateButtons.forEach((other) => { other.disabled = false; });
        if (!rotated) return;
        const index = photos.indexOf(photo);
        if (shownPhoto === photo) showPhoto(photo, index);
        const thumbImage = extraPhotos.querySelectorAll("img")[index];
        if (thumbImage) thumbImage.src = photo.url;
      });
    });
    node.querySelector(".status-badge").textContent = STATUS_LABELS[trace.status] || trace.status;
    node.querySelector(".status-badge").className = `status-badge ${trace.status}`;
    node.querySelector("h3").textContent = `${trace.name} - ${trace.city}, ${trace.country}`;
    node.querySelector("p").textContent = trace.feeling;
    node.querySelector("small").textContent = `${trace.email} - ${trace.relation} - ${trace.emotion}`;
    fillEditForm(editForm, trace);
    // Approving an already approved contribution is a no-op; every other
    // action stays available whatever the status.
    node.querySelector(".approve").classList.toggle("hidden", trace.status === "approved");
    node.querySelector(".approve").addEventListener("click", () => updateStatus(trace.id, "approved"));
    node.querySelector(".reject").addEventListener("click", () => updateStatus(trace.id, "rejected"));
    node.querySelector(".edit").addEventListener("click", () => editForm.classList.remove("hidden"));
    node.querySelector(".cancel-edit").addEventListener("click", () => {
      fillEditForm(editForm, trace);
      editForm.classList.add("hidden");
    });
    editForm.addEventListener("submit", (event) => saveTraceEdit(event, trace.id));
    node.querySelector(".delete").addEventListener("click", () => deleteTrace(trace));
    reviewList.appendChild(item);
  });
}

// One row per photo (cover + extras), across every trace — not just
// approved ones, since nothing today stops a photo from being voted on
// before it's approved, and admins should be able to see that.
function flattenPhotosByVotes() {
  const rows = [];
  adminTraces.forEach((trace) => {
    (trace.photos || []).forEach((photo) => {
      rows.push({ photo, trace });
    });
  });
  rows.sort((a, b) => b.photo.voteCount - a.photo.voteCount);
  return rows;
}

// Reuses the review list's own search box to locate the trace a voted photo
// belongs to, instead of adding a second way to jump to a contribution.
function jumpToReview(trace) {
  reviewSearchQuery = trace.name;
  reviewSearchInput.value = trace.name;
  setStatusFilter("all");
  reviewList.scrollIntoView({ behavior: "smooth", block: "start" });
}

// Single entry point for the status filter: the tabs, "Ver en revision" and
// the "Gestión fotos" submenu all go through here, so the active tab (and the
// submenu's current item) always match the list that is shown.
function setStatusFilter(status) {
  reviewStatusFilter = status;
  reviewPage = 1;
  statusFilterButtons.forEach((button) => {
    const active = button.dataset.statusFilter === status;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  photosMenu.querySelectorAll("[data-jump-status]").forEach((link) => {
    link.toggleAttribute("aria-current", link.dataset.jumpStatus === status);
  });
  renderReviewList();
}

function renderVotes() {
  if (!adminToken) {
    adminVotes.classList.add("hidden");
    return;
  }
  adminVotes.classList.remove("hidden");

  const rows = flattenPhotosByVotes();
  votesList.innerHTML = "";
  votesPager.classList.add("hidden");

  if (rows.length === 0) {
    votesList.innerHTML = `<p class="empty-state">Aun no hay fotos.</p>`;
    return;
  }

  const result = paginate(rows, votesPage);
  votesPage = result.page;
  renderPager(votesPager, result, (page) => {
    votesPage = page;
    renderVotes();
    adminVotes.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  result.items.forEach(({ photo, trace }) => {
    const item = document.createElement("article");
    item.className = "votes-item";

    const img = document.createElement("img");
    img.src = photo.url;
    img.alt = `Foto de ${trace.name}`;
    item.appendChild(img);

    const info = document.createElement("div");
    info.className = "votes-item-info";
    const title = document.createElement("h4");
    title.textContent = trace.name;
    const place = document.createElement("small");
    place.textContent = `${trace.city}, ${trace.country}`;
    const badge = document.createElement("span");
    badge.className = `status-badge ${trace.status}`;
    badge.textContent = STATUS_LABELS[trace.status] || trace.status;
    info.append(title, place, badge);
    item.appendChild(info);

    const count = document.createElement("div");
    count.className = "votes-item-count";
    count.append(String(photo.voteCount));
    const countLabel = document.createElement("span");
    countLabel.textContent = "votos";
    count.appendChild(countLabel);
    item.appendChild(count);

    const jumpButton = document.createElement("button");
    jumpButton.type = "button";
    jumpButton.className = "text-button";
    jumpButton.textContent = "Ver en revision";
    jumpButton.addEventListener("click", () => jumpToReview(trace));
    item.appendChild(jumpButton);

    votesList.appendChild(item);
  });
}

function fillEditForm(form, trace) {
  form.elements.feeling.value = trace.feeling;
}

async function updateStatus(id, status) {
  try {
    await apiRequest(`/admin/traces/${id}/status`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ status })
    });
    await loadAdminTraces();
  } catch (error) {
    adminStatus.textContent = error.message;
  }
}

// Updates the photo object in place (it lives in adminTraces) instead of
// reloading everything, so the review list keeps its scroll and selection.
async function rotatePhoto(trace, photo, direction) {
  try {
    const payload = await apiRequest(`/admin/photos/${photo.id}/rotate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ direction })
    });
    photo.url = payload.photo.url;
    if (photo.id === trace.id) trace.photo = photo.url;
    renderVotes();
    return true;
  } catch (error) {
    adminStatus.textContent = error.message;
    return false;
  }
}

async function saveTraceEdit(event, id) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const payload = Object.fromEntries(data.entries());

  try {
    await apiRequest(`/admin/traces/${id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify(payload)
    });
    adminStatus.textContent = "Contribucion actualizada.";
    await loadAdminTraces();
  } catch (error) {
    adminStatus.textContent = error.message;
  }
}

async function deleteTrace(trace) {
  const confirmed = window.confirm(`Borrar definitivamente la contribucion de ${trace.name}? Esta accion no se puede deshacer.`);
  if (!confirmed) return;

  try {
    await apiRequest(`/admin/traces/${trace.id}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${adminToken}`
      }
    });
    adminStatus.textContent = "Contribucion borrada.";
    await loadAdminTraces();
  } catch (error) {
    adminStatus.textContent = error.message;
  }
}

adminLoginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(adminLoginForm);
  adminStatus.textContent = "Verificando acceso...";

  try {
    const payload = await apiRequest("/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: data.get("password") })
    });
    adminToken = payload.token;
    sessionStorage.setItem("granada2031.adminToken", adminToken);
    adminLoginForm.reset();
    adminStatus.textContent = "Acceso concedido.";
    await loadAdminTraces();
  } catch (error) {
    adminStatus.textContent = error.message;
  }
});

adminLogout.addEventListener("click", () => {
  adminToken = "";
  adminTraces = [];
  sessionStorage.removeItem("granada2031.adminToken");
  adminStatus.textContent = "Sesion cerrada.";
  renderAdmin();
});

chartFrom.addEventListener("change", renderCharts);
chartTo.addEventListener("change", renderCharts);
chartToggleButtons.forEach((button) => {
  button.addEventListener("click", () => {
    chartGroupBy = button.dataset.group;
    chartToggleButtons.forEach((other) => other.classList.toggle("active", other === button));
    chartByPlaceTitle.textContent = chartGroupBy === "country"
      ? "Contribuciones por pais"
      : "Contribuciones por ciudad";
    renderCharts();
  });
});

reviewSearchInput.addEventListener("input", () => {
  reviewSearchQuery = reviewSearchInput.value;
  reviewPage = 1;
  renderReviewList();
});
statusFilterButtons.forEach((button) => {
  button.addEventListener("click", () => setStatusFilter(button.dataset.statusFilter));
});

function setPhotosMenuOpen(open) {
  photosMenu.classList.toggle("hidden", !open);
  photosMenuToggle.setAttribute("aria-expanded", String(open));
}

photosMenuToggle.addEventListener("click", () => {
  setPhotosMenuOpen(photosMenu.classList.contains("hidden"));
});

photosMenu.addEventListener("click", (event) => {
  const link = event.target.closest("[data-jump-status]");
  if (!link) return;
  event.preventDefault();
  // A status jump shows the whole list for that status, not a stale search.
  reviewSearchQuery = "";
  reviewSearchInput.value = "";
  setStatusFilter(link.dataset.jumpStatus);
  setPhotosMenuOpen(false);
  document.querySelector("#revision").scrollIntoView({ behavior: "smooth", block: "start" });
});

// Click outside or Escape closes it (Escape hands focus back to the toggle).
document.addEventListener("click", (event) => {
  if (!event.target.closest(".admin-quick-menu")) setPhotosMenuOpen(false);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !photosMenu.classList.contains("hidden")) {
    setPhotosMenuOpen(false);
    photosMenuToggle.focus();
  }
});

// Reflect the initial "Todas" state (aria-pressed / aria-current) from load.
setStatusFilter(reviewStatusFilter);

// Same brand lockup as the public header: the GRANADA 2031 logo and name come
// from the public config (config.json), with the text fallback when unset.
async function loadBrand() {
  let config;
  try {
    ({ config } = await apiRequest("/config"));
  } catch {
    return; // keep the text fallback; the panel works without it
  }
  if (config.brand_name) document.querySelector("#brandName").textContent = config.brand_name;
  if (config.brand_subtitle) document.querySelector("#brandSubtitle").textContent = config.brand_subtitle;
  const logo = document.querySelector("#brandLogo");
  const hasLogo = Boolean(config.brand_logo);
  if (hasLogo) {
    logo.src = config.brand_logo;
    logo.alt = config.brand_logo_alt || "";
  }
  logo.classList.toggle("hidden", !hasLogo);
  document.querySelector("#brandMark").classList.toggle("hidden", hasLogo);
  document.querySelector("#brandText").classList.toggle("hidden", hasLogo);
  const label = [config.brand_name, config.brand_subtitle].filter(Boolean).join(" | ");
  if (label) document.querySelector("#brandLink").setAttribute("aria-label", label);
}

loadBrand();

loadAdminTraces().catch((error) => {
  adminToken = "";
  sessionStorage.removeItem("granada2031.adminToken");
  adminStatus.textContent = error.message;
  renderAdmin();
});
