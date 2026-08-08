# Granada 2031 - Geolocalizacion del Sentimiento

Navigable MVP with server-side storage for the "Geolocalizacion del Sentimiento" campaign.

The public map supports mouse-wheel zoom, `+`/`-` controls, view reset, and drag panning across regions with a high concentration of photos.

## Storage

The MVP uses SQLite as the server's local database:

- Database file: `data/granada2031.sqlite3`
- Uploaded images: `uploads/`
- Admin secrets: `.dev` (git-ignored)
- Public configuration: `config.json`
- Server: Bun (JavaScript/TypeScript runtime) with built-in SQLite support (`bun:sqlite`), no external dependencies

SQLite is the right choice for this phase: it needs no separate database service, backups are a single-file copy, and it comfortably handles a first moderated participatory campaign.

For a production phase with thousands of contributions, advanced geo search, analytics, or multi-user administration, the natural migration path is PostgreSQL with PostGIS and image storage in S3/MinIO.

## Running on Ubuntu 22.04

```bash
cd /path/to/project
bun run server.ts --host 0.0.0.0 --port 8080
```

Open:

```text
http://SERVER_IP:8080
```

Locally, if you're working on the machine itself:

```text
http://localhost:8080
```

Important: don't open `index.html` by double-clicking it or via a separate static server. Photo uploads need this same application served from `server.ts`, because that's where the API, SQLite, and the `uploads/` folder live.

## Testing

The project has a single test file, `tests/smoke.test.ts`, run with Bun's built-in test runner:

```bash
bun test
```

It spawns `server.ts` as a real child process on an OS-assigned ephemeral port, pointed at a
throwaway temp directory (via `GRANADA_DATA_DIR`, `GRANADA_UPLOAD_DIR`, `GRANADA_DB_PATH`,
`GRANADA_CONFIG_PATH`, `GRANADA_SECRETS_PATH`), and drives it over HTTP with `fetch`. It never
touches `data/`, `uploads/`, `config.json`, or `.dev` in the project root. `bun test` exits
non-zero with a clear failure message if any check fails — no extra flags needed.

Extend `tests/smoke.test.ts` (don't add new test files) as new endpoints or behaviors land.

## Admin password

Administration is protected server-side. Secrets live in a local `.dev` file that **is not committed to the repository** (it's in `.gitignore`). If it doesn't exist, the server creates it on startup with a random session secret. Change these values before publishing:

```json
{
  "admin_password": "change-this-password",
  "admin_session_secret": "change-this-long-secret-too"
}
```

Visible text still lives in `config.json`, which is versioned. `/api/config` only returns the `public` block to the browser, never the password or the session secret:

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

These files must be at the project root:

```text
.dev          # secrets, git-ignored
config.json   # public text, versioned
```

After editing it:

```bash
sudo systemctl restart mapamundi
```

## Text, logos, and legal links

The homepage reads visible text from `config.json`, inside the `public` block. There you can change:

- Browser title, brand name/subtitle, and main logo.
- Hero, call-to-action, map, form, and archive text.
- Form consent text.
- Footer, privacy policy link, legal notice link, and IDEAL logo.

To use logos, upload the files to the project, e.g.:

```text
/var/www/mapamundi/assets/logo-granada2031.png
/var/www/mapamundi/assets/logo-ideal.png
```

And set their paths as relative URLs:

```json
{
  "public": {
    "brand_logo": "/assets/logo-granada2031.png",
    "ideal_logo": "/assets/logo-ideal.png"
  }
}
```

If you leave `brand_logo` or `ideal_logo` empty, the site falls back to the default visual placeholder and the `IDEAL` text.

## Quick API check

If the API is wired up correctly, this should return JSON:

```bash
curl http://localhost:8080/api/health
```

Expected response:

```json
{
  "ok": true,
  "service": "mapamundi",
  "storage": "sqlite"
}
```

If `https://mapamundi.2031granadaideal.es/api/health` returns 404, Nginx isn't forwarding `/api` to the Bun process.

## Recommended Nginx configuration

Use Nginx as a full proxy in front of `server.ts`. Don't serve `index.html` directly from Nginx in this MVP, since the API lives on the same Bun server.

```nginx
server {
    listen 80;
    server_name mapamundi.2031granadaideal.es;

    client_max_body_size 8M;

    # Security headers (defense in depth, complement server-side T013 headers)
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Content-Security-Policy "default-src 'self'" always;

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

**Note on HTTPS:** When HTTPS is enabled (see "Production security note" below), create a second block with `listen 443 ssl http2` and include `Strict-Transport-Security` header. Browsers ignore HSTS over plain HTTP per RFC 6797, so it belongs only on the HTTPS block:

```nginx
server {
    listen 443 ssl http2;
    server_name mapamundi.2031granadaideal.es;

    # TLS certificates (e.g., from Let's Encrypt via Certbot)
    ssl_certificate /etc/letsencrypt/live/mapamundi.2031granadaideal.es/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/mapamundi.2031granadaideal.es/privkey.pem;

    client_max_body_size 8M;

    # Security headers (same as HTTP block, plus HSTS which only works on HTTPS)
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Content-Security-Policy "default-src 'self'" always;

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

Then:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## Included API

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

`GET /api/traces` only returns approved contributions.

`/api/admin/*` endpoints require login. The frontend obtains a temporary token using the password defined in `.dev`.

## Admin access

Open the admin panel from:

```text
https://mapamundi.2031granadaideal.es/admin
```

This also works:

```text
https://mapamundi.2031granadaideal.es/admin/
```

The public homepage doesn't surface the admin entry point. The review screen lives in `admin.html`, served from `/admin`. `admin/index.html` is also included as a compatibility redirect in case the server treats `/admin/` as a static folder.

Don't open routes like `/api/admin` or `/api/admin/login` directly; they're internal endpoints for the form.

If `/admin/` returns "File not found", check on the server:

```bash
ls -la /var/www/mapamundi/admin/
ls -la /var/www/mapamundi/admin.html
sudo systemctl restart mapamundi
```

`POST /api/traces` accepts a `multipart/form-data` submission with:

- `name`
- `email`
- `city`
- `country`
- `relation`
- `emotion`
- `feeling`
- `consent`
- `photo`

New contributions come in as `pending`. From the "Review queue" section they can be approved or rejected.

## Troubleshooting

If a photo upload triggers a request or API error, check:

1. That the server is running:

```bash
bun run server.ts --host 0.0.0.0 --port 8080
```

2. That you opened the site from the server's URL:

```text
http://localhost:8080
```

3. That you're not accessing it via:

```text
file:///...
```

4. That the process user has write permissions on:

```text
data/
uploads/
```

## Backup

Stop the service, or take an atomic SQLite backup:

```bash
sqlite3 data/granada2031.sqlite3 ".backup 'backup-granada2031.sqlite3'"
tar -czf backup-uploads.tar.gz uploads/
```

## Production security note

This MVP prioritizes navigability and technical flow. Before publishing it, the following should be added:

- Authentication for the review queue.
- HTTPS via Nginx/Caddy.
- Full GDPR policy.
- Image scanning/normalization.
- Per-IP limits and anti-spam protection.
- Separation between the public API and the admin panel.
