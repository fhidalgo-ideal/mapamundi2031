#!/usr/bin/env bun
import { Database } from "bun:sqlite";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, normalize, resolve, sep } from "node:path";

const BASE_DIR = dirname(import.meta.path);
const DATA_DIR = process.env.GRANADA_DATA_DIR ?? join(BASE_DIR, "data");
const UPLOAD_DIR = process.env.GRANADA_UPLOAD_DIR ?? join(BASE_DIR, "uploads");
const DB_PATH = process.env.GRANADA_DB_PATH ?? join(DATA_DIR, "granada2031.sqlite3");
const CONFIG_PATH = process.env.GRANADA_CONFIG_PATH ?? join(BASE_DIR, "config.json");
const SECRETS_PATH = process.env.GRANADA_SECRETS_PATH ?? join(BASE_DIR, ".dev");
const APP_VERSION = "2026-05-07-config-footer";
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = Number(process.env.GRANADA_MAX_IMAGE_DIMENSION ?? 6000);
const ADMIN_TOKEN_TTL_SECONDS = 12 * 60 * 60;
const TRACE_RATE_LIMIT_MAX = Number(process.env.GRANADA_TRACE_RATE_LIMIT_MAX ?? 5);
const TRACE_RATE_LIMIT_WINDOW_MS = Number(
  process.env.GRANADA_TRACE_RATE_LIMIT_WINDOW_MS ?? 60 * 60 * 1000,
);
const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};
const VALID_EMOTIONS = new Set(["nostalgia", "pertenencia", "asombro", "futuro"]);
const VALID_STATUSES = new Set(["pending", "approved", "rejected"]);

const DEFAULT_PUBLIC_CONFIG = {
  site_title: "Granada 2031 | Geolocalizacion del Sentimiento",
  brand_name: "Granada 2031",
  brand_subtitle: "Geolocalizacion del Sentimiento",
  brand_logo: "",
  brand_logo_alt: "Granada 2031",
  hero_eyebrow: "Candidatura cultural participativa",
  hero_title: "Granada encendida en el mundo",
  hero_text:
    "Cada foto compartida abre una luz: un recuerdo, una huella o una emocion que conecta a Granada con otra ciudad del planeta.",
  submit_cta: "Subir un rastro",
  latest_cta: "Ver ultima luz",
  map_title: "Mapa vivo",
  map_hint: "Rueda para acercar, arrastra para moverte y haz clic en una luz.",
  submit_eyebrow: "Nueva contribucion",
  submit_title: "Sube tu rastro de Granada",
  archive_eyebrow: "Historias publicadas",
  archive_title: "Archivo de luces",
  consent_text: "Acepto que esta fotografia y el texto se usen en la accion cultural Granada 2031.",
  footer_text: "Granada 2031. Geolocalizacion del Sentimiento.",
  privacy_label: "Politica de privacidad",
  privacy_url: "/politica-de-privacidad",
  legal_label: "Aviso legal",
  legal_url: "/aviso-legal",
  ideal_logo: "",
  ideal_logo_alt: "IDEAL",
  ideal_url: "https://www.ideal.es",
};

const CITY_COORDINATES: Record<string, [number, number]> = {
  "granada|espana": [37.1773, -3.5986],
  "madrid|espana": [40.4168, -3.7038],
  "paris|francia": [48.8566, 2.3522],
  "berlin|alemania": [52.52, 13.405],
  "buenos aires|argentina": [-34.6037, -58.3816],
  "ciudad de mexico|mexico": [19.4326, -99.1332],
  "nueva york|estados unidos": [40.7128, -74.006],
  "tokio|japon": [35.6762, 139.6503],
  "rabat|marruecos": [34.0209, -6.8416],
  "londres|reino unido": [51.5072, -0.1276],
};

const COUNTRY_FALLBACK: Record<string, [number, number]> = {
  argentina: [-38.4161, -63.6167],
  alemania: [51.1657, 10.4515],
  espana: [40.4637, -3.7492],
  francia: [46.2276, 2.2137],
  japon: [36.2048, 138.2529],
  marruecos: [31.7917, -7.0926],
  mexico: [23.6345, -102.5528],
  "reino unido": [55.3781, -3.436],
  "estados unidos": [37.0902, -95.7129],
};

interface SeedTrace {
  id: string;
  name: string;
  email: string;
  city: string;
  country: string;
  lat: number;
  lng: number;
  relation: string;
  emotion: string;
  feeling: string;
  photo: string;
  status: string;
  createdAt: string;
}

const SEED_TRACES: SeedTrace[] = [
  {
    id: "seed-berlin",
    name: "Clara Munoz",
    email: "clara@example.com",
    city: "Berlin",
    country: "Alemania",
    lat: 52.52,
    lng: 13.405,
    relation: "Erasmus en Granada",
    emotion: "nostalgia",
    feeling: "Encontre una baldosa azul en Kreuzberg que me llevo de golpe a las tardes del Albaicin.",
    photo: "/demo/berlin.svg",
    status: "approved",
    createdAt: "2026-04-12T10:30:00+00:00",
  },
  {
    id: "seed-buenos-aires",
    name: "Mateo Rivas",
    email: "mateo@example.com",
    city: "Buenos Aires",
    country: "Argentina",
    lat: -34.6037,
    lng: -58.3816,
    relation: "Familia o comunidad granadina",
    emotion: "pertenencia",
    feeling: "Mi abuela aun cocina con palabras de Granada. La ciudad vive en nuestra mesa los domingos.",
    photo: "/demo/buenos-aires.svg",
    status: "approved",
    createdAt: "2026-03-02T16:20:00+00:00",
  },
  {
    id: "seed-tokyo",
    name: "Aiko Tanaka",
    email: "aiko@example.com",
    city: "Tokio",
    country: "Japon",
    lat: 35.6762,
    lng: 139.6503,
    relation: "Visitante",
    emotion: "asombro",
    feeling: "Una guitarra en una estacion de Tokio me devolvio el eco de una noche de flamenco en Sacromonte.",
    photo: "/demo/tokyo.svg",
    status: "approved",
    createdAt: "2026-02-18T08:12:00+00:00",
  },
  {
    id: "seed-rabat",
    name: "Nadia El Amrani",
    email: "nadia@example.com",
    city: "Rabat",
    country: "Marruecos",
    lat: 34.0209,
    lng: -6.8416,
    relation: "Artista o investigador/a",
    emotion: "futuro",
    feeling:
      "Investigar Al-Andalus desde Rabat hace que Granada parezca una conversacion abierta, no un archivo cerrado.",
    photo: "/demo/rabat.svg",
    status: "pending",
    createdAt: "2026-05-01T12:00:00+00:00",
  },
];

function ensureConfig() {
  if (existsSync(CONFIG_PATH)) return;
  writeFileSync(CONFIG_PATH, JSON.stringify({ public: DEFAULT_PUBLIC_CONFIG }, null, 2), "utf-8");
}

function ensureSecrets() {
  if (existsSync(SECRETS_PATH)) return;
  const defaultSecrets = {
    admin_password: "cambia-esta-password",
    admin_session_secret: randomUUID().replace(/-/g, ""),
  };
  writeFileSync(SECRETS_PATH, JSON.stringify(defaultSecrets, null, 2), "utf-8");
}

function loadConfig(): Record<string, unknown> {
  ensureConfig();
  ensureSecrets();
  const config = JSON.parse(readFileSync(CONFIG_PATH, "utf-8") || "{}") as Record<string, unknown>;
  const secretsText = readFileSync(SECRETS_PATH, "utf-8");
  Object.assign(config, JSON.parse(secretsText));
  if (!config.admin_password || !config.admin_session_secret) {
    throw new Error(".dev debe definir admin_password y admin_session_secret");
  }
  return config;
}

function loadPublicConfig(): Record<string, unknown> {
  const config = loadConfig();
  const publicConfig: Record<string, unknown> = { ...DEFAULT_PUBLIC_CONFIG };
  const custom = config.public;
  if (custom && typeof custom === "object") {
    Object.assign(publicConfig, custom as Record<string, unknown>);
  }
  return publicConfig;
}

function normalizeText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function resolveCoordinates(city: string, country: string): [number, number] {
  const key = `${normalizeText(city)}|${normalizeText(country)}`;
  if (key in CITY_COORDINATES) return CITY_COORDINATES[key];
  const countryKey = normalizeText(country);
  if (countryKey in COUNTRY_FALLBACK) return COUNTRY_FALLBACK[countryKey];

  const seed = `${city}${country}`;
  let hashValue = 0;
  for (const char of seed) {
    hashValue = (hashValue * 31 + char.codePointAt(0)!) % 100000;
  }
  const lat = ((hashValue % 12000) / 100) - 60;
  const lng = (((hashValue * 7) % 32000) / 100) - 160;
  return [lat, lng];
}

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00");
}

let db: Database;

function initDb() {
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(UPLOAD_DIR, { recursive: true });
  db = new Database(DB_PATH);
  db.exec(`
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
  `);
  const { count } = db.query("SELECT COUNT(*) as count FROM traces").get() as { count: number };
  if (count === 0) {
    const insert = db.prepare(`
      INSERT INTO traces (
        id, name, email, city, country, lat, lng, relation, emotion,
        feeling, photo, status, consent, created_at
      )
      VALUES ($id, $name, $email, $city, $country, $lat, $lng, $relation,
        $emotion, $feeling, $photo, $status, 1, $createdAt)
    `);
    const insertMany = db.transaction((traces: SeedTrace[]) => {
      for (const trace of traces) {
        insert.run({
          $id: trace.id,
          $name: trace.name,
          $email: trace.email,
          $city: trace.city,
          $country: trace.country,
          $lat: trace.lat,
          $lng: trace.lng,
          $relation: trace.relation,
          $emotion: trace.emotion,
          $feeling: trace.feeling,
          $photo: trace.photo,
          $status: trace.status,
          $createdAt: trace.createdAt,
        });
      }
    });
    insertMany(SEED_TRACES);
  }
}

interface TraceRow {
  id: string;
  name: string;
  email: string;
  city: string;
  country: string;
  lat: number;
  lng: number;
  relation: string;
  emotion: string;
  feeling: string;
  photo: string;
  status: string;
  created_at: string;
}

function rowToTrace(row: TraceRow) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    city: row.city,
    country: row.country,
    lat: row.lat,
    lng: row.lng,
    relation: row.relation,
    emotion: row.emotion,
    feeling: row.feeling,
    photo: row.photo,
    status: row.status,
    createdAt: row.created_at,
  };
}

function base64UrlEncode(data: Buffer): string {
  return data.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): Buffer {
  const padded = value + "=".repeat((4 - (value.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function makeAdminToken(): string {
  const config = loadConfig();
  const expiresAt = Math.floor(Date.now() / 1000) + ADMIN_TOKEN_TTL_SECONDS;
  const payload = Buffer.from(JSON.stringify({ exp: expiresAt }), "utf-8");
  const payloadB64 = base64UrlEncode(payload);
  const signature = createHmac("sha256", String(config.admin_session_secret)).update(payloadB64).digest();
  const signatureB64 = base64UrlEncode(signature);
  return `${payloadB64}.${signatureB64}`;
}

function validAdminToken(token: string | null): boolean {
  if (!token || !token.includes(".")) return false;
  const [payloadB64, signatureB64] = token.split(".", 2);
  const config = loadConfig();
  const expected = createHmac("sha256", String(config.admin_session_secret)).update(payloadB64).digest();
  let received: Buffer;
  let payload: { exp?: number };
  try {
    received = base64UrlDecode(signatureB64);
    payload = JSON.parse(base64UrlDecode(payloadB64).toString("utf-8"));
  } catch {
    return false;
  }
  if (received.length !== expected.length) return false;
  return timingSafeEqual(received, expected) && Number(payload.exp ?? 0) > Math.floor(Date.now() / 1000);
}

function sniffImageSignature(headerBytes: Uint8Array): string | null {
  // JPEG: FF D8
  if (headerBytes[0] === 0xff && headerBytes[1] === 0xd8) {
    return "image/jpeg";
  }

  // PNG: 89 50 4E 47
  if (
    headerBytes[0] === 0x89 &&
    headerBytes[1] === 0x50 &&
    headerBytes[2] === 0x4e &&
    headerBytes[3] === 0x47
  ) {
    return "image/png";
  }

  // WEBP: RIFF (at 0-3) + size (4-7) + WEBP (at 8-11)
  if (
    headerBytes[0] === 0x52 && // R
    headerBytes[1] === 0x49 && // I
    headerBytes[2] === 0x46 && // F
    headerBytes[3] === 0x46 && // F
    headerBytes[8] === 0x57 && // W
    headerBytes[9] === 0x45 && // E
    headerBytes[10] === 0x42 && // B
    headerBytes[11] === 0x50 // P
  ) {
    return "image/webp";
  }

  return null;
}

// Parses intrinsic pixel dimensions straight from container headers, WITHOUT
// decoding the pixel data — the whole point of the anti-decompression-bomb
// guard. Returns [0, 0] when the header is truncated or unrecognizable so the
// caller treats it as an invalid image.
function readImageDimensions(data: Uint8Array, kind: string): [number, number] {
  const u16be = (o: number): number => (data[o] << 8) | data[o + 1];
  const u16le = (o: number): number => data[o] | (data[o + 1] << 8);
  const u24le = (o: number): number =>
    data[o] | (data[o + 1] << 8) | (data[o + 2] << 16);

  if (kind === "image/jpeg") {
    // Walk marker segments using each segment's declared length, exactly as a
    // real JPEG decoder does, until a Start-Of-Frame (SOFn) marker carries the
    // frame size. Reading the SAME SOF the decoder uses is what makes the guard
    // sound: an attacker cannot plant a decoy SOF inside another segment's
    // payload to make us read a small size while the decoder still decodes a
    // huge (bomb) frame, because we skip segment payloads by their length.
    let offset = 2; // skip SOI (FF D8)
    while (offset + 1 < data.length) {
      if (data[offset] !== 0xff) {
        offset++;
        continue;
      }
      let marker = data[offset + 1];
      // Collapse marker padding (runs of 0xFF preceding the marker id).
      while (marker === 0xff && offset + 1 < data.length) {
        offset++;
        marker = data[offset + 1];
      }
      offset += 2;
      // Standalone markers with no payload: TEM (0x01) and RSTn/SOI/EOI
      // (0xD0-0xD9). Start-Of-Scan (0xDA) means entropy data follows, so any
      // SOF must already have been seen.
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
        if (marker === 0xda) break;
        continue;
      }
      if (offset + 1 >= data.length) break;
      const segLen = u16be(offset);
      // SOF markers 0xC0-0xCF except DHT (0xC4), JPG (0xC8), DAC (0xCC).
      const isSof =
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc;
      if (isSof) {
        // segment: [len:2][precision:1][height:2][width:2]
        if (offset + 6 >= data.length) break;
        const height = u16be(offset + 3);
        const width = u16be(offset + 5);
        return [width, height];
      }
      if (segLen < 2) break; // malformed length; avoid an infinite loop
      offset += segLen;
    }
    return [0, 0];
  }

  if (kind === "image/png") {
    // 8-byte signature, then IHDR chunk: [len:4]["IHDR":4][width:4][height:4].
    if (data.length < 24) return [0, 0];
    const width = (data[16] << 24) | (data[17] << 16) | (data[18] << 8) | data[19];
    const height = (data[20] << 24) | (data[21] << 16) | (data[22] << 8) | data[23];
    return [width >>> 0, height >>> 0];
  }

  if (kind === "image/webp") {
    // RIFF (0-3) size (4-7) WEBP (8-11) then a chunk FourCC at offset 12.
    if (data.length < 16) return [0, 0];
    const fourcc = String.fromCharCode(data[12], data[13], data[14], data[15]);
    if (fourcc === "VP8 ") {
      // Lossy: frame tag (3) + start code 9D 01 2A (3) then 14-bit dims LE.
      if (data.length < 30) return [0, 0];
      const width = u16le(26) & 0x3fff;
      const height = u16le(28) & 0x3fff;
      return [width, height];
    }
    if (fourcc === "VP8L") {
      // Lossless: signature 0x2F at 20, then 14-bit (width-1)/(height-1).
      if (data.length < 25) return [0, 0];
      const b0 = data[21];
      const b1 = data[22];
      const b2 = data[23];
      const b3 = data[24];
      const width = 1 + (((b1 & 0x3f) << 8) | b0);
      const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
      return [width, height];
    }
    if (fourcc === "VP8X") {
      // Extended: 3-byte (canvas width-1) at 24, (canvas height-1) at 27, LE.
      if (data.length < 30) return [0, 0];
      const width = 1 + u24le(24);
      const height = 1 + u24le(27);
      return [width, height];
    }
    return [0, 0];
  }

  return [0, 0];
}

function demoSvg(label: string, colorA: string, colorB: string): Uint8Array {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600" viewBox="0 0 900 600">
  <defs>
    <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="${colorA}"/>
      <stop offset="1" stop-color="${colorB}"/>
    </linearGradient>
  </defs>
  <rect width="900" height="600" fill="url(#g)"/>
  <path d="M95 420c122-96 244-138 366-126 134 13 222 99 344 35" fill="none" stroke="rgba(255,255,255,.46)" stroke-width="18" stroke-linecap="round"/>
  <circle cx="284" cy="212" r="54" fill="rgba(255,255,255,.22)"/>
  <circle cx="630" cy="184" r="28" fill="rgba(255,255,255,.25)"/>
  <text x="72" y="524" fill="white" font-family="Arial, sans-serif" font-size="42" font-weight="700">${label}</text>
</svg>`;
  return new TextEncoder().encode(svg);
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}

function requireAdmin(request: Request): Response | null {
  const authorization = request.headers.get("Authorization") ?? "";
  const prefix = "Bearer ";
  const token = authorization.startsWith(prefix) ? authorization.slice(prefix.length) : null;
  if (!validAdminToken(token)) {
    return errorResponse("Acceso de administracion no autorizado.", 401);
  }
  return null;
}

function handleGetTraces(): Response {
  const rows = db
    .query("SELECT * FROM traces WHERE status = 'approved' ORDER BY datetime(created_at) DESC")
    .all() as TraceRow[];
  return jsonResponse({ traces: rows.map(rowToTrace) });
}

function handleGetAdminTraces(): Response {
  const rows = db
    .query(
      `SELECT * FROM traces WHERE status IN ('pending', 'approved')
       ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, datetime(created_at) DESC`,
    )
    .all() as TraceRow[];
  return jsonResponse({ traces: rows.map(rowToTrace) });
}

async function handleAdminLogin(request: Request): Promise<Response> {
  let payload: { password?: unknown };
  try {
    payload = await request.json();
  } catch {
    return errorResponse("JSON no valido.");
  }
  const password = String(payload.password ?? "");
  const config = loadConfig();
  const expected = String(config.admin_password);
  const passwordBuf = Buffer.from(password, "utf-8");
  const expectedBuf = Buffer.from(expected, "utf-8");
  const matches =
    passwordBuf.length === expectedBuf.length && timingSafeEqual(passwordBuf, expectedBuf);
  if (!matches) {
    return errorResponse("Password de administracion incorrecta.", 401);
  }
  return jsonResponse({ token: makeAdminToken(), expiresIn: ADMIN_TOKEN_TTL_SECONDS });
}

interface IpResolvingServer {
  requestIP(request: Request): { address: string } | null;
}

const TRUSTED_PROXY_ADDRESSES: Record<string, true> = { "127.0.0.1": true, "::1": true };

// Trust X-Forwarded-For only when the direct socket peer is a local/trusted
// proxy (e.g. an nginx reverse proxy on the same host forwarding over
// loopback); otherwise a direct, untrusted client could spoof the header
// and get a fresh rate-limit bucket on every request.
function getClientIp(request: Request, server?: IpResolvingServer): string {
  const remoteAddress = server?.requestIP(request)?.address ?? null;
  if (remoteAddress && TRUSTED_PROXY_ADDRESSES[remoteAddress]) {
    const forwardedFor = request.headers.get("X-Forwarded-For");
    if (forwardedFor) {
      const candidate = forwardedFor.split(",")[0]?.trim();
      if (candidate) return candidate;
    }
  }
  return remoteAddress ?? "unknown";
}

interface RateLimitResult {
  limited: boolean;
  retryAfterSeconds: number;
}

function createRateLimiter(maxHits: number, windowMs: number) {
  const hitsByKey = new Map<string, number[]>();
  return function check(key: string): RateLimitResult {
    const now = Date.now();
    const windowStart = now - windowMs;
    const recentHits = (hitsByKey.get(key) ?? []).filter((timestamp) => timestamp > windowStart);
    if (recentHits.length >= maxHits) {
      hitsByKey.set(key, recentHits);
      const retryAfterMs = recentHits[0] + windowMs - now;
      return { limited: true, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
    }
    recentHits.push(now);
    hitsByKey.set(key, recentHits);
    return { limited: false, retryAfterSeconds: 0 };
  };
}

const checkTraceRateLimit = createRateLimiter(TRACE_RATE_LIMIT_MAX, TRACE_RATE_LIMIT_WINDOW_MS);

const GENERIC_SUBMISSION_ERROR = "No se ha podido procesar tu contribucion. Intentalo de nuevo mas tarde.";

async function handleCreateTrace(request: Request, server?: IpResolvingServer): Promise<Response> {
  const clientIp = getClientIp(request, server);
  const rateLimit = checkTraceRateLimit(clientIp);
  if (rateLimit.limited) {
    const response = errorResponse(
      "Demasiadas contribuciones enviadas desde esta conexion. Intentalo mas tarde.",
      429,
    );
    response.headers.set("Retry-After", String(rateLimit.retryAfterSeconds));
    return response;
  }

  const contentLength = Number(request.headers.get("Content-Length") ?? "0");
  if (contentLength > MAX_UPLOAD_BYTES) {
    return errorResponse("La fotografia supera el limite de 8 MB.", 413);
  }
  const contentType = request.headers.get("Content-Type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return errorResponse("El formulario debe enviarse como multipart/form-data.");
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorResponse("La peticion no contiene datos.");
  }

  const honeypot = String(form.get("website") ?? "").trim();
  if (honeypot) {
    return errorResponse(GENERIC_SUBMISSION_ERROR);
  }

  const requiredFields = ["name", "email", "city", "country", "relation", "emotion", "feeling", "consent"];
  const values: Record<string, string> = {};
  for (const field of requiredFields) {
    const value = String(form.get(field) ?? "").trim();
    if (!value) {
      return errorResponse(`Falta el campo obligatorio: ${field}.`);
    }
    values[field] = value;
  }

  if (!VALID_EMOTIONS.has(values.emotion)) {
    return errorResponse("La emocion indicada no es valida.");
  }

  const consentTruthy = ["true", "on", "1"].includes(values.consent.toLowerCase());
  if (!consentTruthy) {
    return errorResponse("Debes aceptar el consentimiento para continuar.");
  }

  const photo = form.get("photo");
  if (!(photo instanceof File) || !photo.name) {
    return errorResponse("Falta la fotografia.");
  }
  if (photo.size > MAX_UPLOAD_BYTES) {
    return errorResponse("La fotografia supera el limite de 8 MB.", 413);
  }

  const mediaType = photo.type;
  if (!ALLOWED_IMAGE_TYPES[mediaType]) {
    return errorResponse("Formato no permitido. Usa JPG, PNG o WEBP.");
  }

  // Validate binary signature independently of Content-Type/extension
  const headerBytes = new Uint8Array(await photo.arrayBuffer());
  const sniffedType = sniffImageSignature(headerBytes);
  if (!sniffedType) {
    return errorResponse("La fotografia no tiene un formato valido (JPG, PNG o WEBP).");
  }

  // Anti decompression-bomb: read intrinsic dimensions from the header only
  // (no full pixel decode) and reject oversized canvases before persisting.
  const [imgWidth, imgHeight] = readImageDimensions(headerBytes, sniffedType);
  if (imgWidth <= 0 || imgHeight <= 0) {
    return errorResponse("No se pudieron leer las dimensiones de la fotografia.");
  }
  if (imgWidth > MAX_IMAGE_DIMENSION || imgHeight > MAX_IMAGE_DIMENSION) {
    return errorResponse(
      `La fotografia excede el tamano maximo de ${MAX_IMAGE_DIMENSION}x${MAX_IMAGE_DIMENSION} px.`,
      413,
    );
  }

  // Use sniffed type for extension to ensure content/extension alignment
  const extension = ALLOWED_IMAGE_TYPES[sniffedType]!;

  const traceId = randomUUID();
  const fileName = `${traceId}${extension}`;
  const destination = join(UPLOAD_DIR, fileName);
  await Bun.write(destination, photo);

  const [lat, lng] = resolveCoordinates(values.city, values.country);
  const trace = {
    id: traceId,
    name: values.name.slice(0, 120),
    email: values.email.slice(0, 180),
    city: values.city.slice(0, 120),
    country: values.country.slice(0, 120),
    lat,
    lng,
    relation: values.relation.slice(0, 160),
    emotion: values.emotion,
    feeling: values.feeling.slice(0, 600),
    photo: `/uploads/${fileName}`,
    status: "pending",
    consent: 1,
    created_at: nowIso(),
  };

  db.prepare(
    `INSERT INTO traces (
      id, name, email, city, country, lat, lng, relation, emotion,
      feeling, photo, status, consent, created_at
    ) VALUES ($id, $name, $email, $city, $country, $lat, $lng, $relation,
      $emotion, $feeling, $photo, $status, $consent, $created_at)`,
  ).run({
    $id: trace.id,
    $name: trace.name,
    $email: trace.email,
    $city: trace.city,
    $country: trace.country,
    $lat: trace.lat,
    $lng: trace.lng,
    $relation: trace.relation,
    $emotion: trace.emotion,
    $feeling: trace.feeling,
    $photo: trace.photo,
    $status: trace.status,
    $consent: trace.consent,
    $created_at: trace.created_at,
  });

  return jsonResponse({ trace: rowToTrace(trace as unknown as TraceRow) }, 201);
}

async function handleUpdateStatus(request: Request, traceId: string): Promise<Response> {
  let payload: { status?: unknown };
  try {
    payload = await request.json();
  } catch {
    return errorResponse("JSON no valido.");
  }
  const status = payload.status;
  if (typeof status !== "string" || !VALID_STATUSES.has(status)) {
    return errorResponse("Estado no valido.");
  }
  const result = db.prepare("UPDATE traces SET status = ? WHERE id = ?").run(status, traceId);
  if (result.changes === 0) {
    return errorResponse("No existe esa contribucion.", 404);
  }
  const row = db.query("SELECT * FROM traces WHERE id = ?").get(traceId) as TraceRow;
  return jsonResponse({ trace: rowToTrace(row) });
}

async function handleUpdateTrace(request: Request, traceId: string): Promise<Response> {
  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return errorResponse("JSON no valido.");
  }

  const allowed: Record<string, number> = {
    name: 120,
    email: 180,
    city: 120,
    country: 120,
    relation: 160,
    emotion: 40,
    feeling: 600,
  };
  const updates: Record<string, string | number> = {};
  for (const [field, maxLength] of Object.entries(allowed)) {
    if (field in payload) {
      const value = String(payload[field]).trim().slice(0, maxLength);
      if (!value) {
        return errorResponse(`El campo ${field} no puede estar vacio.`);
      }
      updates[field] = value;
    }
  }

  if ("emotion" in updates && !VALID_EMOTIONS.has(updates.emotion as string)) {
    return errorResponse("La emocion indicada no es valida.");
  }

  if ("city" in updates || "country" in updates) {
    const current = db.query("SELECT city, country FROM traces WHERE id = ?").get(traceId) as
      | { city: string; country: string }
      | undefined;
    if (!current) {
      return errorResponse("No existe esa contribucion.", 404);
    }
    const city = (updates.city as string) ?? current.city;
    const country = (updates.country as string) ?? current.country;
    const [lat, lng] = resolveCoordinates(city, country);
    updates.lat = lat;
    updates.lng = lng;
  }

  if (Object.keys(updates).length === 0) {
    return errorResponse("No hay campos para actualizar.");
  }

  const assignments = Object.keys(updates)
    .map((field) => `${field} = ?`)
    .join(", ");
  const values = [...Object.values(updates), traceId];
  const result = db.prepare(`UPDATE traces SET ${assignments} WHERE id = ?`).run(...values);
  if (result.changes === 0) {
    return errorResponse("No existe esa contribucion.", 404);
  }
  const row = db.query("SELECT * FROM traces WHERE id = ?").get(traceId) as TraceRow;
  return jsonResponse({ trace: rowToTrace(row) });
}

function handleDeleteTrace(traceId: string): Response {
  const row = db.query("SELECT * FROM traces WHERE id = ?").get(traceId) as TraceRow | undefined;
  if (!row) {
    return errorResponse("No existe esa contribucion.", 404);
  }
  db.prepare("DELETE FROM traces WHERE id = ?").run(traceId);

  if (row.photo.startsWith("/uploads/")) {
    const fileName = row.photo.slice("/uploads/".length);
    const uploadPath = resolve(UPLOAD_DIR, fileName);
    const uploadRoot = resolve(UPLOAD_DIR) + sep;
    if (uploadPath.startsWith(uploadRoot)) {
      try {
        unlinkSync(uploadPath);
      } catch {
        // file already gone; not an error for the logical delete
      }
    }
  }

  return jsonResponse({ deleted: true, id: traceId });
}

const DEMOS: Record<string, [string, string, string]> = {
  "/demo/berlin.svg": ["Berlin recuerda Granada", "#263e60", "#f26d5b"],
  "/demo/buenos-aires.svg": ["Mesa granadina", "#21483d", "#f7c667"],
  "/demo/tokyo.svg": ["Eco del Sacromonte", "#103546", "#67d7c4"],
  "/demo/rabat.svg": ["Conversacion abierta", "#302854", "#b896ff"],
};

function handleDemoImage(path: string): Response {
  const demo = DEMOS[path];
  if (!demo) return new Response("Not Found", { status: 404 });
  const body = demoSvg(...demo);
  return new Response(body, { headers: { "Content-Type": "image/svg+xml; charset=utf-8" } });
}

// Explicit allowlist: never serve static files outside these paths, so .dev
// (secrets), server.ts (source code), and everything else in BASE_DIR stays
// unreachable just by virtue of living in the project directory.
const PUBLIC_FILES = new Set(["/index.html", "/admin.html", "/app.js", "/admin.js", "/styles.css", "/config.json"]);
const PUBLIC_DIRS = ["/admin/", "/uploads/", "/assets/"];

function resolveStaticPath(pathname: string): string | null {
  let cleaned = decodeURIComponent(pathname);
  if (cleaned.endsWith("/")) cleaned += "index.html";

  // /uploads/* resolves against UPLOAD_DIR (which GRANADA_UPLOAD_DIR can move
  // outside BASE_DIR, e.g. for isolated tests), not against the project root.
  if (cleaned.startsWith("/uploads/")) {
    const segments = normalize(cleaned.slice("/uploads/".length))
      .split("/")
      .filter((segment) => segment && segment !== "." && segment !== "..");
    const resolved = resolve(UPLOAD_DIR, ...segments);
    const uploadRoot = resolve(UPLOAD_DIR) + sep;
    if (!resolved.startsWith(uploadRoot)) return null;
    return resolved;
  }

  const isAllowed = PUBLIC_FILES.has(cleaned) || PUBLIC_DIRS.some((dir) => cleaned.startsWith(dir));
  if (!isAllowed) return null;

  const segments = normalize(cleaned)
    .split("/")
    .filter((segment) => segment && segment !== "." && segment !== "..");
  const resolved = resolve(BASE_DIR, ...segments);
  const baseWithSep = resolve(BASE_DIR) + sep;
  if (resolved !== resolve(BASE_DIR) && !resolved.startsWith(baseWithSep)) {
    return null;
  }
  return resolved;
}

async function serveStatic(pathname: string): Promise<Response> {
  const resolved = resolveStaticPath(pathname === "/" ? "/index.html" : pathname);
  if (!resolved) return new Response("Not Found", { status: 404 });
  const file = Bun.file(resolved);
  if (!(await file.exists())) return new Response("Not Found", { status: 404 });
  return new Response(file);
}

async function handleRequest(request: Request, server?: IpResolvingServer): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const normalizedPath = path.replace(/\/+$/, "") || "/";

  if (request.method === "GET") {
    if (path === "/admin" || path === "/admin/") {
      return serveStatic("/admin.html");
    }
    if (path === "/api/health") {
      return jsonResponse({
        ok: true,
        service: "mapamundi",
        version: APP_VERSION,
        baseDir: BASE_DIR,
        storage: "sqlite",
        database: DB_PATH,
      });
    }
    if (path === "/api/config") {
      return jsonResponse({ config: loadPublicConfig() });
    }
    if (path === "/api/traces") {
      return handleGetTraces();
    }
    if (normalizedPath === "/api/admin/traces") {
      const denied = requireAdmin(request);
      if (denied) return denied;
      return handleGetAdminTraces();
    }
    if (normalizedPath === "/api/admin/login") {
      return errorResponse(
        "El login de administracion debe hacerse desde la web, no abriendo esta URL directamente.",
        405,
      );
    }
    if (path.startsWith("/api/")) {
      return errorResponse("Endpoint de API no encontrado.", 404);
    }
    if (path.startsWith("/demo/")) {
      return handleDemoImage(path);
    }
    return serveStatic(path);
  }

  if (request.method === "POST") {
    if (normalizedPath === "/api/admin/login") {
      return handleAdminLogin(request);
    }
    if (normalizedPath === "/api/traces") {
      return handleCreateTrace(request, server);
    }
    if (path.startsWith("/api/")) {
      return errorResponse("Endpoint de API no encontrado.", 404);
    }
    return new Response("Not Found", { status: 404 });
  }

  if (request.method === "PATCH") {
    if (normalizedPath.startsWith("/api/admin/traces/") && normalizedPath.endsWith("/status")) {
      const denied = requireAdmin(request);
      if (denied) return denied;
      const traceId = normalizedPath.slice("/api/admin/traces/".length, -"/status".length);
      return handleUpdateStatus(request, traceId);
    }
    if (normalizedPath.startsWith("/api/admin/traces/")) {
      const denied = requireAdmin(request);
      if (denied) return denied;
      const traceId = normalizedPath.slice("/api/admin/traces/".length);
      return handleUpdateTrace(request, traceId);
    }
    if (path.startsWith("/api/")) {
      return errorResponse("Endpoint de API no encontrado.", 404);
    }
    return new Response("Not Found", { status: 404 });
  }

  if (request.method === "DELETE") {
    if (normalizedPath.startsWith("/api/admin/traces/")) {
      const denied = requireAdmin(request);
      if (denied) return denied;
      const traceId = normalizedPath.slice("/api/admin/traces/".length);
      return handleDeleteTrace(traceId);
    }
    if (path.startsWith("/api/")) {
      return errorResponse("Endpoint de API no encontrado.", 404);
    }
    return new Response("Not Found", { status: 404 });
  }

  return new Response("Method Not Allowed", { status: 405 });
}

function parseArgs(argv: string[]): { host: string; port: number } {
  let host = "127.0.0.1";
  let port = 8080;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--host" && argv[i + 1]) {
      host = argv[i + 1];
      i += 1;
    } else if (argv[i] === "--port" && argv[i + 1]) {
      port = Number(argv[i + 1]);
      i += 1;
    }
  }
  return { host, port };
}

if (import.meta.main) {
  const { host, port } = parseArgs(process.argv.slice(2));
  initDb();
  const server = Bun.serve({
    hostname: host,
    port,
    fetch: handleRequest,
  });
  console.log(`Granada 2031 escuchando en http://${server.hostname}:${server.port}`);
}

export { handleRequest, initDb };
