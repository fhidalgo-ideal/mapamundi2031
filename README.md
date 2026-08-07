# Granada 2031 - Geolocalizacion del Sentimiento

MVP navegable con almacenamiento en servidor para la accion "Geolocalizacion del Sentimiento".

El mapa publico soporta zoom con rueda del raton, controles `+`/`-`, restablecer vista y arrastre para moverse por regiones con alta concentracion de fotos.

## Almacenamiento elegido

El MVP usa SQLite como base de datos local del servidor:

- Archivo de base de datos: `data/granada2031.sqlite3`
- Imagenes subidas: `uploads/`
- Secretos de administracion: `.dev` (ignorado por git)
- Configuracion publica: `config.json`
- Servidor: Python 3 con libreria estandar, sin dependencias externas

SQLite es la opcion mas adecuada para esta fase porque Ubuntu 24 incluye Python con soporte `sqlite3`, no requiere administrar un servicio de base de datos separado, permite backups sencillos copiando un unico archivo y soporta sin problema una primera campana participativa moderada.

Para una fase de produccion con miles de contribuciones, busqueda geografica avanzada, analitica o administracion multiusuario, la migracion natural seria PostgreSQL con PostGIS y almacenamiento de imagenes en S3/MinIO.

## Ejecutar en Ubuntu 22.04

```bash
cd /ruta/del/proyecto
python3 server.py --host 0.0.0.0 --port 8080
```

Abrir:

```text
http://IP_DEL_SERVIDOR:8080
```

En local, si estas trabajando en la propia maquina:

```text
http://localhost:8080
```

Importante: no abras `index.html` con doble clic ni con un servidor estatico separado. La subida de fotos necesita que esta misma aplicacion se sirva desde `server.py`, porque ahi viven la API, SQLite y la carpeta `uploads/`.

## Password de administracion

La administracion esta protegida por backend. Los secretos viven en un archivo `.dev` local que **no se sube al repositorio** (esta en `.gitignore`). Si no existe, el servidor lo crea al arrancar con un secreto de sesion aleatorio. Cambia estos valores antes de publicar:

```json
{
  "admin_password": "cambia-esta-password",
  "admin_session_secret": "cambia-tambien-este-secreto-largo"
}
```

Los textos visibles siguen en `config.json`, que si se versiona. `/api/config` solo entrega el bloque `public` al navegador, nunca la password ni el secreto de sesion:

```json
{
  "public": {
    "site_title": "Granada 2031 | Geolocalizacion del Sentimiento",
    "brand_name": "Granada 2031",
    "brand_subtitle": "Geolocalizacion del Sentimiento",
    "brand_logo": "/assets/logo-granada2031.png",
    "footer_text": "Granada 2031. Geolocalizacion del Sentimiento.",
    "privacy_label": "Politica de privacidad",
    "privacy_url": "/politica-de-privacidad",
    "legal_label": "Aviso legal",
    "legal_url": "/aviso-legal",
    "ideal_logo": "/assets/logo-ideal.png",
    "ideal_url": "https://www.ideal.es"
  }
}
```

Los archivos deben estar en la raiz del proyecto:

```text
.dev          # secretos, ignorado por git
config.json   # textos publicos, versionado
```

Despues de modificarlo:

```bash
sudo systemctl restart mapamundi
```

## Textos, logos y enlaces legales

La portada lee los textos visibles desde `config.json`, dentro del bloque `public`. Ahi puedes cambiar:

- Titulo del navegador, nombre/subtitulo de marca y logo principal.
- Textos de hero, llamada a participar, mapa, formulario y archivo.
- Texto de consentimiento del formulario.
- Footer, enlace a politica de privacidad, enlace a aviso legal y logo de IDEAL.

Para usar logos, sube los archivos al proyecto, por ejemplo:

```text
/var/www/mapamundi/assets/logo-granada2031.png
/var/www/mapamundi/assets/logo-ideal.png
```

Y configura sus rutas como URLs relativas:

```json
{
  "public": {
    "brand_logo": "/assets/logo-granada2031.png",
    "ideal_logo": "/assets/logo-ideal.png"
  }
}
```

Si dejas `brand_logo` o `ideal_logo` vacios, la web usa el marcador visual por defecto y el texto `IDEAL`.

## Comprobacion rapida de API

Si la API esta bien conectada, esto debe devolver JSON:

```bash
curl http://localhost:8080/api/health
```

Respuesta esperada:

```json
{
  "ok": true,
  "service": "mapamundi",
  "storage": "sqlite"
}
```

Si `https://mapamundi.2031granadaideal.es/api/health` devuelve 404, Nginx no esta reenviando `/api` al proceso Python.

## Configuracion Nginx recomendada

Usa Nginx como proxy completo hacia `server.py`. No sirvas `index.html` directamente desde Nginx en este MVP, porque la API vive en el mismo servidor Python.

```nginx
server {
    listen 80;
    server_name mapamundi.2031granadaideal.es;

    client_max_body_size 8M;

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

Despues:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## API incluida

```text
GET    /api/traces
GET    /api/config
POST   /api/traces
POST   /api/admin/login
GET    /api/admin/traces
PATCH  /api/admin/traces/{id}/status
PATCH  /api/admin/traces/{id}
DELETE /api/admin/traces/{id}
```

`GET /api/traces` solo devuelve contribuciones aprobadas.

Los endpoints `/api/admin/*` requieren login. El frontend obtiene un token temporal con la password definida en `.dev`.

## Acceso a administracion

Abre la administracion desde:

```text
https://mapamundi.2031granadaideal.es/admin
```

Tambien funciona:

```text
https://mapamundi.2031granadaideal.es/admin/
```

La portada publica no muestra el acceso a administracion. La pantalla de revision vive en `admin.html`, servida desde `/admin`. Se incluye tambien `admin/index.html` como redireccion de compatibilidad por si el servidor interpreta `/admin/` como carpeta estatica.

No abras directamente rutas como `/api/admin` o `/api/admin/login`; son endpoints internos para el formulario.

Si `/admin/` devuelve "File not found", comprueba en el servidor:

```bash
ls -la /var/www/mapamundi/admin/
ls -la /var/www/mapamundi/admin.html
sudo systemctl restart mapamundi
```

`POST /api/traces` recibe un formulario `multipart/form-data` con:

- `name`
- `email`
- `city`
- `country`
- `relation`
- `emotion`
- `feeling`
- `consent`
- `photo`

Las contribuciones nuevas entran como `pending`. Desde la seccion "Cola de revision" se pueden aprobar o rechazar.

## Solucion de problemas

Si al subir una foto aparece un error de peticion o de API, comprueba:

1. Que el servidor esta arrancado:

```bash
python3 server.py --host 0.0.0.0 --port 8080
```

2. Que has abierto la web desde la URL del servidor:

```text
http://localhost:8080
```

3. Que no estas entrando mediante:

```text
file:///...
```

4. Que el usuario del proceso tiene permisos de escritura en:

```text
data/
uploads/
```

## Backup

Detener el servicio o hacer una copia atomica con SQLite:

```bash
sqlite3 data/granada2031.sqlite3 ".backup 'backup-granada2031.sqlite3'"
tar -czf backup-uploads.tar.gz uploads/
```

## Nota de seguridad para produccion

Este MVP prioriza navegabilidad y flujo tecnico. Antes de publicarlo deberia anadirse:

- Autenticacion para la cola de revision.
- HTTPS mediante Nginx/Caddy.
- Politica RGPD completa.
- Escaneo/normalizacion de imagenes.
- Limites por IP y proteccion anti-spam.
- Separacion entre API publica y panel de administracion.
