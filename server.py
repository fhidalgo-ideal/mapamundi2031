#!/usr/bin/env python3
import argparse
import cgi
import json
import base64
import hashlib
import hmac
import mimetypes
import os
import posixpath
import shutil
import sqlite3
import sys
import time
import unicodedata
import uuid
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
UPLOAD_DIR = BASE_DIR / "uploads"
DB_PATH = DATA_DIR / "granada2031.sqlite3"
CONFIG_PATH = BASE_DIR / "config.json"
SECRETS_PATH = BASE_DIR / ".dev"
APP_VERSION = "2026-05-07-config-footer"
MAX_UPLOAD_BYTES = 8 * 1024 * 1024
ADMIN_TOKEN_TTL_SECONDS = 12 * 60 * 60
ALLOWED_IMAGE_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}
DEFAULT_PUBLIC_CONFIG = {
    "site_title": "Granada 2031 | Geolocalizacion del Sentimiento",
    "brand_name": "Granada 2031",
    "brand_subtitle": "Geolocalizacion del Sentimiento",
    "brand_logo": "",
    "brand_logo_alt": "Granada 2031",
    "hero_eyebrow": "Candidatura cultural participativa",
    "hero_title": "Granada encendida en el mundo",
    "hero_text": "Cada foto compartida abre una luz: un recuerdo, una huella o una emocion que conecta a Granada con otra ciudad del planeta.",
    "submit_cta": "Subir un rastro",
    "latest_cta": "Ver ultima luz",
    "map_title": "Mapa vivo",
    "map_hint": "Rueda para acercar, arrastra para moverte y haz clic en una luz.",
    "submit_eyebrow": "Nueva contribucion",
    "submit_title": "Sube tu rastro de Granada",
    "archive_eyebrow": "Historias publicadas",
    "archive_title": "Archivo de luces",
    "consent_text": "Acepto que esta fotografia y el texto se usen en la accion cultural Granada 2031.",
    "footer_text": "Granada 2031. Geolocalizacion del Sentimiento.",
    "privacy_label": "Politica de privacidad",
    "privacy_url": "/politica-de-privacidad",
    "legal_label": "Aviso legal",
    "legal_url": "/aviso-legal",
    "ideal_logo": "",
    "ideal_logo_alt": "IDEAL",
    "ideal_url": "https://www.ideal.es",
}

CITY_COORDINATES = {
    ("granada", "espana"): (37.1773, -3.5986),
    ("madrid", "espana"): (40.4168, -3.7038),
    ("paris", "francia"): (48.8566, 2.3522),
    ("berlin", "alemania"): (52.5200, 13.4050),
    ("buenos aires", "argentina"): (-34.6037, -58.3816),
    ("ciudad de mexico", "mexico"): (19.4326, -99.1332),
    ("nueva york", "estados unidos"): (40.7128, -74.0060),
    ("tokio", "japon"): (35.6762, 139.6503),
    ("rabat", "marruecos"): (34.0209, -6.8416),
    ("londres", "reino unido"): (51.5072, -0.1276),
}

COUNTRY_FALLBACK = {
    "argentina": (-38.4161, -63.6167),
    "alemania": (51.1657, 10.4515),
    "espana": (40.4637, -3.7492),
    "francia": (46.2276, 2.2137),
    "japon": (36.2048, 138.2529),
    "marruecos": (31.7917, -7.0926),
    "mexico": (23.6345, -102.5528),
    "reino unido": (55.3781, -3.4360),
    "estados unidos": (37.0902, -95.7129),
}

SEED_TRACES = [
    {
        "id": "seed-berlin",
        "name": "Clara Munoz",
        "email": "clara@example.com",
        "city": "Berlin",
        "country": "Alemania",
        "lat": 52.52,
        "lng": 13.405,
        "relation": "Erasmus en Granada",
        "emotion": "nostalgia",
        "feeling": "Encontre una baldosa azul en Kreuzberg que me llevo de golpe a las tardes del Albaicin.",
        "photo": "/demo/berlin.svg",
        "status": "approved",
        "createdAt": "2026-04-12T10:30:00+00:00",
    },
    {
        "id": "seed-buenos-aires",
        "name": "Mateo Rivas",
        "email": "mateo@example.com",
        "city": "Buenos Aires",
        "country": "Argentina",
        "lat": -34.6037,
        "lng": -58.3816,
        "relation": "Familia o comunidad granadina",
        "emotion": "pertenencia",
        "feeling": "Mi abuela aun cocina con palabras de Granada. La ciudad vive en nuestra mesa los domingos.",
        "photo": "/demo/buenos-aires.svg",
        "status": "approved",
        "createdAt": "2026-03-02T16:20:00+00:00",
    },
    {
        "id": "seed-tokyo",
        "name": "Aiko Tanaka",
        "email": "aiko@example.com",
        "city": "Tokio",
        "country": "Japon",
        "lat": 35.6762,
        "lng": 139.6503,
        "relation": "Visitante",
        "emotion": "asombro",
        "feeling": "Una guitarra en una estacion de Tokio me devolvio el eco de una noche de flamenco en Sacromonte.",
        "photo": "/demo/tokyo.svg",
        "status": "approved",
        "createdAt": "2026-02-18T08:12:00+00:00",
    },
    {
        "id": "seed-rabat",
        "name": "Nadia El Amrani",
        "email": "nadia@example.com",
        "city": "Rabat",
        "country": "Marruecos",
        "lat": 34.0209,
        "lng": -6.8416,
        "relation": "Artista o investigador/a",
        "emotion": "futuro",
        "feeling": "Investigar Al-Andalus desde Rabat hace que Granada parezca una conversacion abierta, no un archivo cerrado.",
        "photo": "/demo/rabat.svg",
        "status": "pending",
        "createdAt": "2026-05-01T12:00:00+00:00",
    },
]


def ensure_config():
    if CONFIG_PATH.exists():
        return
    default_config = {"public": DEFAULT_PUBLIC_CONFIG}
    CONFIG_PATH.write_text(json.dumps(default_config, indent=2), encoding="utf-8")


def ensure_secrets():
    if SECRETS_PATH.exists():
        return
    default_secrets = {
        "admin_password": "cambia-esta-password",
        "admin_session_secret": uuid.uuid4().hex,
    }
    SECRETS_PATH.write_text(json.dumps(default_secrets, indent=2), encoding="utf-8")


def load_config():
    ensure_config()
    ensure_secrets()
    with CONFIG_PATH.open("r", encoding="utf-8") as config_file:
        config = json.load(config_file)
    with SECRETS_PATH.open("r", encoding="utf-8") as secrets_file:
        config.update(json.load(secrets_file))
    if not config.get("admin_password") or not config.get("admin_session_secret"):
        raise RuntimeError(".dev debe definir admin_password y admin_session_secret")
    return config


def load_public_config():
    config = load_config()
    public_config = DEFAULT_PUBLIC_CONFIG.copy()
    custom_public_config = config.get("public", {})
    if isinstance(custom_public_config, dict):
        public_config.update(custom_public_config)
    return public_config


def normalize(value):
    normalized = unicodedata.normalize("NFD", value.strip().lower())
    return "".join(char for char in normalized if unicodedata.category(char) != "Mn")


def resolve_coordinates(city, country):
    key = (normalize(city), normalize(country))
    if key in CITY_COORDINATES:
        return CITY_COORDINATES[key]
    country_key = normalize(country)
    if country_key in COUNTRY_FALLBACK:
        return COUNTRY_FALLBACK[country_key]

    seed = f"{city}{country}"
    hash_value = 0
    for char in seed:
        hash_value = (hash_value * 31 + ord(char)) % 100000
    lat = ((hash_value % 12000) / 100) - 60
    lng = (((hash_value * 7) % 32000) / 100) - 160
    return lat, lng


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def db_connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    DATA_DIR.mkdir(exist_ok=True)
    UPLOAD_DIR.mkdir(exist_ok=True)
    with db_connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS traces (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                email TEXT NOT NULL,
                city TEXT NOT NULL,
                country TEXT NOT NULL,
                lat REAL NOT NULL,
                lng REAL NOT NULL,
                relation TEXT NOT NULL,
                emotion TEXT NOT NULL,
                feeling TEXT NOT NULL,
                photo TEXT NOT NULL,
                status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'rejected')),
                consent INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            )
            """
        )
        count = conn.execute("SELECT COUNT(*) FROM traces").fetchone()[0]
        if count == 0:
            conn.executemany(
                """
                INSERT INTO traces (
                    id, name, email, city, country, lat, lng, relation, emotion,
                    feeling, photo, status, consent, created_at
                )
                VALUES (
                    :id, :name, :email, :city, :country, :lat, :lng, :relation,
                    :emotion, :feeling, :photo, :status, 1, :createdAt
                )
                """,
                SEED_TRACES,
            )


def row_to_trace(row):
    return {
        "id": row["id"],
        "name": row["name"],
        "email": row["email"],
        "city": row["city"],
        "country": row["country"],
        "lat": row["lat"],
        "lng": row["lng"],
        "relation": row["relation"],
        "emotion": row["emotion"],
        "feeling": row["feeling"],
        "photo": row["photo"],
        "status": row["status"],
        "createdAt": row["created_at"],
    }


def make_admin_token():
    config = load_config()
    expires_at = int(time.time()) + ADMIN_TOKEN_TTL_SECONDS
    payload = json.dumps({"exp": expires_at}, separators=(",", ":")).encode("utf-8")
    payload_b64 = base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")
    signature = hmac.new(
        config["admin_session_secret"].encode("utf-8"),
        payload_b64.encode("ascii"),
        hashlib.sha256,
    ).digest()
    signature_b64 = base64.urlsafe_b64encode(signature).decode("ascii").rstrip("=")
    return f"{payload_b64}.{signature_b64}"


def valid_admin_token(token):
    if not token or "." not in token:
        return False
    payload_b64, signature_b64 = token.split(".", 1)
    config = load_config()
    expected = hmac.new(
        config["admin_session_secret"].encode("utf-8"),
        payload_b64.encode("ascii"),
        hashlib.sha256,
    ).digest()
    try:
        received = base64.urlsafe_b64decode(signature_b64 + "=" * (-len(signature_b64) % 4))
        payload = json.loads(base64.urlsafe_b64decode(payload_b64 + "=" * (-len(payload_b64) % 4)))
    except (ValueError, json.JSONDecodeError):
        return False
    return hmac.compare_digest(received, expected) and int(payload.get("exp", 0)) > int(time.time())


def demo_svg(label, color_a, color_b):
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600" viewBox="0 0 900 600">
  <defs>
    <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="{color_a}"/>
      <stop offset="1" stop-color="{color_b}"/>
    </linearGradient>
  </defs>
  <rect width="900" height="600" fill="url(#g)"/>
  <path d="M95 420c122-96 244-138 366-126 134 13 222 99 344 35" fill="none" stroke="rgba(255,255,255,.46)" stroke-width="18" stroke-linecap="round"/>
  <circle cx="284" cy="212" r="54" fill="rgba(255,255,255,.22)"/>
  <circle cx="630" cy="184" r="28" fill="rgba(255,255,255,.25)"/>
  <text x="72" y="524" fill="white" font-family="Arial, sans-serif" font-size="42" font-weight="700">{label}</text>
</svg>""".encode("utf-8")


class GranadaHandler(SimpleHTTPRequestHandler):
    server_version = "Granada2031/0.1"

    def do_GET(self):
        path = urlparse(self.path).path
        normalized_path = path.rstrip("/") or "/"
        if path in {"/admin", "/admin/"}:
            self.path = "/admin.html"
            super().do_GET()
            return
        if path == "/api/health":
            self.json_response({
                "ok": True,
                "service": "mapamundi",
                "version": APP_VERSION,
                "baseDir": str(BASE_DIR),
                "storage": "sqlite",
                "database": str(DB_PATH),
            })
            return
        if path == "/api/config":
            self.json_response({"config": load_public_config()})
            return
        if path == "/api/traces":
            self.handle_get_traces()
            return
        if normalized_path == "/api/admin/traces":
            if not self.require_admin():
                return
            self.handle_get_admin_traces()
            return
        if normalized_path == "/api/admin/login":
            self.error_response("El login de administracion debe hacerse desde la web, no abriendo esta URL directamente.", HTTPStatus.METHOD_NOT_ALLOWED)
            return
        if path.startswith("/api/"):
            self.error_response("Endpoint de API no encontrado.", HTTPStatus.NOT_FOUND)
            return
        if path.startswith("/demo/"):
            self.handle_demo_image(path)
            return
        super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        normalized_path = path.rstrip("/") or "/"
        if normalized_path == "/api/admin/login":
            self.handle_admin_login()
            return
        if normalized_path == "/api/traces":
            self.handle_create_trace()
            return
        if path.startswith("/api/"):
            self.error_response("Endpoint de API no encontrado.", HTTPStatus.NOT_FOUND)
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def do_PATCH(self):
        path = urlparse(self.path).path
        normalized_path = path.rstrip("/") or "/"
        if normalized_path.startswith("/api/admin/traces/") and normalized_path.endswith("/status"):
            if not self.require_admin():
                return
            trace_id = normalized_path.removeprefix("/api/admin/traces/").removesuffix("/status").strip("/")
            self.handle_update_status(trace_id)
            return
        if normalized_path.startswith("/api/admin/traces/"):
            if not self.require_admin():
                return
            trace_id = normalized_path.removeprefix("/api/admin/traces/").strip("/")
            self.handle_update_trace(trace_id)
            return
        if path.startswith("/api/"):
            self.error_response("Endpoint de API no encontrado.", HTTPStatus.NOT_FOUND)
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def do_DELETE(self):
        path = urlparse(self.path).path
        normalized_path = path.rstrip("/") or "/"
        if normalized_path.startswith("/api/admin/traces/"):
            if not self.require_admin():
                return
            trace_id = normalized_path.removeprefix("/api/admin/traces/").strip("/")
            self.handle_delete_trace(trace_id)
            return
        if path.startswith("/api/"):
            self.error_response("Endpoint de API no encontrado.", HTTPStatus.NOT_FOUND)
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def translate_path(self, path):
        path = urlparse(path).path
        path = posixpath.normpath(unquote(path))
        words = [word for word in path.split("/") if word and word not in (os.curdir, os.pardir)]
        resolved = BASE_DIR
        for word in words:
            resolved = resolved / word
        return str(resolved)

    def json_response(self, payload, status=HTTPStatus.OK):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def error_response(self, message, status=HTTPStatus.BAD_REQUEST):
        self.json_response({"error": message}, status)

    def require_admin(self):
        authorization = self.headers.get("Authorization", "")
        prefix = "Bearer "
        if not authorization.startswith(prefix) or not valid_admin_token(authorization.removeprefix(prefix)):
            self.error_response("Acceso de administracion no autorizado.", HTTPStatus.UNAUTHORIZED)
            return False
        return True

    def handle_get_traces(self):
        with db_connect() as conn:
            rows = conn.execute(
                """
                SELECT * FROM traces
                WHERE status = 'approved'
                ORDER BY datetime(created_at) DESC
                """
            ).fetchall()
        self.json_response({"traces": [row_to_trace(row) for row in rows]})

    def handle_get_admin_traces(self):
        with db_connect() as conn:
            rows = conn.execute(
                """
                SELECT * FROM traces
                WHERE status IN ('pending', 'approved')
                ORDER BY
                    CASE status WHEN 'pending' THEN 0 ELSE 1 END,
                    datetime(created_at) DESC
                """
            ).fetchall()
        self.json_response({"traces": [row_to_trace(row) for row in rows]})

    def handle_admin_login(self):
        length = int(self.headers.get("Content-Length", "0"))
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
        except json.JSONDecodeError:
            self.error_response("JSON no valido.")
            return

        password = str(payload.get("password", ""))
        config = load_config()
        if not hmac.compare_digest(password, str(config["admin_password"])):
            self.error_response("Password de administracion incorrecta.", HTTPStatus.UNAUTHORIZED)
            return

        self.json_response({"token": make_admin_token(), "expiresIn": ADMIN_TOKEN_TTL_SECONDS})

    def handle_create_trace(self):
        content_length = int(self.headers.get("Content-Length", "0"))
        if content_length <= 0:
            self.error_response("La peticion no contiene datos.")
            return
        if content_length > MAX_UPLOAD_BYTES:
            self.error_response("La fotografia supera el limite de 8 MB.", HTTPStatus.REQUEST_ENTITY_TOO_LARGE)
            return

        content_type = self.headers.get("Content-Type", "")
        if "multipart/form-data" not in content_type:
            self.error_response("El formulario debe enviarse como multipart/form-data.")
            return

        form = cgi.FieldStorage(
            fp=self.rfile,
            headers=self.headers,
            environ={
                "REQUEST_METHOD": "POST",
                "CONTENT_TYPE": content_type,
                "CONTENT_LENGTH": str(content_length),
            },
        )

        required_fields = ["name", "email", "city", "country", "relation", "emotion", "feeling", "consent"]
        values = {}
        for field in required_fields:
            value = form.getfirst(field, "").strip()
            if not value:
                self.error_response(f"Falta el campo obligatorio: {field}.")
                return
            values[field] = value

        if values["emotion"] not in {"nostalgia", "pertenencia", "asombro", "futuro"}:
            self.error_response("La emocion indicada no es valida.")
            return

        photo_item = form["photo"] if "photo" in form else None
        if photo_item is None or not getattr(photo_item, "filename", ""):
            self.error_response("Falta la fotografia.")
            return

        media_type = photo_item.type or mimetypes.guess_type(photo_item.filename)[0]
        extension = ALLOWED_IMAGE_TYPES.get(media_type)
        if extension is None:
            self.error_response("Formato no permitido. Usa JPG, PNG o WEBP.")
            return

        trace_id = str(uuid.uuid4())
        file_name = f"{trace_id}{extension}"
        destination = UPLOAD_DIR / file_name
        with destination.open("wb") as output:
            shutil.copyfileobj(photo_item.file, output)

        lat, lng = resolve_coordinates(values["city"], values["country"])
        trace = {
            "id": trace_id,
            "name": values["name"][:120],
            "email": values["email"][:180],
            "city": values["city"][:120],
            "country": values["country"][:120],
            "lat": lat,
            "lng": lng,
            "relation": values["relation"][:160],
            "emotion": values["emotion"],
            "feeling": values["feeling"][:600],
            "photo": f"/uploads/{file_name}",
            "status": "pending",
            "consent": 1,
            "created_at": now_iso(),
        }

        with db_connect() as conn:
            conn.execute(
                """
                INSERT INTO traces (
                    id, name, email, city, country, lat, lng, relation, emotion,
                    feeling, photo, status, consent, created_at
                )
                VALUES (
                    :id, :name, :email, :city, :country, :lat, :lng, :relation,
                    :emotion, :feeling, :photo, :status, :consent, :created_at
                )
                """,
                trace,
            )

        self.json_response({"trace": trace}, HTTPStatus.CREATED)

    def handle_update_status(self, trace_id):
        length = int(self.headers.get("Content-Length", "0"))
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
        except json.JSONDecodeError:
            self.error_response("JSON no valido.")
            return

        status = payload.get("status")
        if status not in {"pending", "approved", "rejected"}:
            self.error_response("Estado no valido.")
            return

        with db_connect() as conn:
            cursor = conn.execute(
                "UPDATE traces SET status = ? WHERE id = ?",
                (status, trace_id),
            )
            if cursor.rowcount == 0:
                self.error_response("No existe esa contribucion.", HTTPStatus.NOT_FOUND)
                return
            row = conn.execute("SELECT * FROM traces WHERE id = ?", (trace_id,)).fetchone()

        self.json_response({"trace": row_to_trace(row)})

    def handle_update_trace(self, trace_id):
        length = int(self.headers.get("Content-Length", "0"))
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
        except json.JSONDecodeError:
            self.error_response("JSON no valido.")
            return

        allowed = {
            "name": 120,
            "email": 180,
            "city": 120,
            "country": 120,
            "relation": 160,
            "emotion": 40,
            "feeling": 600,
        }
        updates = {}
        for field, max_length in allowed.items():
            if field in payload:
                value = str(payload[field]).strip()[:max_length]
                if not value:
                    self.error_response(f"El campo {field} no puede estar vacio.")
                    return
                updates[field] = value

        if "emotion" in updates and updates["emotion"] not in {"nostalgia", "pertenencia", "asombro", "futuro"}:
            self.error_response("La emocion indicada no es valida.")
            return

        if "city" in updates or "country" in updates:
            with db_connect() as conn:
                current = conn.execute("SELECT city, country FROM traces WHERE id = ?", (trace_id,)).fetchone()
            if current is None:
                self.error_response("No existe esa contribucion.", HTTPStatus.NOT_FOUND)
                return
            city = updates.get("city", current["city"])
            country = updates.get("country", current["country"])
            lat, lng = resolve_coordinates(city, country)
            updates["lat"] = lat
            updates["lng"] = lng

        if not updates:
            self.error_response("No hay campos para actualizar.")
            return

        assignments = ", ".join(f"{field} = ?" for field in updates)
        values = list(updates.values()) + [trace_id]
        with db_connect() as conn:
            cursor = conn.execute(f"UPDATE traces SET {assignments} WHERE id = ?", values)
            if cursor.rowcount == 0:
                self.error_response("No existe esa contribucion.", HTTPStatus.NOT_FOUND)
                return
            row = conn.execute("SELECT * FROM traces WHERE id = ?", (trace_id,)).fetchone()

        self.json_response({"trace": row_to_trace(row)})

    def handle_delete_trace(self, trace_id):
        with db_connect() as conn:
            row = conn.execute("SELECT * FROM traces WHERE id = ?", (trace_id,)).fetchone()
            if row is None:
                self.error_response("No existe esa contribucion.", HTTPStatus.NOT_FOUND)
                return
            conn.execute("DELETE FROM traces WHERE id = ?", (trace_id,))

        photo = row["photo"]
        if photo.startswith("/uploads/"):
            upload_path = (BASE_DIR / photo.lstrip("/")).resolve()
            try:
                upload_path.relative_to(UPLOAD_DIR.resolve())
                upload_path.unlink(missing_ok=True)
            except (ValueError, OSError):
                pass

        self.json_response({"deleted": True, "id": trace_id})

    def handle_demo_image(self, path):
        demos = {
            "/demo/berlin.svg": ("Berlin recuerda Granada", "#263e60", "#f26d5b"),
            "/demo/buenos-aires.svg": ("Mesa granadina", "#21483d", "#f7c667"),
            "/demo/tokyo.svg": ("Eco del Sacromonte", "#103546", "#67d7c4"),
            "/demo/rabat.svg": ("Conversacion abierta", "#302854", "#b896ff"),
        }
        if path not in demos:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        body = demo_svg(*demos[path])
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "image/svg+xml; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    parser = argparse.ArgumentParser(description="Servidor MVP Granada 2031")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=8080, type=int)
    args = parser.parse_args()

    init_db()
    os.chdir(BASE_DIR)
    server = ThreadingHTTPServer((args.host, args.port), GranadaHandler)
    print(f"Granada 2031 escuchando en http://{args.host}:{args.port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor detenido.", file=sys.stderr)


if __name__ == "__main__":
    main()
