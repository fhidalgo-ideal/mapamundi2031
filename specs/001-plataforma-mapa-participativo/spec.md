# Feature Specification: Endurecimiento de producción de la plataforma del mapa participativo

**Feature Branch**: `001-plataforma-mapa-participativo`

**Created**: 2026-08-07

**Status**: Ready for Planning

**Input**: MVP de "Geolocalización del Sentimiento" (Granada 2031) ya funcional en `server.ts`
(Bun + `bun:sqlite`; originalmente `server.py` con Python 3 stdlib, reescrito manteniendo la misma
API) con formulario público de contribución y panel de administración.
El propio `README.md` (sección "Nota de seguridad para producción") deja pendiente, antes de
publicar: autenticación de la cola de revisión, HTTPS, RGPD completo, escaneo/normalización de
imágenes, límites por IP/anti-spam y separación entre API pública y panel de administración.
Auditoría del código confirma el estado real de cada punto (ver Assumptions).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Frenar el spam y el abuso del formulario público (Priority: P1)

Como responsable de la campaña, necesito que `POST /api/traces` no pueda ser inundado por bots
ni por un mismo visitante repitiendo envíos, para que la cola de revisión siga siendo utilizable
y el almacenamiento no se llene de contribuciones basura.

**Why this priority**: El endpoint es público, sin ningún límite hoy. Es el vector de abuso más
barato de explotar y el que más rápido degrada el servicio si el mapa se hace visible.

**Independent Test**: Enviar más de N contribuciones válidas desde la misma IP en una ventana
corta y comprobar que las que exceden el límite devuelven `429` con `Retry-After`; enviar el
formulario con el campo señuelo (honeypot) relleno y comprobar que se rechaza sin crear registro.

**Acceptance Scenarios**:

1. **Given** una IP que ya ha enviado el máximo de contribuciones permitidas en la ventana
   configurada, **When** envía una contribución más, **Then** la API responde `429 Too Many
   Requests` con cabecera `Retry-After` y no se crea ninguna fila en `traces`.
2. **Given** un envío `POST /api/traces` con el campo honeypot relleno, **When** el servidor lo
   procesa, **Then** se rechaza sin crear registro y sin filtrarle al remitente pistas de que fue
   detectado como bot (mismo mensaje de error genérico).

---

### User Story 2 - Validar y sanear cada imagen subida antes de guardarla (Priority: P1)

Como responsable de la campaña, necesito que ninguna imagen subida pueda ser un archivo
disfrazado, una bomba de descompresión, ni filtrar metadatos EXIF de ubicación del contribuyente,
para proteger tanto el servidor como la privacidad de quien participa.

**Why this priority**: Hoy la validación de imagen se basa solo en el `Content-Type` declarado y
la extensión — no en el contenido real del archivo. Es una superficie de ataque directa sobre un
endpoint público y, además, una fuga de privacidad no advertida (fotos con GPS EXIF).

**Independent Test**: Subir un archivo con extensión/`Content-Type` de imagen pero contenido no
válido (no son los bytes mágicos esperados) y comprobar el rechazo; subir una imagen con
dimensiones desproporcionadas y comprobar el rechazo; subir una foto JPEG con EXIF GPS conocido y
comprobar que el archivo guardado en `uploads/` ya no contiene ese EXIF.

**Acceptance Scenarios**:

1. **Given** un archivo cuyos primeros bytes no coinciden con ninguna firma JPEG/PNG/WEBP
   soportada, **When** se envía como `photo` en `POST /api/traces` (con cualquier `Content-Type`
   declarado), **Then** la API responde error de formato no permitido y no escribe nada en
   `uploads/`.
2. **Given** una imagen cuyas dimensiones declaradas en su propia cabecera superan el máximo
   configurado, **When** se sube, **Then** se rechaza antes de persistirla.
3. **Given** una imagen JPEG válida que contiene un segmento EXIF con coordenadas GPS, **When** se
   acepta y persiste, **Then** el archivo resultante en `uploads/` ya no contiene ese segmento
   EXIF.

---

### User Story 3 - Consentimiento real y ejercicio del derecho de borrado (RGPD) (Priority: P2)

Como contribuyente, necesito que mi consentimiento se registre de verdad (no un valor fijo) y
tener una forma de borrar mis datos sin depender de escribir a un administrador, y como
responsable de la campaña necesito que los enlaces legales del pie de página funcionen.

**Why this priority**: El código actual ignora el valor real del checkbox de consentimiento
(queda grabado como `1` sin comprobar lo enviado) y las URLs de política de privacidad / aviso
legal referenciadas en `config.json` devuelven 404. Es un incumplimiento RGPD activo, no solo un
riesgo futuro.

**Independent Test**: Enviar el formulario con el consentimiento sin marcar y comprobar el
rechazo; crear una contribución, guardar el token de borrado devuelto, y usarlo para borrarla sin
ninguna sesión de administrador; visitar `/politica-de-privacidad` y `/aviso-legal` y comprobar
`200` con contenido real.

**Acceptance Scenarios**:

1. **Given** un envío de formulario sin el consentimiento marcado (o con un valor no verdadero),
   **When** llega a `POST /api/traces`, **Then** la API rechaza la creación con un mensaje claro y
   no persiste el registro.
2. **Given** una contribución creada con éxito, **When** su autor presenta el token de borrado
   recibido en la respuesta de creación contra el endpoint público de borrado, **Then** el
   registro y su fotografía se eliminan sin necesidad de credenciales de administración.
3. **Given** un token de borrado incorrecto o ausente, **When** se intenta borrar una
   contribución con él, **Then** la API responde `403` y el registro permanece intacto.
4. **Given** un visitante que navega a `/politica-de-privacidad` o `/aviso-legal`, **When** carga
   la página, **Then** recibe `200` con el contenido legal correspondiente (no un 404).

---

### User Story 4 - Cabeceras de seguridad en todas las respuestas (Priority: P2)

Como responsable de la campaña, necesito que cada respuesta del servidor incluya las cabeceras de
seguridad básicas, para reducir el riesgo de clickjacking, sniffing de MIME e inyección de
contenido, independientemente de lo que haga Nginx por delante.

**Why this priority**: Ninguna respuesta actual (JSON, error, estático) incluye
`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` ni `Content-Security-Policy`. La
recomendación de Nginx del propio README tampoco las añade. Es una capa de defensa barata y
ausente por completo.

**Independent Test**: Pedir `/api/health`, `/api/traces` y `/` (estático) y comprobar que las
cuatro cabeceras de seguridad están presentes en las tres respuestas.

**Acceptance Scenarios**:

1. **Given** cualquier respuesta JSON de la API (éxito o error), **When** se inspeccionan sus
   cabeceras, **Then** incluye `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` y
   `Referrer-Policy: strict-origin-when-cross-origin`.
2. **Given** una respuesta de un recurso estático (`/`, `/admin`, `/uploads/<archivo>`), **When**
   se inspeccionan sus cabeceras, **Then** también incluye esas mismas cabeceras más una
   `Content-Security-Policy` restringida al propio origen.

---

### User Story 5 - Auditoría y freno de fuerza bruta en el panel de administración (Priority: P3)

Como responsable de la campaña, necesito saber quién aprobó, rechazó, editó o borró cada
contribución y cuándo, y necesito que `POST /api/admin/login` no permita probar contraseñas sin
límite, para poder rendir cuentas y reducir el riesgo de que alguien fuerce el acceso.

**Why this priority**: El control de acceso a `/api/admin/*` ya existe (token HMAC con caducidad)
y es razonable como separación público/admin; lo que falta es trazabilidad de las acciones y un
límite a los intentos de login, ambos de menor urgencia que P1/P2 pero necesarios antes de abrir
la administración a más de una persona.

**Independent Test**: Aprobar, editar y borrar una contribución desde el panel y comprobar que
cada acción queda registrada con marca de tiempo; intentar iniciar sesión con contraseña
incorrecta repetidamente desde la misma IP y comprobar que tras N intentos fallidos se bloquea
temporalmente aunque la contraseña sea correcta.

**Acceptance Scenarios**:

1. **Given** una acción de administración (cambio de estado, edición o borrado) sobre una
   contribución, **When** se ejecuta con éxito, **Then** queda una entrada de auditoría con la
   acción, el identificador de la contribución y la marca de tiempo, consultable vía
   `GET /api/admin/audit-log`.
2. **Given** más de N intentos fallidos de `POST /api/admin/login` desde la misma IP en una
   ventana de tiempo, **When** se realiza un intento adicional (incluso con la contraseña
   correcta), **Then** la API responde `429` hasta que expire el bloqueo.

---

### Edge Cases

- ¿Qué pasa si el servidor corre detrás de un proxy que no envía `X-Forwarded-For` fiable? El
  límite por IP debe seguir funcionando con `self.client_address` como respaldo, documentando la
  limitación en el propio código.
- ¿Qué pasa si dos contribuciones legítimas llegan desde la misma IP compartida (p. ej. una
  oficina o red móvil con NAT)? El límite debe ser generoso (por hora, no por minuto) para no
  bloquear uso legítimo.
- ¿Qué pasa si el token de borrado se pierde? No hay recuperación por diseño (es autoservicio
  anónimo); el administrador conserva el borrado manual existente como vía alternativa.
- ¿Qué pasa con imágenes PNG/WEBP sin EXIF (formato no lo soporta de forma estándar o ya viene
  limpio)? El paso de saneado debe ser un no-op seguro, sin fallar la subida.
- ¿Qué pasa si `config.json` no define texto legal para las nuevas páginas? Deben tener un
  contenido mínimo por defecto en español, igual que el resto de `DEFAULT_PUBLIC_CONFIG`.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema MUST limitar el número de contribuciones (`POST /api/traces`) aceptadas
  por dirección IP en una ventana de tiempo configurable, respondiendo `429` con `Retry-After` al
  excederlo.
- **FR-002**: El sistema MUST rechazar silenciosamente (mensaje genérico, sin registro) cualquier
  envío de `POST /api/traces` cuyo campo señuelo (honeypot) llegue relleno.
- **FR-003**: El sistema MUST validar el contenido real del archivo subido como `photo` contra las
  firmas binarias de JPEG/PNG/WEBP, independientemente del `Content-Type` o extensión declarados.
- **FR-004**: El sistema MUST rechazar imágenes cuyas dimensiones (leídas de su propia cabecera)
  superen un máximo configurado, antes de decodificarlas o persistirlas por completo.
- **FR-005**: El sistema MUST eliminar los metadatos EXIF de las imágenes JPEG (y equivalentes
  PNG/WEBP si existen) antes de guardarlas en `uploads/`.
- **FR-006**: El sistema MUST usar el valor real del campo `consent` enviado por el formulario
  para decidir si acepta o rechaza la contribución, en vez de un valor fijo.
- **FR-007**: El sistema MUST emitir un token de borrado único por contribución en la respuesta de
  `POST /api/traces`, y MUST ofrecer un endpoint público que borre esa contribución (registro y
  fotografía) solo si el token presentado coincide con el almacenado.
- **FR-008**: El sistema MUST servir contenido real (no 404) en las rutas
  `/politica-de-privacidad` y `/aviso-legal` ya referenciadas desde `config.json`.
- **FR-009**: El sistema MUST incluir `X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy` y `Content-Security-Policy` en toda respuesta HTTP que emita, tanto JSON como
  estática.
- **FR-010**: El sistema MUST registrar en una bitácora de auditoría cada cambio de estado,
  edición o borrado realizado desde el panel de administración, con acción, identificador
  afectado y marca de tiempo, expuesta vía `GET /api/admin/audit-log` protegido.
- **FR-011**: El sistema MUST bloquear temporalmente los intentos de `POST /api/admin/login` desde
  una misma IP tras superar un número máximo de fallos consecutivos en una ventana de tiempo.
- **FR-012**: El sistema MUST disponer de una forma automatizada de verificar los requisitos
  anteriores (smoke test) ejecutable sin afectar los datos de producción, dado que el proyecto no
  tiene actualmente ninguna suite de pruebas.

### Key Entities

- **Trace**: contribución enviada al mapa (nombre, email, ciudad, país, relación, emoción,
  sentimiento, foto, estado, consentimiento, fecha). Se añade un `deletion_token_hash` propio para
  el borrado autoservicio de FR-007.
- **RateLimitBucket**: contador en memoria por IP y por propósito (envío de contribuciones vs.
  intentos de login), con ventana deslizante — no requiere persistencia entre reinicios del
  servidor.
- **AuditLogEntry**: registro de una acción administrativa (acción, `trace_id` afectado, IP de
  origen, marca de tiempo).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un script automatizado de abuso que envíe más contribuciones que el límite
  configurado desde una sola IP recibe `429` a partir de la que excede el límite, el 100% de las
  veces.
- **SC-002**: El 100% de un lote de archivos de prueba no-imagen disfrazados de imagen (extensión
  y `Content-Type` de imagen, contenido arbitrario) es rechazado antes de escribirse en
  `uploads/`.
- **SC-003**: Una imagen de prueba con EXIF GPS conocido, tras pasar por la subida, no contiene ese
  EXIF en el archivo final servido desde `/uploads/`.
- **SC-004**: El 100% de las respuestas del servidor (muestreando `/`, `/admin`, `/api/health`,
  `/api/traces`, `/uploads/<archivo>`) incluye las cuatro cabeceras de seguridad de FR-009.
- **SC-005**: Toda acción de aprobar/rechazar/editar/borrar ejecutada en el panel de
  administración durante la verificación aparece en `GET /api/admin/audit-log` en menos de 1
  segundo.
- **SC-006**: `/politica-de-privacidad` y `/aviso-legal` responden `200` con contenido no vacío.

## Assumptions

- El servidor sigue siendo Bun sin dependencias npm de terceros ("sin dependencias externas", per
  README) — todo lo anterior (firma de imagen, dimensiones, EXIF, cabeceras, límites de tasa) se
  implementa sin instalar paquetes nuevos (sin `sharp`, sin frameworks web).
- No se requiere despliegue como parte de esta feature: el hardening se valida localmente con el
  smoke test de FR-012; el `systemctl restart mapamundi` en producción sigue siendo manual, según
  el flujo ya documentado en el README.
- El límite de tasa y el bloqueo de login son en memoria de proceso (`Bun.serve` de un solo
  proceso); no hace falta un almacén compartido porque el proyecto corre como un único proceso.
- Ya existe control de acceso por token HMAC en `/api/admin/*` (`requireAdmin`/`validAdminToken`
  en `server.ts`); esta feature NO rediseña esa autenticación, solo le añade auditoría y freno de
  fuerza bruta (User Story 5).
- El envío de email no está disponible en este MVP; por eso el borrado de datos (User Story 3) se
  resuelve con un token de un solo uso devuelto en el momento de crear la contribución, en vez de
  con un enlace enviado por correo.
