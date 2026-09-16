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
let chartGroupBy = "country";
let chartDefaultsSet = false;
let reviewSearchQuery = "";
let reviewStatusFilter = "all";

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

function renderReviewList() {
  reviewList.innerHTML = "";
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

  visible.forEach((trace) => {
    const node = template.content.cloneNode(true);
    const item = node.querySelector("article");
    const img = node.querySelector("img");
    const editForm = node.querySelector(".edit-form");
    img.src = trace.photo;
    img.alt = `Revision de ${trace.name}`;
    const extraPhotos = node.querySelector(".review-photos-extra");
    const extraPhotoEntries = (trace.photos || []).slice(1);
    extraPhotos.innerHTML = "";
    extraPhotos.classList.toggle("hidden", extraPhotoEntries.length === 0);
    extraPhotoEntries.forEach((photo, index) => {
      const extraImage = document.createElement("img");
      extraImage.src = photo.url;
      extraImage.alt = `Foto adicional ${index + 2} de ${trace.name}`;
      extraPhotos.appendChild(extraImage);
    });
    node.querySelector(".status-badge").textContent = STATUS_LABELS[trace.status] || trace.status;
    node.querySelector(".status-badge").className = `status-badge ${trace.status}`;
    node.querySelector("h3").textContent = `${trace.name} - ${trace.city}, ${trace.country}`;
    node.querySelector("p").textContent = trace.feeling;
    node.querySelector("small").textContent = `${trace.email} - ${trace.relation} - ${trace.emotion}`;
    fillEditForm(editForm, trace);
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
  reviewStatusFilter = "all";
  statusFilterButtons.forEach((button) => button.classList.toggle("active", button.dataset.statusFilter === "all"));
  reviewSearchQuery = trace.name;
  reviewSearchInput.value = trace.name;
  renderReviewList();
  reviewList.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderVotes() {
  if (!adminToken) {
    adminVotes.classList.add("hidden");
    return;
  }
  adminVotes.classList.remove("hidden");

  const rows = flattenPhotosByVotes();
  votesList.innerHTML = "";

  if (rows.length === 0) {
    votesList.innerHTML = `<p class="empty-state">Aun no hay fotos.</p>`;
    return;
  }

  rows.forEach(({ photo, trace }) => {
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
  renderReviewList();
});
statusFilterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    reviewStatusFilter = button.dataset.statusFilter;
    statusFilterButtons.forEach((other) => other.classList.toggle("active", other === button));
    renderReviewList();
  });
});

loadAdminTraces().catch((error) => {
  adminToken = "";
  sessionStorage.removeItem("granada2031.adminToken");
  adminStatus.textContent = error.message;
  renderAdmin();
});
