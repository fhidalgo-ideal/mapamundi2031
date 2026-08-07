const API_BASE = "/api";

let adminToken = sessionStorage.getItem("granada2031.adminToken") || "";
let adminTraces = [];

const adminLoginForm = document.querySelector("#adminLoginForm");
const adminStatus = document.querySelector("#adminStatus");
const adminLogout = document.querySelector("#adminLogout");
const reviewList = document.querySelector("#reviewList");
const pendingCount = document.querySelector("#pendingCount");

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
}

function renderReviewList() {
  reviewList.innerHTML = "";
  if (!adminToken) {
    reviewList.innerHTML = `<p class="empty-state">Introduce la password de administracion para revisar contribuciones.</p>`;
    return;
  }

  const visible = adminTraces.filter((trace) => trace.status === "pending" || trace.status === "approved");
  const template = document.querySelector("#reviewItemTemplate");

  if (visible.length === 0) {
    reviewList.innerHTML = `<p class="empty-state">No hay contribuciones para revisar.</p>`;
    return;
  }

  visible.forEach((trace) => {
    const node = template.content.cloneNode(true);
    const item = node.querySelector("article");
    const img = node.querySelector("img");
    const editForm = node.querySelector(".edit-form");
    img.src = trace.photo;
    img.alt = `Revision de ${trace.name}`;
    node.querySelector(".status-badge").textContent = trace.status === "approved" ? "Aprobada" : "Pendiente";
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

function fillEditForm(form, trace) {
  form.elements.name.value = trace.name;
  form.elements.email.value = trace.email;
  form.elements.city.value = trace.city;
  form.elements.country.value = trace.country;
  form.elements.relation.value = trace.relation;
  form.elements.emotion.value = trace.emotion;
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

loadAdminTraces().catch((error) => {
  adminToken = "";
  sessionStorage.removeItem("granada2031.adminToken");
  adminStatus.textContent = error.message;
  renderAdmin();
});
