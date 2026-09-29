# Granada 2031 · Geolocalización del Sentimiento

Mapa participativo de la campaña "Geolocalización del Sentimiento", de la candidatura de Granada a Capital Europea de la Cultura 2031, impulsado por IDEAL.

Cualquier persona puede subir fotos de un lugar del mundo que la conecte con Granada. Tras la moderación, las fotos aparecen como puntos de luz en un mapa interactivo y en una galería pública donde se pueden votar. Un panel de administración protegido permite revisar las contribuciones, girar fotos, consultar las más votadas y gestionar los patrocinadores sin desplegar.

## Funcionalidades

### Mapa y subida de fotos

- Mapa interactivo con Leaflet y teselas oscuras de CARTO (datos de OpenStreetMap). Admite zoom con la rueda, botones `+`/`-`, arrastre y filtros por emoción. Al hacer clic en un punto se abre el panel con la historia y sus fotos.
- Formulario de subida en una ventana modal, con hasta 5 fotos por contribución (JPEG, PNG o WebP; 8 MB como máximo por envío). La ciudad se elige con un buscador (geocodificación con Nominatim a través de `GET /api/geocode/search`) y un selector sobre el mapa.
- Las fotos se validan por su firma binaria y sus dimensiones (protección contra imágenes que se descomprimen hasta tamaños enormes). Al subirlas se aplica la orientación EXIF: las fotos de iPhone ya no aparecen tumbadas. Después se guardan sin metadatos, GPS incluido.
- Protección contra spam: límite de envíos por IP y campo trampa (honeypot).
- Las contribuciones nuevas llegan como `pending` y solo se publican cuando se aprueban. La web pública nunca muestra el email de quien participa.
- La portada, el mapa y la galería se actualizan solos cada 60 segundos. La galería muestra 20 fotos al principio y carga más bajo demanda.

### Voto de fotos

- Cualquier foto se puede votar, tanto la de portada como las extras. Se vota desde el panel del mapa o con el botón "Votar esta foto" de cada ficha de la galería, que es independiente de "Abrir en mapa".
- **Un voto por IP y foto.** Lo garantiza la base de datos, no el código de la aplicación: índice único `(photo_id, ip_hash)` en MongoDB y clave primaria compuesta en SQLite. Si se vota de nuevo desde la misma IP, la respuesta es `200` con `alreadyVoted: true`, no un error, porque detrás de una IP compartida (una oficina, una operadora móvil) puede haber otra persona.
- **La IP nunca se guarda en claro.** Se almacena `SHA-256(ip:pepper)`, donde el pepper es el secreto `photo_vote_pepper` de `.dev` (ver [Secretos](#secretos-dev)). Si alguien obtuviera la colección `photo_votes` sin ese secreto, no podría recuperar las IP a base de probar direcciones.
- Límite adicional de 30 votos por minuto e IP (`GRANADA_VOTE_RATE_LIMIT_*`).
- En el panel de administración, "Fotos más votadas" ordena todas las fotos por número de votos, sea cual sea su estado. Ver [Panel de administración](#panel-de-administración).

### Patrocinadores

Sección pública entre el banner naranja ("Cada foto es un vínculo…") y "El billete de vuelta", sobre el fondo crema.

- **Dos niveles:**
  - `principal`: logos de 96 px de alto. El título dice "Patrocinador principal" si hay uno y "Patrocinadores principales" si hay dos o tres.
  - `colaborador`: logos de 52 px de alto, bajo "Patrocinan esta iniciativa".
- El nivel indica la importancia, no la zona de la página. Cualquier bloque `[data-sponsor-tier="principal"]` o `[data-sponsor-tier="colaborador"]` recibe los logos de su nivel, así que se pueden mover a otra parte de la página sin tocar la API.
- Los logos mantienen su proporción (`object-fit: contain`), enlazan en una pestaña nueva con `rel="sponsored nofollow noopener"` y usan el nombre del patrocinador como texto alternativo. Un nivel sin patrocinadores visibles no se muestra, y si no hay ninguno la sección entera desaparece.
- **Límite de 3 principales visibles.** La API responde `409` con el campo `tier` si se supera al crear un patrocinador, al volver a mostrar uno oculto o al pasar un colaborador a principal.
- **Criterio de transparencia de los logos** (los logos se pintan sobre el fondo crema, así que no pueden traer fondo propio):
  - Solo PNG o WebP, comprobado por la firma binaria y no por la extensión.
  - Deben tener canal alfa y transparencia real: al menos el 5 % de los píxeles con alfa inferior a 128. Un PNG con canal alfa totalmente opaco se rechaza.
  - Se reescalan a 360 px de alto y se vuelven a codificar en el mismo formato (nunca a JPEG, que no tiene transparencia), sin metadatos. Cada subida recibe un nombre de archivo nuevo, porque `/uploads/` se sirve como inmutable.
- La web del patrocinador solo puede ser `http` o `https`. Si no lleva esquema, se añade `https://`.
- Se gestionan desde el panel de administración. Ver [Panel de administración](#panel-de-administración).

### Cookies y consentimiento

- **Banner de cookies** (`web/cookie-consent.js`). Aparece en la primera visita a la portada y a las páginas legales. No depende de `app.js`, así que funciona también en las páginas que no cargan la aplicación completa.
  - **Aceptar:** el banner se pliega en una pestaña flotante abajo a la izquierda, que lo vuelve a abrir. La decisión se guarda en `localStorage` con la clave `granada2031_cookie_consent`.
  - **Denegar:** lleva a `web/cookies-denegadas.html`, una página neutra de salida, y borra cualquier aceptación anterior.
  - Enlaza a la [política de cookies](https://2031granadaideal.es/politica-de-cookies/) y a la [política de privacidad](https://2031granadaideal.es/politica-de-privacidad/).
- **Consentimiento del formulario de subida.** La casilla obligatoria dice:

  > Confirmo que soy **mayor de edad**, que ostento **todos los derechos de propiedad intelectual e imagen** sobre las fotografías y textos aportados y acepto su **cesión gratuita para la acción cultural Granada 2031**. He leído y acepto la política de privacidad.

  El texto está fijo en `web/index.html`, con negritas y un enlace a la política de privacidad que se abre en una pestaña nueva. **Ya no se edita desde `config.json`:** la clave `consent_text` se eliminó porque `app.js` la reescribía como texto plano y se perdían las negritas y el enlace. Para cambiarlo hay que editar `web/index.html`. La casilla sigue siendo obligatoria en el HTML, y el servidor rechaza cualquier envío sin consentimiento.

### Borrar una contribución

Al enviar una contribución se muestra una sola vez un código de borrado, que no se guarda en claro. Con él, cualquier persona puede eliminar su contribución desde el formulario de la portada, que llama a `DELETE /api/traces/{id}` con la cabecera `X-Deletion-Token`. Así se cumple el derecho de supresión del RGPD.

### Cabecera y pie de página

La portada, las páginas legales y el panel de administración comparten la marca **"GRANADA 2031 | IDEAL"**.

- **Cabecera:**
  - El logo enlaza a https://2031granadaideal.es/.
  - Enlaces "Enciende tu marca" (https://2031granadaideal.es/enciende-tu-marca-2031/) y "Late Granada" (https://2031granadaideal.es/), ambos en pestaña nueva.
  - Botón "Subir una foto".
  - En móvil, menú hamburguesa (`web/nav-toggle.js`).
- **Pie de página:**
  - Logos de Granada 2031 e IDEAL, que enlazan a https://www.ideal.es/.
  - Texto de `footer_text` (en `config.json`).
  - Enlaces a [Política de privacidad](https://2031granadaideal.es/politica-de-privacidad/) y [Política de cookies](https://2031granadaideal.es/politica-de-cookies/), en pestaña nueva.
  - Redes sociales de IDEAL:
    - Facebook: https://www.facebook.com/www.ideal.es
    - X (Twitter): https://twitter.com/ideal_granada
    - Instagram: https://www.instagram.com/ideal_diario/
    - LinkedIn: https://es.linkedin.com/company/diario-ideal-grupo-vocento-
    - TikTok: https://www.tiktok.com/@ideal_diario
  - Frase final: "Granada no quiere explicar quién es. Quiere demostrar dónde ya está."

## Panel de administración

El panel está en `/admin` (también responde en `/admin/`) y se sirve desde `admin/admin.html`. La portada no lo enlaza. Para entrar se usa la contraseña de `.dev`, que da un token temporal de 12 horas. No abras `/api/admin` ni `/api/admin/login` directamente: son endpoints internos del formulario.

```text
https://mapamundi.2031granadaideal.es/admin
```

Con la sesión iniciada, el panel ofrece:

- **Accesos rápidos** en la cabecera:
  - "Fotos más votadas".
  - Submenú **"Gestión fotos"** con Todas, Pendientes, Aprobadas y Rechazadas: aplica el filtro, marca la pestaña correspondiente y limpia la búsqueda.
  - "Patrocinadores".
  - "Ver mapa público", que abre `/#mapa-en-vivo` en una pestaña nueva.
- **Gráficas** de envíos.
- **Fotos más votadas:** ranking de todas las fotos, portadas y extras, sea cual sea su estado. Cada fila muestra miniatura, autor, lugar, estado y votos. Las fotos sin votos van al final. "Ver en revisión" filtra la lista de revisión hasta esa contribución.
- **Revisión:**
  - Búsqueda y pestañas de estado.
  - Tarjetas en 2 columnas en escritorio y 1 en móvil.
  - Botones para aprobar, rechazar, editar el texto y borrar. **"Aprobar" no aparece en contribuciones ya aprobadas.**
  - Girar fotos 90° (`POST /api/admin/photos/{id}/rotate`): la foto se guarda con un nombre nuevo y conserva sus votos.
- **Paginación de 10 en 10** en la revisión y en las más votadas ("11–20 de 34"). Es solo del frontend: `GET /api/admin/traces` sigue devolviendo todo. La revisión vuelve a la página 1 al cambiar el filtro o la búsqueda, y no cambia de página al aprobar, rechazar o borrar.
- **Patrocinadores:**
  - Alta, edición, ocultar y mostrar, orden y borrado.
  - Al elegir un logo se ve una vista previa sobre el fondo crema de la web.
  - Los errores de la API (logo sin transparencia, URL no válida, límite de principales…) aparecen junto al campo afectado.

Todas las acciones de administración quedan registradas en un log de auditoría (`GET /api/admin/audit-log`). Tras varios intentos fallidos de inicio de sesión, la IP se bloquea durante un tiempo (5 intentos en 15 minutos por defecto).

Si `/admin/` devuelve "File not found" en una instalación sin Docker, comprueba en el servidor:

```bash
ls -la /var/www/mapamundi/admin/
ls -la /var/www/mapamundi/admin/admin.html
sudo systemctl restart mapamundi
```

## Estructura del proyecto

```text
web/            # web pública
  index.html, app.js, styles.css
  cookie-consent.js, cookies-denegadas.html   # banner de cookies
  nav-toggle.js                               # menú móvil (compartido con admin y legales)
  politica-de-privacidad.html, aviso-legal.html
  assets/       # logos e imágenes de fondo
  vendor/leaflet/
admin/          # panel de administración: admin.html, admin.js
api/            # backend
  server.ts     # servidor HTTP (Bun.serve)
  db.ts         # capa de datos: SQLite o MongoDB
  seed-photos/  # fotos de demo
  tests/        # smoke.test.ts, smoke-mongo.test.ts, db.test.ts
migrations/     # migraciones numeradas de MongoDB
scripts/        # deploy.sh, backup.sh, restore.sh, migrate.ts, migrate-sqlite-to-mongo.ts
deploy/         # vhost de Nginx del host, página de mantenimiento, timer de backups
docker/         # configuración de Nginx del gateway e inicialización de Mongo
config.json     # textos públicos (versionado)
.dev            # secretos de administración (ignorado por git)
data/           # base de datos SQLite (estado en ejecución)
uploads/        # imágenes subidas (estado en ejecución)
```

Todo corre en un único proceso Bun (`Bun.serve` en `api/server.ts`), que sirve los estáticos de `web/` y `admin/` y expone los endpoints `/api/*`. El código de `api/`, el archivo `.dev` y cualquier otro archivo fuera de la lista de estáticos permitidos nunca son accesibles por HTTP.

## Almacenamiento y dependencias

El servidor usa **MongoDB** cuando existe la variable `MONGO_URI` (así funcionan Docker Compose y producción) y **SQLite** (`bun:sqlite`) cuando no, lo que es útil para desarrollo rápido y para las pruebas:

- Base de datos SQLite: `data/granada2031.sqlite3`
- Imágenes subidas: `uploads/`
- Secretos de administración: `.dev` (ignorado por git)
- Configuración pública: `config.json`

Dependencias de ejecución (`package.json`):

- `mongodb`: cliente de MongoDB.
- `sharp`: aplica la orientación EXIF de las fotos, las gira desde el admin y procesa los logos de patrocinadores (reescalado y comprobación de transparencia).
- `leaflet`: librería de mapas. Se sirve desde `web/vendor/leaflet/` y **no desde un CDN**.

El mapa atribuye los datos a OpenStreetMap y las teselas a CARTO ("© OpenStreetMap contributors © CARTO", abajo a la derecha), como exigen sus condiciones de uso. La inicialización está en `web/app.js`. El único recurso externo que carga la web es la tipografía Inter, desde Google Fonts.

## Ejecutar en local sin Docker (SQLite)

```bash
bun install
bun run api/server.ts --host 0.0.0.0 --port 8080
```

Abre `http://localhost:8080`, o `http://IP_DEL_SERVIDOR:8080` desde otra máquina. En los logs aparecerá `[db.ts] SQLite initialized at ...`.

Importante: no abras `web/index.html` con doble clic ni desde otro servidor estático. La subida de fotos necesita que la aplicación se sirva desde `api/server.ts`, que es donde están la API, la base de datos y la carpeta `uploads/`.

Comprobación rápida:

```bash
curl http://localhost:8080/api/health
```

```json
{
  "ok": true,
  "service": "mapamundi",
  "version": "...",
  "storage": "sqlite",
  ...
}
```

Si `https://mapamundi.2031granadaideal.es/api/health` devuelve 404, Nginx no está reenviando `/api` al proceso Bun.

## Docker Compose (MongoDB)

El proyecto incluye un stack completo con Docker Compose:

- **MongoDB** (servicio `db`, `mongo:7.0`): base de datos con autenticación.
- **API Bun** (servicio `api`): el servidor de Granada conectado a MongoDB.
- **Gateway Nginx** (servicio `proxy`): sirve la web pública, el panel de administración y el proxy inverso hacia la API.

Todos los servicios comparten una red propia (`granada_net`) y usan health checks para arrancar en orden.

### Arranque rápido

1. **Copia la plantilla de entorno:**

   ```bash
   cp .env.example .env
   ```

   `.env` define la conexión a MongoDB (`MONGO_URI`, `MONGO_DB_NAME`), las credenciales de desarrollo y las rutas de datos. Tiene la misma configuración con autenticación que producción, pero con contraseñas de desarrollo.

2. **Construye y arranca:**

   ```bash
   docker compose up -d --build
   ```

   Primero arranca MongoDB y espera a que esté sano, después la API y por último el gateway.

3. **Comprueba que funciona:**

   ```bash
   curl http://localhost/api/health
   ```

   La respuesta debe incluir `"ok": true` y `"storage": "mongodb"`. La web está en `http://localhost` y el panel en `http://localhost/admin/`.

### Migrar datos de SQLite a MongoDB

Si tienes una base de datos SQLite de una ejecución sin Docker, el script de migración copia todos los documentos a MongoDB con `upsert`, así que no duplica nada.

**Antes de migrar**, para cualquier proceso `api/server.ts` en marcha para evitar bloqueos del archivo SQLite.

```bash
docker compose up -d
MONGO_URI=mongodb://localhost:27017/granada2031 bun run scripts/migrate-sqlite-to-mongo.ts
```

El script lee `data/granada2031.sqlite3` (o `$GRANADA_DB_PATH` si está definida), importa contribuciones, fotos, log de auditoría y registros, y muestra un resumen:

```text
[migrate] ✓ Migration complete!
[migrate] Summary:
  - traces: 42
  - trace_photos: 87
  - audit_log: 15
  - notify_signups: 8
```

Para comprobarlo:

```bash
docker exec granada-db mongosh granada2031 --eval "db.traces.countDocuments()"
```

Se puede ejecutar varias veces sin riesgo: el resumen muestra los mismos números y no aparecen duplicados.

### Parar y limpiar

```bash
docker compose down        # para los servicios
docker compose down -v     # además borra los volúmenes (base de datos, fotos y datos)
```

## Pruebas

```bash
bun test
```

- `api/tests/smoke.test.ts` arranca `api/server.ts` como proceso hijo en un puerto libre, sobre un directorio temporal (`GRANADA_DATA_DIR`, `GRANADA_UPLOAD_DIR`, `GRANADA_DB_PATH`, `GRANADA_CONFIG_PATH`, `GRANADA_SECRETS_PATH`), y lo prueba por HTTP. Nunca toca `data/`, `uploads/`, `config.json` ni `.dev` del proyecto. Cubre, entre otras cosas, el ciclo de las contribuciones, la validación de imágenes, el consentimiento y el borrado, las cabeceras de seguridad, la auditoría, los votos, el giro de fotos y los patrocinadores.
- `api/tests/db.test.ts` comprueba que SQLite y MongoDB devuelven lo mismo.
- `api/tests/smoke-mongo.test.ts` repite los escenarios contra MongoDB.

Las pruebas de MongoDB **se saltan automáticamente** si `GRANADA_TEST_MONGO_URI` no está definida. Para ejecutarlas en local:

```bash
docker run --rm -d -p 27017:27017 --name granada-test-mongo mongo:7.0
export GRANADA_TEST_MONGO_URI=mongodb://localhost:27017/granada2031-smoke
bun test
docker stop granada-test-mongo
```

Cuando añadas endpoints o comportamientos nuevos, amplía estos archivos.

## Configuración

### Secretos (`.dev`)

Los secretos están en `.dev`, en la raíz del proyecto. **No se sube al repositorio** (está en `.gitignore`). Si no existe, el servidor lo crea al arrancar con valores aleatorios y una contraseña de ejemplo que hay que cambiar:

```json
{
  "admin_password": "cambia-esta-password",
  "admin_session_secret": "secreto-largo-aleatorio",
  "photo_vote_pepper": "otro-secreto-aleatorio"
}
```

Las tres claves son obligatorias.

- `admin_password`: contraseña del panel de administración.
- `admin_session_secret`: firma los tokens de sesión del admin.
- `photo_vote_pepper`: secreto con el que se calcula el hash de las IP de los votos. **No lo cambies una vez en marcha:** si cambia, los votos anteriores ya no se reconocen y la misma IP podría votar otra vez. Si falta en un `.dev` existente, el servidor lo añade solo.

**En producción**, `.dev` es `/etc/granada/admin-secrets.json`, montado en modo solo lectura dentro del contenedor de la API (ver `docker-compose.prod.yml`). En ese caso el servidor no puede añadir `photo_vote_pepper`: usa uno temporal en memoria y lo avisa en los logs. Hay que añadirlo a mano al archivo, porque con el pepper temporal los hashes dejan de coincidir tras cada reinicio.

`/api/config` solo devuelve al navegador el bloque `public` de `config.json`, nunca los secretos.

### Textos y enlaces (`config.json`)

La web lee los textos visibles del bloque `public` de `config.json` (versionado):

```json
{
  "public": {
    "site_title": "Granada 2031 | Geolocalización del Sentimiento",
    "brand_name": "Granada 2031",
    "brand_subtitle": "Geolocalización del Sentimiento",
    "brand_logo": "/assets/logo.svg",
    "hero_title": "Granada encendida en el mundo",
    "map_title": "Mapa vivo",
    "archive_title": "Todas las fotos, una a una",
    "footer_text": "Un proyecto de IDEAL para una Granada más abierta al mundo.",
    "privacy_label": "Política de privacidad",
    "privacy_url": "https://2031granadaideal.es/politica-de-privacidad/",
    "legal_label": "Política de cookies",
    "legal_url": "https://2031granadaideal.es/politica-de-cookies/",
    "ideal_logo": "/assets/ideal-logo.png",
    "ideal_url": "https://www.ideal.es"
  }
}
```

(Extracto: el archivo completo tiene también los textos del hero, los botones, el mapa, el formulario y la galería.)

Desde `config.json` se puede cambiar:

- El título del navegador, el nombre, el subtítulo y el logo de la marca.
- Los textos del hero, los botones, el mapa, el formulario y la galería.
- El texto del pie (`footer_text`), los enlaces legales y el logo de IDEAL.

**No se configuran desde `config.json`** (hay que editar `web/index.html`):

- El texto de consentimiento del formulario (ver [Cookies y consentimiento](#cookies-y-consentimiento)).
- Los enlaces de la cabecera ("Enciende tu marca", "Late Granada") y las redes sociales del pie.

Los logos se referencian con rutas relativas a `web/` (por ejemplo, `/assets/logo.svg`). Si `brand_logo` o `ideal_logo` están vacíos, la web muestra el marcador por defecto y el texto `IDEAL`.

Después de editar `config.json` o `.dev` en una instalación sin Docker, reinicia el servicio:

```bash
sudo systemctl restart mapamundi
```

### Variables de entorno

| Variable | Por defecto | Uso |
|---|---|---|
| `MONGO_URI`, `MONGO_DB_NAME` | (sin definir) | Si `MONGO_URI` está definida, se usa MongoDB; si no, SQLite |
| `GRANADA_SEED` | `true` | `false` evita cargar contribuciones y fotos de demo en una base de datos vacía (producción) |
| `GRANADA_TRACE_RATE_LIMIT_MAX` / `_WINDOW_MS` | 5 / 1 h | Envíos por IP |
| `GRANADA_VOTE_RATE_LIMIT_MAX` / `_WINDOW_MS` | 30 / 1 min | Votos por IP |
| `GRANADA_GEOCODE_SEARCH_RATE_LIMIT_MAX` / `_WINDOW_MS` | 20 / 5 min | Búsquedas de ciudad por IP |
| `GRANADA_ADMIN_LOGIN_LOCKOUT_MAX` / `_WINDOW_MS` | 5 / 15 min | Intentos fallidos de inicio de sesión en el admin antes del bloqueo |
| `GRANADA_MAX_IMAGE_DIMENSION` | 6000 | Lado máximo de una imagen en píxeles |
| `GRANADA_TRUSTED_PROXY_HOST` | `proxy` | Nombre del gateway de Compose cuya cabecera `X-Forwarded-For` se acepta. Sin esto, todos los visitantes compartirían una IP para límites, auditoría y votos |
| `GRANADA_NOMINATIM_ENDPOINT` | Nominatim de OSM | Servicio de geocodificación |
| `GRANADA_DATA_DIR`, `GRANADA_UPLOAD_DIR`, `GRANADA_DB_PATH`, `GRANADA_CONFIG_PATH`, `GRANADA_SECRETS_PATH` | raíz del proyecto | Rutas de datos, fotos, SQLite, `config.json` y `.dev` |

## API

| Método | Ruta | Acceso | Descripción |
|---|---|---|---|
| GET | `/api/health` | público | Estado, versión y almacenamiento |
| GET | `/api/config` | público | Bloque `public` de `config.json` |
| GET | `/api/traces` | público | Contribuciones **aprobadas**, con `photos[]` como `{id, url, voteCount}` |
| POST | `/api/traces` | público | Nueva contribución (`multipart/form-data`) |
| DELETE | `/api/traces/{id}` | público + `X-Deletion-Token` | Borrado por quien la envió |
| POST | `/api/photos/{id}/vote` | público | Votar una foto (uno por IP) |
| GET | `/api/geocode/search` | público | Búsqueda de ciudades |
| GET | `/api/sponsors` | público | Patrocinadores visibles, agrupados por nivel |
| POST | `/api/notify-signup` | público | Registro de avisos (sin formulario en la web actual) |
| POST | `/api/admin/login` | — | Devuelve el token de administración |
| GET | `/api/admin/traces` | admin | Todas las contribuciones, en cualquier estado |
| PATCH | `/api/admin/traces/{id}/status` | admin | Aprobar o rechazar |
| PATCH | `/api/admin/traces/{id}` | admin | Editar el texto |
| DELETE | `/api/admin/traces/{id}` | admin | Borrar |
| POST | `/api/admin/photos/{id}/rotate` | admin | Girar una foto 90° |
| GET | `/api/admin/audit-log` | admin | Log de auditoría |
| GET/POST | `/api/admin/sponsors` | admin | Listar y crear patrocinadores (`multipart/form-data` con el logo) |
| PATCH/DELETE | `/api/admin/sponsors/{id}` | admin | Editar, ocultar, mostrar o borrar un patrocinador |

`POST /api/traces` acepta: `name`, `email`, `city`, `country`, `lat`, `lng`, `relation`, `emotion`, `feeling`, `consent` y de una a cinco fotos en `photo`. La respuesta incluye el código de borrado.

Los endpoints `/api/admin/*` exigen `Authorization: Bearer <token>`.

## Nginx para una instalación sin Docker

Si el proceso Bun corre directamente en el servidor, sin Docker, pon Nginx delante como proxy completo. No sirvas `web/index.html` directamente desde Nginx. (Producción usa Docker Compose y el vhost `deploy/nginx-mapamundi.conf`. Ver [Despliegue](#despliegue).)

```nginx
server {
    listen 443 ssl http2;
    server_name mapamundi.2031granadaideal.es;

    ssl_certificate /etc/letsencrypt/live/mapamundi.2031granadaideal.es/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/mapamundi.2031granadaideal.es/privkey.pem;

    client_max_body_size 8M;

    # Refuerzo de las cabeceras que ya envía el servidor. HSTS solo tiene efecto en HTTPS (RFC 6797).
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Content-Security-Policy "default-src 'self'; img-src 'self' data: https://*.tile.openstreetmap.org https://*.basemaps.cartocdn.com; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com" always;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Añade también un bloque en el puerto 80 que redirija a HTTPS. Después:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## Solución de problemas

Si al subir una foto aparece un error de la API, comprueba:

1. Que el servidor está en marcha (`bun run api/server.ts --host 0.0.0.0 --port 8080`, o `docker compose ps`).
2. Que has abierto la web desde la URL del servidor (`http://localhost:8080`) y no como `file:///...`.
3. Que el usuario del proceso puede escribir en `data/` y `uploads/`.

## Copias de seguridad en local

Con SQLite, para el servicio o haz una copia atómica:

```bash
sqlite3 data/granada2031.sqlite3 ".backup 'backup-granada2031.sqlite3'"
tar -czf backup-uploads.tar.gz uploads/
```

Las copias de producción se explican en [Despliegue](#despliegue).

## Despliegue

Producción usa los mismos archivos de Compose que desarrollo, más un overlay, siempre con el proyecto `granada` y el archivo de entorno del servidor:

```bash
docker compose -p granada -f docker-compose.yml -f docker-compose.prod.yml --env-file /etc/granada/.env up -d
```

**No ejecutes un `docker compose up` sin más en el servidor:** incluiría `docker-compose.override.yml`, que es solo para desarrollo (puertos públicos, contraseñas de desarrollo y contraseña de admin de ejemplo). En la práctica, usa siempre `scripts/deploy.sh`.

`docker-compose.prod.yml` no publica nada en una interfaz pública. MongoDB no tiene puerto en el host: Docker publica saltándose el cortafuegos, así que `27017:27017` dejaría la base de datos expuesta a internet. La API (`127.0.0.1:8080`) y el gateway (`127.0.0.1:8081`) solo escuchan en loopback. El Nginx del host termina TLS y hace de proxy hacia el gateway (ver `deploy/nginx-mapamundi.conf`). Si el stack está caído o reiniciándose, ese vhost sirve `deploy/maintenance.html` en lugar de un error del gateway, pero mantiene el código 502/503/504 para que la monitorización siga detectando el fallo.

### Configuración y credenciales

MongoDB exige autenticación. Hay dos cuentas: una root para administración y para `mongodump`/`mongorestore`, y una de aplicación con `readWrite` solo sobre la base de datos de la aplicación. `docker/mongo-init/01-app-user.js` las crea la primera vez que MongoDB arranca con el directorio de datos vacío. Para cambiar las contraseñas después hay que modificar los usuarios en la base de datos; editar la configuración no basta.

Los valores de producción están en el servidor y no en el repositorio:

- `/etc/granada/.env`: credenciales de MongoDB. Pertenece a `root` y lo puede leer el grupo `granada`.
- `/etc/granada/admin-secrets.json`: el `.dev` de producción (ver [Secretos](#secretos-dev)).

### Proceso de despliegue manual

**Así desplegamos ahora mismo.** `scripts/deploy.sh` es el único procedimiento de despliegue: lo usa el workflow de GitHub Actions y es también lo que se ejecuta a mano, así que un despliegue manual nunca se aparta de uno automático. Estos son los pasos que seguimos, en el servidor, desde `/opt/mapamundi`:

1. **Comprobar qué commit hay en producción:**

   ```bash
   cd /opt/mapamundi
   git log -1 --oneline
   docker compose -p granada ps
   ```

2. **Generar el diff contra `origin/main`** para saber exactamente qué se va a desplegar:

   ```bash
   git fetch origin main
   git log --oneline HEAD..origin/main
   git diff --stat HEAD origin/main
   ```

   Revisa en particular si hay migraciones nuevas en `migrations/` o cambios en `docker-compose*.yml`.

3. **Hacer una copia de seguridad** antes de tocar nada:

   ```bash
   scripts/backup.sh pre-deploy-manual
   ```

   Comprueba que termina bien y que el directorio nuevo en `/var/backups/granada/` contiene su `manifest.txt`. (`deploy.sh` también hace su propia copia, pero esta queda hecha y verificada antes de decidir.)

4. **Confirmación explícita.** Con el diff y la copia a la vista, quien despliega confirma que se sigue adelante. No se ejecuta `deploy.sh` sin ese visto bueno.

5. **Desplegar:**

   ```bash
   scripts/deploy.sh --pull
   ```

6. **Verificar** tras el despliegue:

   ```bash
   curl -fsS http://127.0.0.1:8080/api/health
   curl -fsS https://mapamundi.2031granadaideal.es/api/health
   git log -1 --oneline   # debe coincidir con origin/main
   ```

   `/api/health` debe responder con `"ok": true` y `"storage": "mongodb"`. Conviene abrir también la web y el panel de administración.

`deploy.sh` se niega por defecto a desplegar si hay cambios sin commitear o si `HEAD` no es exactamente la punta de `origin/main`, así que producción siempre corresponde a un commit que se puede consultar. `--allow-dirty` salta esa comprobación en emergencias.

Lo que hace `deploy.sh`, en orden:

1. Arranca la base de datos.
2. Hace una copia de seguridad (`pre-deploy-<commit>`).
3. Construye las imágenes.
4. Aplica las migraciones pendientes.
5. Arranca los contenedores nuevos.
6. Espera a que la API (puerto 8080) y el gateway (puerto 8081) respondan.

Las migraciones se aplican antes de que la API nueva reciba tráfico, así que la aplicación nunca se encuentra con un esquema que no entiende.

### Migraciones

Los cambios de esquema van en archivos numerados dentro de `migrations/`, no en el arranque de la aplicación:

- `0001-baseline-indexes.ts`: índices base.
- `0002-add-photo-votes.ts`: índice único de votos y contadores.
- `0003-add-sponsors.ts`: índices de patrocinadores.

```ts
// migrations/0004-ejemplo.ts
export const description = "Añade moderation_notes a traces"

export async function up(db) {
  await db.collection("traces").updateMany(
    { moderation_notes: { $exists: false } },
    { $set: { moderation_notes: [] } },
  )
}
```

Cada archivo se ejecuta una sola vez, por orden de nombre, y queda registrado en la colección `schema_migrations`.

```bash
docker compose -p granada run --rm --no-deps -T api bun run scripts/migrate.ts --status
docker compose -p granada run --rm --no-deps -T api bun run scripts/migrate.ts
```

Escríbelas de forma aditiva: añade el campo, rellénalo y borra el antiguo solo en una migración posterior, cuando ya nada lo lea. Así la versión anterior de la aplicación sigue funcionando con el esquema nuevo, y volver atrás el código no obliga a restaurar datos.

### Copias de seguridad y restauración

`scripts/backup.sh [etiqueta]` guarda en un directorio con fecha, dentro de `/var/backups/granada/`:

- Un archivo de `mongodump`.
- Un tar del volumen de fotos.
- Un manifiesto con el commit y el número de registros.

Antes de dar la copia por buena comprueba que los dos archivos se descomprimen. Además, borra las copias que superan el periodo de retención, pero conserva siempre las tres más recientes.

Se ejecuta antes de cada despliegue y cada noche con un timer de systemd (`deploy/granada-backup.timer`).

```bash
scripts/restore.sh                                # lista las copias disponibles
scripts/restore.sh /var/backups/granada/... --yes
```

`restore.sh` hace una copia de seguridad del estado actual antes de sobrescribir nada, así que restaurar la copia equivocada también tiene vuelta atrás.

### Integración continua y el workflow "Deploy"

`.github/workflows/ci.yml` pasa las pruebas en cada pull request, y `.github/workflows/deploy.yml` ("Deploy") despliega cada push a `main` ejecutando `scripts/deploy.sh`. Los cambios que solo tocan `*.md`, `specs/`, `.specify/`, `.claude/` o `LICENSE` no disparan el despliegue. Ninguno de los dos workflows usa secretos: las credenciales no salen de `/etc/granada/` en el servidor.

Ambos se ejecutan en un **runner self-hosted** en la propia máquina de producción (etiquetas `self-hosted, granada`). Como esa máquina también sirve producción, las pruebas están pensadas para consumir poco: la parte de SQLite no necesita base de datos, la de MongoDB usa un único contenedor temporal limitado a 1 CPU y 512 MB, y las ejecuciones superadas por otras más recientes se cancelan en vez de encolarse.

> **⚠️ Estado actual: el runner self-hosted está apagado.**
>
> Mientras siga así, **cada merge a `main` deja una ejecución de "Deploy" en cola** que no se ejecuta. Hay que hacer una de estas dos cosas:
>
> - **Cancelarla a mano** en la pestaña **Actions** del repositorio, o
> - **desplegar manualmente** con el [proceso de despliegue manual](#proceso-de-despliegue-manual) antes de que el runner vuelva a encenderse.
>
> Si se deja en cola, se ejecutará en cuanto el runner vuelva. `deploy.sh` rechaza cualquier commit que ya no sea la punta de `origin/main`, así que una ejecución antigua fallará en lugar de revertir cambios, pero no conviene dejarlo al azar: cancela las ejecuciones pendientes que ya se hayan desplegado a mano.

## Pendiente y posibles mejoras

Ya está hecho: HTTPS, autenticación del panel con bloqueo por intentos fallidos, límites por IP y honeypot, saneado de imágenes (firma binaria, dimensiones, EXIF), cabeceras de seguridad, auditoría de acciones de administración, borrado propio según el RGPD y copias de seguridad automáticas.

Queda pendiente o se puede mejorar:

- Volver a encender el runner self-hosted, o sustituirlo, para recuperar el despliegue automático.
- Paginar en la API los listados del panel de administración (hoy la paginación es solo del frontend).
