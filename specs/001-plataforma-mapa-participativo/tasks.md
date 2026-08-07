# Tasks: Endurecimiento de producción de la plataforma del mapa participativo

**Input**: Design documents from `specs/001-plataforma-mapa-participativo/`

**Prerequisites**: plan.md, spec.md

**Tests**: Sí — el proyecto no tiene ninguna suite hoy, y FR-012 exige un smoke test como único
gate automatizado. Cada historia de usuario extiende `tests/smoke_test.py` con sus propias
aserciones.

**Organization**: Tareas agrupadas por historia de usuario para poder implementarse y verificarse
de forma independiente. Todas viven en el mismo repositorio (`granada2031`), así que las
dependencias son intra-proyecto.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: puede ejecutarse en paralelo con otras tareas de su misma fase (archivos distintos, sin
  dependencia entre ellas).
- **[Story]**: historia de usuario a la que pertenece (US1..US5). Setup/Foundational no llevan tag.
- Toda tarea incluye rutas de archivo exactas.

## Dependencies (resumen — anula el encadenamiento por defecto entre fases)

- T002 depende de T001.
- T003, T005, T009, T013, T016 dependen de T002 (Foundational) — **no** de la última tarea de la
  fase anterior. Cada historia de usuario arranca en paralelo desde T002.
- T004 depende de T003. T006 y T007 dependen de T005. T008 depende de T006 y T007.
- T010 depende de T009. T011 depende de T010. T012 depende de T011.
- T014 es independiente (solo README). T015 depende de T013.
- T017 depende de T003 (reutiliza el limitador) y de T016. T018 depende de T016 y T017.

---

## Phase 1: Setup

**Purpose**: Preparar el módulo para poder aislar datos en pruebas sin tocar producción.

- [ ] T001 Añadir overrides por variable de entorno para las rutas de almacenamiento en
  `server.py` (líneas 23-28): `GRANADA_DATA_DIR`, `GRANADA_UPLOAD_DIR`, `GRANADA_DB_PATH`,
  `GRANADA_CONFIG_PATH`, `GRANADA_SECRETS_PATH`, cada una con el valor actual como default si no
  está definida. No cambia el comportamiento por defecto (producción sigue igual sin las env
  vars).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Dar a todas las historias una forma automatizada de verificarse, dado que el
proyecto no tiene ninguna prueba hoy.

**⚠️ CRITICAL**: Ninguna historia de usuario se considera verificada sin extender este smoke test.

- [ ] T002 Crear `tests/smoke_test.py` (depende de T001): script `unittest` + `subprocess` +
  `http.client`/`urllib.request`, stdlib puro. Lanza `server.py` en un puerto efímero con las
  env vars de T001 apuntando a un `tempfile.TemporaryDirectory()`, y cubre el flujo feliz
  actual: `GET /api/health`, `GET /api/config`, `POST /api/traces` (con un JPEG mínimo válido de
  fixture), `GET /api/traces` (no visible hasta aprobar), `POST /api/admin/login` +
  `PATCH /api/admin/traces/{id}/status` + `GET /api/admin/traces` (visible tras aprobar). Sale
  con código 0 en éxito, código distinto de 0 y mensaje claro en fallo. Documentar
  `python3 tests/smoke_test.py` en una nueva sección de `README.md`.

**Checkpoint**: A partir de aquí, US1–US5 pueden avanzar en paralelo; todas dependen de T002, no
entre sí salvo lo indicado explícitamente.

---

## Phase 3: User Story 1 - Frenar el spam y el abuso del formulario público (Priority: P1) 🎯 MVP

**Goal**: `POST /api/traces` deja de ser explotable sin límite por bots o repetición.

**Independent Test**: Ver spec.md US1.

- [ ] T003 [US1] Añadir limitador de tasa por IP a `POST /api/traces` en `server.py`: estructura
  en memoria (dict `ip -> lista de timestamps`, ventana deslizante configurable, p. ej. 5
  envíos/hora por IP usando `self.client_address` con fallback a `X-Forwarded-For` si está
  presente), y campo honeypot oculto (`website`) en `index.html`/`app.js` que si llega relleno
  rechaza con el mismo mensaje genérico de error sin crear registro. Al exceder el límite,
  responder `429` con cabecera `Retry-After`.
- [ ] T004 [US1] (depende de T003) Extender `tests/smoke_test.py`: enviar más contribuciones que
  el límite configurado desde la misma IP simulada y esperar `429` a partir de la que excede;
  enviar el formulario con el honeypot relleno y esperar rechazo sin registro creado.

**Checkpoint**: US1 funciona y se verifica de forma independiente.

---

## Phase 4: User Story 2 - Validar y sanear cada imagen subida (Priority: P1)

**Goal**: Ninguna imagen se persiste sin verificar su contenido real, su tamaño de decodificación
y sin haberle quitado los metadatos EXIF.

**Independent Test**: Ver spec.md US2.

- [ ] T005 [US2] (depende de T002) Añadir `sniff_image_signature(header_bytes) -> str | None` en
  `server.py`: compara los primeros bytes del archivo subido contra las firmas binarias de
  JPEG (`FF D8`), PNG (`89 50 4E 47`) y WEBP (`RIFF....WEBP`), independientemente del
  `Content-Type`/extensión declarados en `handle_create_trace`; rechaza si no coincide con
  ninguna firma soportada.
- [ ] T006 [US2] (depende de T005) Añadir `read_image_dimensions(data, kind) -> (int, int)` en
  `server.py`: parsea el ancho/alto desde la cabecera SOF de JPEG, `IHDR` de PNG y el chunk
  `VP8`/`VP8L`/`VP8X` de WEBP sin decodificar la imagen completa; rechazar en
  `handle_create_trace` si excede un máximo configurado (p. ej. 6000x6000 px).
- [ ] T007 [US2] (depende de T005) Añadir `strip_exif(data, kind) -> bytes` en `server.py`:
  elimina el segmento `APP1`/EXIF de JPEG, el chunk `eXIf` de PNG y el chunk `EXIF` de WEBP antes
  de escribir el archivo en `uploads/`; no-op seguro si el formato no trae EXIF.
- [ ] T008 [US2] (depende de T006, T007) Extender `tests/smoke_test.py` con fixtures binarios:
  archivo no-imagen con extensión/`Content-Type` de imagen → rechazado; imagen con dimensiones
  por encima del máximo → rechazada; JPEG de fixture con EXIF GPS conocido → aceptado pero el
  archivo final en `uploads/` ya no contiene ese EXIF.

**Checkpoint**: US1 y US2 funcionan de forma independiente entre sí.

---

## Phase 5: User Story 3 - Consentimiento real y derecho de borrado (RGPD) (Priority: P2)

**Goal**: El consentimiento enviado se respeta de verdad, existe borrado autoservicio, y las
páginas legales referenciadas por `config.json` responden con contenido real.

**Independent Test**: Ver spec.md US3.

- [ ] T009 [US3] (depende de T002) En `handle_create_trace` (`server.py`), sustituir el valor fijo
  `"consent": 1` por la lectura real del campo `consent` del formulario (aceptar
  `"true"/"on"/"1"` como verdadero); rechazar la creación con mensaje claro si no es verdadero.
- [ ] T010 [US3] (depende de T009) Añadir borrado autoservicio: generar un token aleatorio por
  contribución en `handle_create_trace`, devolverlo una sola vez en la respuesta de
  `POST /api/traces`, guardar solo su hash (`deletion_token_hash`, nueva columna en `traces` vía
  migración idempotente en `init_db()`); añadir `DELETE /api/traces/{id}` público (sin
  `require_admin`) que borra registro + fotografía solo si la cabecera `X-Deletion-Token`
  coincide (comparación con `hmac.compare_digest`), devolviendo `403` si no coincide.
- [ ] T011 [US3] (depende de T010) Crear `politica-de-privacidad.html` y `aviso-legal.html` con
  contenido real (RGPD: qué datos se recogen, base legal, plazo de conservación, cómo ejercer el
  derecho de borrado con el token de T010, datos de contacto), servidos por `server.py` en
  `/politica-de-privacidad` y `/aviso-legal` (rutas ya enlazadas desde `config.json` vía
  `privacy_url`/`legal_url` pero hoy 404); añadir claves de texto legal por defecto a
  `DEFAULT_PUBLIC_CONFIG` en `server.py` y mostrar el token de borrado al usuario tras un envío
  exitoso en `index.html`/`app.js` ("guarda este código para borrar tus datos").
- [ ] T012 [US3] (depende de T011) Extender `tests/smoke_test.py`: envío con `consent` falso o
  ausente → rechazado; ciclo completo de borrado (crear → borrar con token incorrecto → `403` →
  borrar con token correcto → `200` → ya no aparece en `GET /api/traces` tras aprobar); `GET
  /politica-de-privacidad` y `GET /aviso-legal` → `200` con cuerpo no vacío.

**Checkpoint**: US1, US2 y US3 funcionan de forma independiente entre sí.

---

## Phase 6: User Story 4 - Cabeceras de seguridad en todas las respuestas (Priority: P2)

**Goal**: Toda respuesta del servidor lleva las cabeceras de seguridad básicas.

**Independent Test**: Ver spec.md US4.

- [ ] T013 [US4] (depende de T002) Añadir `send_security_headers(handler)` en `server.py` y
  aplicarla desde `json_response`/`error_response` y desde un `end_headers` sobrescrito en
  `GranadaHandler` (cubre también las respuestas estáticas de `SimpleHTTPRequestHandler`, incluida
  `/uploads/<archivo>`): `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: strict-origin-when-cross-origin`, `Content-Security-Policy: default-src
  'self'` (ajustada si `index.html`/`admin.html` cargan algo de otro origen).
- [ ] T014 [US4] [P] Actualizar el bloque de Nginx recomendado en `README.md` añadiendo
  `Strict-Transport-Security` y las mismas cabeceras a nivel de proxy como defensa en profundidad
  (complementa T013, no lo sustituye).
- [ ] T015 [US4] (depende de T013) Extender `tests/smoke_test.py`: comprobar que `GET /`,
  `GET /api/health` y `GET /api/traces` incluyen las cuatro cabeceras de T013.

**Checkpoint**: US1–US4 funcionan de forma independiente entre sí.

---

## Phase 7: User Story 5 - Auditoría y freno de fuerza bruta en el panel de administración (Priority: P3)

**Goal**: Cada acción administrativa queda registrada y el login admite un número limitado de
intentos fallidos por IP.

**Independent Test**: Ver spec.md US5.

- [ ] T016 [US5] (depende de T002) Añadir tabla `audit_log` (id, action, trace_id, source_ip,
  created_at) vía migración idempotente en `init_db()`; insertar una fila desde
  `handle_update_status`, `handle_update_trace` y `handle_delete_trace`, y desde
  `handle_admin_login` (éxito y fallo); añadir `GET /api/admin/audit-log` (protegido con
  `require_admin`) paginado por `created_at` descendente.
- [ ] T017 [US5] (depende de T003, T016) Aplicar bloqueo por IP a `POST /api/admin/login`
  reutilizando la estructura del limitador de T003 (contador de fallos por IP, p. ej. máximo 5
  intentos fallidos en 15 minutos → `429` hasta expirar, incluso con contraseña correcta).
- [ ] T018 [US5] (depende de T016, T017) Extender `tests/smoke_test.py`: una acción de
  administración (p. ej. aprobar una contribución) aparece en `GET /api/admin/audit-log`;
  superar el máximo de intentos fallidos de login bloquea intentos posteriores con `429`.

**Checkpoint**: Las cinco historias de usuario funcionan de forma independiente y en conjunto.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sin dependencias, arranca primero.
- **Foundational (Phase 2)**: depende de Setup — bloquea el arranque de toda historia de usuario.
- **User Stories (Phase 3-7)**: todas dependen únicamente de Foundational (T002), no entre sí,
  salvo T017/T018 que además dependen de T003 (US1) por reutilizar su limitador.

### Parallel Opportunities

- Tras T002, US1 (T003), US2 (T005), US3 (T009) y US4 (T013) pueden avanzar en paralelo — tocan
  secciones distintas de `server.py` y no comparten estado entre sí.
- US5 (T016) puede empezar en paralelo con las anteriores, pero T017/T018 deben esperar a que
  T003 (US1) esté mergeada.
- T014 (solo `README.md`) es paralelizable con cualquier otra tarea.

## Notes

- No hay tareas de "Polish" separadas: cada historia ya incluye su propia extensión del smoke
  test como paso final, en vez de una fase de pruebas global al final.
- Commit por tarea, como en el resto del proyecto — cada tarea es independientemente verificable
  ejecutando `python3 tests/smoke_test.py` tras T002.
