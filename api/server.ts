#!/usr/bin/env bun
import {
  initDatabase,
  isMongoMode,
  getTraces,
  getTraceById,
  createTrace,
  addTracePhoto,
  getTracePhotos,
  getTracePhotosForTraces,
  updateTraceStatus,
  updateTrace,
  deleteTrace,
  addAuditLog,
  getAuditLogs,
  addNotifySignup,
  voteForPhoto,
  getPhotoById,
  setPhotoPath,
  closeDatabase,
  type TraceRecord,
  type TracePhotoRecord,
} from "./db.ts";
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import sharp from "sharp";

// server.ts lives in api/; BASE_DIR is that folder, ROOT_DIR is the repo root.
// Runtime state (data/, uploads/, config.json, .dev) and the static folders
// (web/, admin/) all live at ROOT_DIR, not alongside the backend source.
const BASE_DIR = dirname(import.meta.path);
const ROOT_DIR = resolve(BASE_DIR, "..");
const WEB_DIR = join(ROOT_DIR, "web");
const ADMIN_DIR = join(ROOT_DIR, "admin");
const DATA_DIR = process.env.GRANADA_DATA_DIR ?? join(ROOT_DIR, "data");
const UPLOAD_DIR = process.env.GRANADA_UPLOAD_DIR ?? join(ROOT_DIR, "uploads");
const DB_PATH = process.env.GRANADA_DB_PATH ?? join(DATA_DIR, "granada2031.sqlite3");
const CONFIG_PATH = process.env.GRANADA_CONFIG_PATH ?? join(ROOT_DIR, "config.json");
const SECRETS_PATH = process.env.GRANADA_SECRETS_PATH ?? join(ROOT_DIR, ".dev");
const APP_VERSION = "2026-09-15-1";
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = Number(process.env.GRANADA_MAX_IMAGE_DIMENSION ?? 6000);
// Max photos per contribution — mirrors PHOTO01's frontend picker cap. The
// first is the cover (traces.photo); extras (2nd onward) go in trace_photos.
const MAX_PHOTOS = 5;
const ADMIN_TOKEN_TTL_SECONDS = 12 * 60 * 60;
const TRACE_RATE_LIMIT_MAX = Number(process.env.GRANADA_TRACE_RATE_LIMIT_MAX ?? 5);
const TRACE_RATE_LIMIT_WINDOW_MS = Number(
  process.env.GRANADA_TRACE_RATE_LIMIT_WINDOW_MS ?? 60 * 60 * 1000,
);
const NOTIFY_SIGNUP_RATE_LIMIT_MAX = Number(process.env.GRANADA_NOTIFY_SIGNUP_RATE_LIMIT_MAX ?? 5);
const NOTIFY_SIGNUP_RATE_LIMIT_WINDOW_MS = Number(
  process.env.GRANADA_NOTIFY_SIGNUP_RATE_LIMIT_WINDOW_MS ?? 60 * 60 * 1000,
);
const ADMIN_LOGIN_LOCKOUT_MAX = Number(process.env.GRANADA_ADMIN_LOGIN_LOCKOUT_MAX ?? 5);
const ADMIN_LOGIN_LOCKOUT_WINDOW_MS = Number(
  process.env.GRANADA_ADMIN_LOGIN_LOCKOUT_WINDOW_MS ?? 15 * 60 * 1000,
);
const GEOCODE_SEARCH_RATE_LIMIT_MAX = Number(process.env.GRANADA_GEOCODE_SEARCH_RATE_LIMIT_MAX ?? 20);
const GEOCODE_SEARCH_RATE_LIMIT_WINDOW_MS = Number(
  process.env.GRANADA_GEOCODE_SEARCH_RATE_LIMIT_WINDOW_MS ?? 5 * 60 * 1000,
);
const VOTE_RATE_LIMIT_MAX = Number(process.env.GRANADA_VOTE_RATE_LIMIT_MAX ?? 30);
const VOTE_RATE_LIMIT_WINDOW_MS = Number(
  process.env.GRANADA_VOTE_RATE_LIMIT_WINDOW_MS ?? 60 * 1000,
);
const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};
const VALID_EMOTIONS = new Set(["nostalgia", "pertenencia", "asombro", "futuro"]);
const VALID_STATUSES = new Set(["pending", "approved", "rejected"]);

const DEFAULT_PUBLIC_CONFIG = {
  site_title: "Granada 2031 | Geolocalización del Sentimiento",
  brand_name: "Granada 2031",
  brand_subtitle: "Geolocalización del Sentimiento",
  brand_logo: "",
  brand_logo_alt: "Granada 2031",
  hero_eyebrow: "Candidatura cultural participativa",
  hero_title: "Granada encendida en el mundo",
  hero_text:
    "Cada foto compartida abre una luz: un recuerdo, una huella o una emoción que conecta a Granada con otra ciudad del planeta.",
  submit_cta: "Subir un rastro",
  latest_cta: "Ver última luz",
  map_title: "Mapa vivo",
  map_hint: "Rueda para acercar, arrastra para moverte y haz clic en una luz.",
  submit_eyebrow: "Nueva contribución",
  submit_title: "Sube tu rastro de Granada",
  archive_eyebrow: "Historias publicadas",
  archive_title: "Archivo de luces",
  consent_text: "Acepto que esta fotografía y el texto se usen en la acción cultural Granada 2031.",
  footer_text: "Un proyecto de IDEAL para una Granada más abierta al mundo.",
  privacy_label: "Política de privacidad",
  privacy_url: "/politica-de-privacidad",
  legal_label: "Aviso legal",
  legal_url: "/aviso-legal",
  ideal_logo: "",
  ideal_logo_alt: "IDEAL",
  ideal_url: "https://www.ideal.es",
  legal_deletion_contact: "privacy@granada2031.es",
  legal_deletion_note: "Guarde el código de eliminación que se le proporcionará tras enviar. Puede usarlo para borrar su contribución en cualquier momento.",
  legal_data_retention: "Los datos personales se conservan mientras la contribución permanezca publicada. Puede eliminarla en cualquier momento usando su código de eliminación.",
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

function ensureConfig() {
  if (existsSync(CONFIG_PATH)) return;
  writeFileSync(CONFIG_PATH, JSON.stringify({ public: DEFAULT_PUBLIC_CONFIG }, null, 2), "utf-8");
}

// Fallback used only when .dev exists but can't be rewritten to add
// photo_vote_pepper (production mounts it read-only — see docker-compose.prod.yml).
// Stable for this process's lifetime, so votes still work; it just means
// ip_hash values stop matching across a restart until an operator adds the
// key to /etc/granada/admin-secrets.json by hand, same as the other secrets.
let inMemoryPhotoVotePepper: string | null = null;

function ensureSecrets() {
  if (!existsSync(SECRETS_PATH)) {
    const defaultSecrets = {
      admin_password: "cambia-esta-password",
      admin_session_secret: randomUUID().replace(/-/g, ""),
      photo_vote_pepper: randomUUID().replace(/-/g, ""),
    };
    writeFileSync(SECRETS_PATH, JSON.stringify(defaultSecrets, null, 2), "utf-8");
    return;
  }
  // Backfill secrets introduced after a deployment's .dev file already
  // existed, so upgrading never requires editing it by hand — except in
  // production, where the file is read-only and the operator must add it.
  const existing = JSON.parse(readFileSync(SECRETS_PATH, "utf-8") || "{}") as Record<string, unknown>;
  if (!existing.photo_vote_pepper) {
    existing.photo_vote_pepper = randomUUID().replace(/-/g, "");
    try {
      writeFileSync(SECRETS_PATH, JSON.stringify(existing, null, 2), "utf-8");
    } catch (error) {
      if (!inMemoryPhotoVotePepper) {
        inMemoryPhotoVotePepper = randomUUID().replace(/-/g, "");
        console.error(
          `[server.ts] No se pudo escribir photo_vote_pepper en ${SECRETS_PATH} (¿montado de solo lectura?). ` +
            "Usando un pepper temporal en memoria hasta que se anada a /etc/granada/admin-secrets.json.",
        );
      }
    }
  }
}

function loadConfig(): Record<string, unknown> {
  ensureConfig();
  ensureSecrets();
  const config = JSON.parse(readFileSync(CONFIG_PATH, "utf-8") || "{}") as Record<string, unknown>;
  const secretsText = readFileSync(SECRETS_PATH, "utf-8");
  Object.assign(config, JSON.parse(secretsText));
  if (!config.photo_vote_pepper && inMemoryPhotoVotePepper) {
    config.photo_vote_pepper = inMemoryPhotoVotePepper;
  }
  if (!config.admin_password || !config.admin_session_secret || !config.photo_vote_pepper) {
    throw new Error(".dev debe definir admin_password, admin_session_secret y photo_vote_pepper");
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

// In-memory geocode cache: normalized "city|country" -> [lat, lng]. Successful
// Nominatim lookups are memoized for the process lifetime so the same pair is
// never geocoded twice, which also keeps us well under the service's rate
// policy for repeated contributions from the same place.
const geocodeCache = new Map<string, [number, number]>();

// Nominatim's usage policy caps callers at 1 request/second. Given this
// project's very low write volume a single module-level timestamp gate is
// enough to stay compliant without a full queue. The endpoint is overridable
// (GRANADA_NOMINATIM_ENDPOINT) so tests can point at an unreachable host and
// exercise the deterministic fallback chain without touching the live service.
const NOMINATIM_ENDPOINT =
  process.env.GRANADA_NOMINATIM_ENDPOINT ?? "https://nominatim.openstreetmap.org/search";
const NOMINATIM_USER_AGENT = "Granada2031/1.0 (https://github.com/efaguilera/mapamundi)";
const NOMINATIM_MIN_INTERVAL_MS = 1000;
const NOMINATIM_TIMEOUT_MS = 4000;
let lastNominatimRequestAt = 0;

// Geocodes a place at city/town precision via Nominatim's structured search
// (city=/country= params, never a free-form q= or addressdetails=1 — we only
// have and only want city-level coordinates). Returns null on any failure so
// the caller can fall back deterministically; a contribution must never fail
// to submit because geocoding did.
// Shared Nominatim call: enforces the 1 req/s usage-policy gate, sets the
// required User-Agent, and applies a hard timeout. Returns null on any
// network/parse failure so every caller can fall back deterministically.
async function nominatimFetch(url: URL): Promise<unknown | null> {
  const waitMs = lastNominatimRequestAt + NOMINATIM_MIN_INTERVAL_MS - Date.now();
  if (waitMs > 0) {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, waitMs);
    await promise;
  }
  lastNominatimRequestAt = Date.now();

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": NOMINATIM_USER_AGENT },
      signal: AbortSignal.timeout(NOMINATIM_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function geocodeCity(city: string, country: string): Promise<[number, number] | null> {
  const url = new URL(NOMINATIM_ENDPOINT);
  url.searchParams.set("city", city);
  url.searchParams.set("country", country);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");

  const results = (await nominatimFetch(url)) as Array<{ lat?: string; lon?: string }> | null;
  const first = Array.isArray(results) ? results[0] : undefined;
  if (!first || first.lat === undefined || first.lon === undefined) return null;
  const lat = Number(first.lat);
  const lng = Number(first.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return [lat, lng];
}

interface PlaceSuggestion {
  displayName: string;
  city: string;
  country: string;
  lat: number;
  lng: number;
}

// Free-text place search backing the form's city picker: the user types a
// city name, picks one of these suggestions, and the exact lat/lng returned
// here is what gets stored — the marker the user sees on the map IS the
// point that lands in the database, not a separately re-derived guess.
async function searchPlaces(query: string): Promise<PlaceSuggestion[]> {
  const url = new URL(NOMINATIM_ENDPOINT);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "5");

  type NominatimResult = {
    lat?: string;
    lon?: string;
    display_name?: string;
    address?: Record<string, string>;
  };
  const results = (await nominatimFetch(url)) as NominatimResult[] | null;
  if (!Array.isArray(results)) return [];

  const suggestions: PlaceSuggestion[] = [];
  for (const result of results) {
    const lat = Number(result.lat);
    const lng = Number(result.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const address = result.address ?? {};
    const city = address.city ?? address.town ?? address.village ?? address.municipality ?? address.county ?? "";
    const country = address.country ?? "";
    if (!city || !country) continue;
    suggestions.push({ displayName: result.display_name ?? `${city}, ${country}`, city, country, lat, lng });
  }
  return suggestions;
}

// Async coordinate resolution used by the write handlers. Order: in-memory
// cache -> curated CITY_COORDINATES fast-path (known cities skip the network
// entirely) -> live Nominatim geocode -> the deterministic
// COUNTRY_FALLBACK/hash chain via resolveCoordinates when Nominatim fails,
// times out, or returns nothing.
async function resolveCoordinatesAsync(city: string, country: string): Promise<[number, number]> {
  const key = `${normalizeText(city)}|${normalizeText(country)}`;
  const cached = geocodeCache.get(key);
  if (cached) return cached;
  if (key in CITY_COORDINATES) return CITY_COORDINATES[key];

  const geocoded = await geocodeCity(city, country);
  if (geocoded) {
    geocodeCache.set(key, geocoded);
    return geocoded;
  }
  return resolveCoordinates(city, country);
}

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00");
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


// Re-encodes a sharp pipeline in the upload's own format. PNG gets no quality
// option on purpose: for sharp that switches it to a lossy palette.
function encodeAsType(pipeline: sharp.Sharp, kind: string): Promise<Buffer> {
  if (kind === "image/png") return pipeline.png().toBuffer();
  if (kind === "image/webp") return pipeline.webp({ quality: 90 }).toBuffer();
  return pipeline.jpeg({ quality: 90 }).toBuffer();
}

function sharpInput(data: Uint8Array): sharp.Sharp {
  // Same ceiling as the header-only dimension guard, enforced again at decode.
  return sharp(data, { limitInputPixels: MAX_IMAGE_DIMENSION * MAX_IMAGE_DIMENSION });
}

// iPhones store sensor-oriented pixels plus an EXIF Orientation tag, which
// stripExif() would drop without applying, leaving the photo sideways. Photos
// carrying a non-default orientation are rotated for real and re-encoded
// (sharp writes no metadata unless asked, so GPS etc. go too); every other
// photo returns null and keeps the byte-level stripExif() path, untouched.
async function applyExifOrientation(data: Uint8Array, kind: string): Promise<Uint8Array | null> {
  try {
    const { orientation } = await sharp(data).metadata();
    if (!orientation || orientation === 1) return null;
    return new Uint8Array(await encodeAsType(sharpInput(data).rotate(), kind));
  } catch {
    return null; // sharp can't read/decode it: fall back to the existing strip
  }
}

// Removes EXIF metadata (which routinely carries GPS coordinates, device
// serials and timestamps) from a validated image before it is persisted. Works
// straight on the container bytes, WITHOUT re-encoding pixels: drop the JPEG
// APP1/Exif segment, the PNG eXIf chunk and the WEBP EXIF chunk. Returns the
// input unchanged when the format carries no EXIF, so it is a safe no-op.
function stripExif(data: Uint8Array, kind: string): Uint8Array {
  const concat = (pieces: Uint8Array[]): Uint8Array => {
    let total = 0;
    for (const piece of pieces) total += piece.length;
    const result = new Uint8Array(total);
    let pos = 0;
    for (const piece of pieces) {
      result.set(piece, pos);
      pos += piece.length;
    }
    return result;
  };

  if (kind === "image/jpeg") {
    // SOI (FF D8) then marker segments. Copy everything verbatim except APP1
    // (FF E1) segments whose payload begins with the ASCII bytes "Exif" plus
    // two NUL bytes. Stop scanning at SOS (FF DA), where entropy-coded scan
    // data begins, and copy the remainder unchanged.
    if (data.length < 2 || data[0] !== 0xff || data[1] !== 0xd8) return data;
    const pieces: Uint8Array[] = [data.subarray(0, 2)];
    let offset = 2;
    let removed = false;
    while (offset + 1 < data.length) {
      if (data[offset] !== 0xff) {
        pieces.push(data.subarray(offset));
        offset = data.length;
        break;
      }
      // Collapse fill bytes (runs of 0xFF) preceding the marker id.
      let markerPos = offset;
      let marker = data[markerPos + 1];
      while (marker === 0xff && markerPos + 2 < data.length) {
        markerPos++;
        marker = data[markerPos + 1];
      }
      // Standalone markers with no payload: TEM (0x01), RSTn/SOI/EOI (D0-D9).
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
        pieces.push(data.subarray(offset, markerPos + 2));
        offset = markerPos + 2;
        continue;
      }
      // SOS: entropy data runs to EOI; copy the remainder verbatim.
      if (marker === 0xda) {
        pieces.push(data.subarray(offset));
        offset = data.length;
        break;
      }
      const lenPos = markerPos + 2;
      if (lenPos + 1 >= data.length) {
        pieces.push(data.subarray(offset));
        offset = data.length;
        break;
      }
      const segLen = (data[lenPos] << 8) | data[lenPos + 1];
      const segEnd = lenPos + segLen;
      if (segLen < 2 || segEnd > data.length) {
        pieces.push(data.subarray(offset));
        offset = data.length;
        break;
      }
      const payloadStart = lenPos + 2;
      const isExifApp1 =
        marker === 0xe1 &&
        data[payloadStart] === 0x45 && // E
        data[payloadStart + 1] === 0x78 && // x
        data[payloadStart + 2] === 0x69 && // i
        data[payloadStart + 3] === 0x66 && // f
        data[payloadStart + 4] === 0x00 &&
        data[payloadStart + 5] === 0x00;
      if (isExifApp1) {
        removed = true;
      } else {
        pieces.push(data.subarray(offset, segEnd));
      }
      offset = segEnd;
    }
    return removed ? concat(pieces) : data;
  }

  if (kind === "image/png") {
    // 8-byte signature, then chunks: [len:4][type:4][data:len][crc:4]. Drop any
    // eXIf chunk; copy the rest verbatim (CRCs of kept chunks stay valid).
    if (data.length < 8) return data;
    const pieces: Uint8Array[] = [data.subarray(0, 8)];
    let offset = 8;
    let removed = false;
    while (offset + 8 <= data.length) {
      const len =
        ((data[offset] << 24) |
          (data[offset + 1] << 16) |
          (data[offset + 2] << 8) |
          data[offset + 3]) >>>
        0;
      const type = String.fromCharCode(
        data[offset + 4],
        data[offset + 5],
        data[offset + 6],
        data[offset + 7],
      );
      const chunkEnd = offset + 12 + len;
      if (chunkEnd > data.length) break;
      if (type === "eXIf") {
        removed = true;
      } else {
        pieces.push(data.subarray(offset, chunkEnd));
      }
      offset = chunkEnd;
      if (type === "IEND") break;
    }
    if (offset < data.length) pieces.push(data.subarray(offset));
    return removed ? concat(pieces) : data;
  }

  if (kind === "image/webp") {
    // RIFF (0-3) size (4-7) WEBP (8-11), then chunks: [fourcc:4][size:4][data]
    // padded to an even byte. Drop the EXIF chunk, then rewrite the RIFF size
    // and clear the VP8X EXIF flag so the container stays self-consistent.
    if (data.length < 12) return data;
    const pieces: Uint8Array[] = [data.subarray(0, 12)];
    let offset = 12;
    let removed = false;
    while (offset + 8 <= data.length) {
      const fourcc = String.fromCharCode(
        data[offset],
        data[offset + 1],
        data[offset + 2],
        data[offset + 3],
      );
      const size =
        (data[offset + 4] |
          (data[offset + 5] << 8) |
          (data[offset + 6] << 16) |
          (data[offset + 7] << 24)) >>>
        0;
      const chunkEnd = offset + 8 + size + (size & 1); // chunks are even-padded
      if (chunkEnd > data.length) break;
      if (fourcc === "EXIF") {
        removed = true;
      } else {
        pieces.push(data.subarray(offset, chunkEnd));
      }
      offset = chunkEnd;
    }
    if (offset < data.length) pieces.push(data.subarray(offset));
    if (!removed) return data;
    const result = concat(pieces);
    // RIFF chunk size = total file length - 8, little-endian at bytes 4-7.
    const riffSize = result.length - 8;
    result[4] = riffSize & 0xff;
    result[5] = (riffSize >>> 8) & 0xff;
    result[6] = (riffSize >>> 16) & 0xff;
    result[7] = (riffSize >>> 24) & 0xff;
    // Extended (VP8X) headers advertise EXIF presence in a flags byte at the
    // start of the VP8X payload (offset 20, bit 0x08); clear it now that the
    // chunk is gone so decoders do not go looking for it.
    if (
      result.length >= 21 &&
      result[12] === 0x56 && // V
      result[13] === 0x50 && // P
      result[14] === 0x38 && // 8
      result[15] === 0x58 // X
    ) {
      result[20] &= ~0x08;
    }
    return result;
  }

  return data;
}

function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set(
    "Content-Security-Policy",
    "default-src 'self'; img-src 'self' data: https://*.tile.openstreetmap.org https://*.basemaps.cartocdn.com; " +
      "style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com",
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
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
    return errorResponse("Acceso de administración no autorizado.", 401);
  }
  return null;
}

// Lists load every trace's extra photos in one batch (getTracePhotosForTraces)
// instead of one query per trace, then map each trace with its own slice.
async function tracesToPublic(dbTraces: TraceRecord[]) {
  const extrasByTrace = await getTracePhotosForTraces(dbTraces.map((trace) => trace.id));
  return Promise.all(dbTraces.map((trace) => dbTraceToPublic(trace, extrasByTrace.get(trace.id) ?? [])));
}

async function handleGetTraces(): Promise<Response> {
  const dbTraces = await getTraces(true); // approvedOnly = true
  const traces = await tracesToPublic(dbTraces);
  return jsonResponse({ traces });
}

async function handleGetAdminTraces(): Promise<Response> {
  const dbTraces = await getTraces(false); // approvedOnly = false, get all
  // Admins need the contributor's email to moderate/contact; the public
  // shape from dbTraceToPublic strips it, so it's added back here only.
  const publicTraces = await tracesToPublic(dbTraces);
  const traces = publicTraces.map((trace, index) => ({ ...trace, email: dbTraces[index].email }));
  return jsonResponse({ traces });
}

// Backs the form's city picker: proxies Nominatim so the API key-less, rate
// -limited, User-Agent-tagged call happens server-side instead of from the
// browser (client-side calls would violate Nominatim's usage policy).
async function handleGeocodeSearch(
  request: Request,
  server?: IpResolvingServer,
): Promise<Response> {
  const clientIp = getClientIp(request, server);
  const rateLimit = checkGeocodeSearchRateLimit(clientIp);
  if (rateLimit.limited) {
    const response = errorResponse("Demasiadas búsquedas. Inténtalo en unos minutos.", 429);
    response.headers.set("Retry-After", String(rateLimit.retryAfterSeconds));
    return response;
  }

  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (query.length < 2) {
    return jsonResponse({ results: [] });
  }

  const suggestions = await searchPlaces(query);
  return jsonResponse({
    results: suggestions.map((s) => ({
      displayName: s.displayName,
      city: s.city,
      country: s.country,
      lat: s.lat,
      lng: s.lng,
    })),
  });
}

// Best-effort audit trail: an admin action must still succeed even if this
// insert somehow throws, since losing an audit entry is preferable to
// failing the action it is meant to record.
async function recordAuditLog(action: string, traceId: string | null, sourceIp: string): Promise<void> {
  try {
    await addAuditLog(randomUUID(), action, traceId, sourceIp, nowIso());
  } catch (error) {
    console.error("No se pudo registrar la entrada de auditoría:", error);
  }
}

// Map db.ts TraceRecord to the public API shape: fetch extra photos, build photos[],
// rename created_at→createdAt, and strip private fields (deletion_token_hash, consent,
// email — contributors' addresses are never exposed outside the admin panel).
//
// Each entry in photos[] carries the id POST /api/photos/:id/vote expects. The
// cover photo has no row of its own in trace_photos (see TracePhotoRecord), so
// it borrows the trace's own id — safe because a trace id and a trace_photos
// id are never the same value.
//
// List callers pass extraPhotos preloaded in one batch (see tracesToPublic);
// single-trace callers omit it and it is fetched here.
async function dbTraceToPublic(trace: TraceRecord, extraPhotos?: TracePhotoRecord[]) {
  extraPhotos ??= await getTracePhotos(trace.id);
  const photos = [
    { id: trace.id, url: trace.photo, voteCount: trace.photo_vote_count ?? 0 },
    ...extraPhotos.map((p) => ({ id: p.id, url: p.path, voteCount: p.vote_count ?? 0 })),
  ];
  return {
    id: trace.id,
    name: trace.name,
    city: trace.city,
    country: trace.country,
    lat: trace.lat,
    lng: trace.lng,
    relation: trace.relation,
    emotion: trace.emotion,
    feeling: trace.feeling,
    photo: trace.photo,
    photos,
    status: trace.status,
    createdAt: trace.created_at,
  };
}

// Map db.ts AuditLogRecord to the public API shape: rename snake_case to camelCase.
function dbAuditLogToPublic(entry: { id: string; action: string; trace_id: string | null; source_ip: string; created_at: string }) {
  return {
    id: entry.id,
    action: entry.action,
    traceId: entry.trace_id,
    sourceIp: entry.source_ip,
    createdAt: entry.created_at,
  };
}

const AUDIT_LOG_DEFAULT_LIMIT = 50;
const AUDIT_LOG_MAX_LIMIT = 200;

async function handleGetAuditLog(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const rawLimit = Number(url.searchParams.get("limit") ?? AUDIT_LOG_DEFAULT_LIMIT);
  const rawOffset = Number(url.searchParams.get("offset") ?? 0);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(1, Math.trunc(rawLimit)), AUDIT_LOG_MAX_LIMIT)
    : AUDIT_LOG_DEFAULT_LIMIT;
  const offset = Number.isFinite(rawOffset) ? Math.max(0, Math.trunc(rawOffset)) : 0;

  // db.ts getAuditLogs doesn't support offset or return a separate count.
  // Fetch a large batch to approximate total (up to 10k entries) and slice for pagination.
  // This reproduces the old COUNT(*) behavior for reasonably-sized audit logs.
  const FETCH_CAP = 10000;
  const allEntries = await getAuditLogs(FETCH_CAP);
  const total = allEntries.length; // True count up to FETCH_CAP; matches old COUNT(*) intent
  const paginatedEntries = allEntries.slice(offset, offset + limit);
  const entries = paginatedEntries.map(dbAuditLogToPublic);

  return jsonResponse({ entries, total, limit, offset });
}

async function handleAdminLogin(request: Request, server?: IpResolvingServer): Promise<Response> {
  const clientIp = getClientIp(request, server);
  const lockout = adminLoginLockout.check(clientIp);
  if (lockout.limited) {
    const response = errorResponse(
      "Demasiados intentos fallidos de inicio de sesión. Inténtalo más tarde.",
      429,
    );
    response.headers.set("Retry-After", String(lockout.retryAfterSeconds));
    return response;
  }
  let payload: { password?: unknown };
  try {
    payload = await request.json();
  } catch {
    return errorResponse("JSON no válido.");
  }
  const password = String(payload.password ?? "");
  const config = loadConfig();
  const expected = String(config.admin_password);
  const passwordBuf = Buffer.from(password, "utf-8");
  const expectedBuf = Buffer.from(expected, "utf-8");
  const matches =
    passwordBuf.length === expectedBuf.length && timingSafeEqual(passwordBuf, expectedBuf);
  if (!matches) {
    adminLoginLockout.recordFailure(clientIp);
    recordAuditLog("login_failure", null, clientIp);
    return errorResponse("Password de administración incorrecta.", 401);
  }
  recordAuditLog("login_success", null, clientIp);
  return jsonResponse({ token: makeAdminToken(), expiresIn: ADMIN_TOKEN_TTL_SECONDS });
}

interface IpResolvingServer {
  requestIP(request: Request): { address: string } | null;
}

const TRUSTED_PROXY_ADDRESSES: Record<string, true> = { "127.0.0.1": true, "::1": true };

// In the Compose topology, the gateway (service "proxy", container
// granada-gateway) reaches the API over the internal Docker network, not
// loopback — so its address is never in the static set above, and
// X-Forwarded-For from it was silently never trusted, collapsing every
// visitor behind the gateway into one IP for rate limits, audit logs, and
// photo votes alike. Docker's embedded DNS resolves the service name to its
// current container IP; re-resolving periodically (rather than once at
// startup) means a `docker compose restart proxy` — which can reassign that
// IP — doesn't permanently break trust until the API is also restarted.
const TRUSTED_PROXY_HOSTNAME = process.env.GRANADA_TRUSTED_PROXY_HOST ?? "proxy";
const dynamicTrustedProxyAddresses = new Set<string>();

async function refreshTrustedProxyAddress(): Promise<void> {
  try {
    const { address } = await dnsLookup(TRUSTED_PROXY_HOSTNAME);
    dynamicTrustedProxyAddresses.clear();
    dynamicTrustedProxyAddresses.add(address);
  } catch {
    // Not running behind the Compose gateway (e.g. `bun run api/server.ts`
    // directly in local dev, or the test suite's spawned child process) —
    // leave the dynamic set empty; static loopback trust still applies.
  }
}

void refreshTrustedProxyAddress();
setInterval(refreshTrustedProxyAddress, 30_000);

// Trust X-Forwarded-For only when the direct socket peer is a local/trusted
// proxy (loopback, or the Compose gateway resolved above); otherwise a
// direct, untrusted client could spoof the header and get a fresh
// rate-limit bucket — or a fresh photo vote — on every request.
function getClientIp(request: Request, server?: IpResolvingServer): string {
  const remoteAddress = server?.requestIP(request)?.address ?? null;
  const isTrusted =
    remoteAddress !== null &&
    (TRUSTED_PROXY_ADDRESSES[remoteAddress] === true || dynamicTrustedProxyAddresses.has(remoteAddress));
  if (isTrusted) {
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
const checkNotifySignupRateLimit = createRateLimiter(
  NOTIFY_SIGNUP_RATE_LIMIT_MAX,
  NOTIFY_SIGNUP_RATE_LIMIT_WINDOW_MS,
);
const checkGeocodeSearchRateLimit = createRateLimiter(
  GEOCODE_SEARCH_RATE_LIMIT_MAX,
  GEOCODE_SEARCH_RATE_LIMIT_WINDOW_MS,
);
const checkVoteRateLimit = createRateLimiter(VOTE_RATE_LIMIT_MAX, VOTE_RATE_LIMIT_WINDOW_MS);

// Peppered so a leak of photo_votes alone (without the separately-stored .dev
// secret) can't be dictionary-attacked back into the IPs it was built from.
function hashPhotoVoteIp(ip: string, pepper: string): string {
  return createHash("sha256").update(`${ip}:${pepper}`).digest("hex");
}

// One vote per IP per photo (POST /api/photos/:id/vote). No visitor login
// exists, so "IP" is the closest thing to an identity; a repeat vote from the
// same IP is treated as the same voter and answered idempotently (200, not
// 409) rather than as an error, since a shared IP (office NAT, mobile carrier)
// can just as easily mean a different real person behind it.
async function handleVotePhoto(
  request: Request,
  photoId: string,
  server?: IpResolvingServer,
): Promise<Response> {
  if (!photoId) {
    return errorResponse("Falta el identificador de la fotografia.", 404);
  }
  const clientIp = getClientIp(request, server);
  const rateLimit = checkVoteRateLimit(clientIp);
  if (rateLimit.limited) {
    const response = errorResponse("Demasiados votos desde esta conexión. Inténtalo más tarde.", 429);
    response.headers.set("Retry-After", String(rateLimit.retryAfterSeconds));
    return response;
  }

  const pepper = loadConfig().photo_vote_pepper as string;
  const ipHash = hashPhotoVoteIp(clientIp, pepper);
  const result = await voteForPhoto(photoId, ipHash, nowIso());
  if (!result) {
    return errorResponse("No existe esa fotografía.", 404);
  }
  return jsonResponse({ voted: true, alreadyVoted: result.alreadyVoted, count: result.count });
}

function createFailureLockout(maxFailures: number, windowMs: number) {
  const failuresByKey = new Map<string, number[]>();
  const recentFailures = (key: string): number[] => {
    const windowStart = Date.now() - windowMs;
    const pruned = (failuresByKey.get(key) ?? []).filter((timestamp) => timestamp > windowStart);
    failuresByKey.set(key, pruned);
    return pruned;
  };
  return {
    // Peeks lockout status without recording a hit, so a correct password
    // submitted while locked out is still rejected instead of resetting
    // or bypassing the lockout.
    check(key: string): RateLimitResult {
      const failures = recentFailures(key);
      if (failures.length >= maxFailures) {
        const retryAfterMs = failures[0] + windowMs - Date.now();
        return { limited: true, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
      }
      return { limited: false, retryAfterSeconds: 0 };
    },
    recordFailure(key: string): void {
      const failures = recentFailures(key);
      failures.push(Date.now());
      failuresByKey.set(key, failures);
    },
  };
}

const adminLoginLockout = createFailureLockout(ADMIN_LOGIN_LOCKOUT_MAX, ADMIN_LOGIN_LOCKOUT_WINDOW_MS);

const GENERIC_SUBMISSION_ERROR = "No se ha podido procesar tu contribución. Inténtalo de nuevo más tarde.";

// Runs one uploaded file through the full validation/sanitization pipeline used
// for contribution photos: size cap, Content-Type allowlist, binary signature
// sniff, decompression-bomb dimension guard, and EXIF stripping. Returns the
// sanitized bytes + resolved extension, or an already-built error Response.
// Shared by every file in a multi-photo submission so they all get the exact
// same checks the single photo received before PHOTO02.
async function validateAndSanitizePhoto(
  photo: File,
): Promise<{ sanitized: Uint8Array; extension: string } | { error: Response }> {
  if (photo.size > MAX_UPLOAD_BYTES) {
    return { error: errorResponse("La fotografía supera el límite de 8 MB.", 413) };
  }
  if (!ALLOWED_IMAGE_TYPES[photo.type]) {
    return { error: errorResponse("Formato no permitido. Usa JPG, PNG o WEBP.") };
  }

  // Validate binary signature independently of Content-Type/extension
  const headerBytes = new Uint8Array(await photo.arrayBuffer());
  const sniffedType = sniffImageSignature(headerBytes);
  if (!sniffedType) {
    return { error: errorResponse("La fotografía no tiene un formato válido (JPG, PNG o WEBP).") };
  }

  // Anti decompression-bomb: read intrinsic dimensions from the header only
  // (no full pixel decode) and reject oversized canvases before persisting.
  const [imgWidth, imgHeight] = readImageDimensions(headerBytes, sniffedType);
  if (imgWidth <= 0 || imgHeight <= 0) {
    return { error: errorResponse("No se pudieron leer las dimensiones de la fotografía.") };
  }
  if (imgWidth > MAX_IMAGE_DIMENSION || imgHeight > MAX_IMAGE_DIMENSION) {
    return {
      error: errorResponse(
        `La fotografía excede el tamano máximo de ${MAX_IMAGE_DIMENSION}x${MAX_IMAGE_DIMENSION} px.`,
        413,
      ),
    };
  }

  // Use sniffed type for extension to ensure content/extension alignment. Strip
  // EXIF (GPS/device metadata) before the bytes ever touch disk, applying the
  // orientation first when the photo depends on it (see applyExifOrientation).
  const oriented = await applyExifOrientation(headerBytes, sniffedType);
  return {
    sanitized: oriented ?? stripExif(headerBytes, sniffedType),
    extension: ALLOWED_IMAGE_TYPES[sniffedType]!,
  };
}

async function handleCreateTrace(request: Request, server?: IpResolvingServer): Promise<Response> {
  const clientIp = getClientIp(request, server);
  const rateLimit = checkTraceRateLimit(clientIp);
  if (rateLimit.limited) {
    const response = errorResponse(
      "Demasiadas contribuciones enviadas desde esta conexión. Intentalo más tarde.",
      429,
    );
    response.headers.set("Retry-After", String(rateLimit.retryAfterSeconds));
    return response;
  }

  const contentLength = Number(request.headers.get("Content-Length") ?? "0");
  // Coarse pre-filter on the aggregate body before parsing. A contribution may
  // carry up to MAX_PHOTOS files; each individual file is still capped at
  // MAX_UPLOAD_BYTES by the per-file validation below.
  if (contentLength > MAX_PHOTOS * MAX_UPLOAD_BYTES) {
    return errorResponse("La contribución supera el límite de tamaño permitido.", 413);
  }
  const contentType = request.headers.get("Content-Type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return errorResponse("El formulario debe enviarse como multipart/form-data.");
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorResponse("La petición no contiene datos.");
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
    return errorResponse("La emoción indicada no es válida.");
  }

  const consentTruthy = ["true", "on", "1"].includes(values.consent.toLowerCase());
  if (!consentTruthy) {
    return errorResponse("Debes aceptar el consentimiento para continuar.");
  }

  const photoFiles = form
    .getAll("photo")
    .filter((entry): entry is File => entry instanceof File && entry.name.length > 0);
  if (photoFiles.length === 0) {
    return errorResponse("Falta la fotografía.");
  }
  if (photoFiles.length > MAX_PHOTOS) {
    return errorResponse(`Puedes adjuntar como máximo ${MAX_PHOTOS} fotografías.`);
  }

  // Validate/sanitize EVERY file up front through the same pipeline as a single
  // photo. Reject the whole submission on the first failure so we never persist
  // a partial set (some files saved, others rejected).
  const processed: { sanitized: Uint8Array; extension: string }[] = [];
  for (const file of photoFiles) {
    const result = await validateAndSanitizePhoto(file);
    if ("error" in result) {
      return result.error;
    }
    processed.push(result);
  }

  const traceId = randomUUID();
  // First valid file is the cover (traces.photo + on-disk file), unchanged from
  // the single-photo behavior. Extras (2nd onward) go to uploads/ + trace_photos.
  const coverFileName = `${traceId}${processed[0].extension}`;
  await Bun.write(join(UPLOAD_DIR, coverFileName), processed[0].sanitized);
  const fileName = coverFileName;

  const extraPhotoRows: { id: string; path: string; position: number; created_at: string }[] = [];
  for (let i = 1; i < processed.length; i++) {
    const extraId = randomUUID();
    const extraFileName = `${extraId}${processed[i].extension}`;
    await Bun.write(join(UPLOAD_DIR, extraFileName), processed[i].sanitized);
    extraPhotoRows.push({
      id: extraId,
      path: `/uploads/${extraFileName}`,
      position: i,
      created_at: nowIso(),
    });
  }

  // The map picker sends the exact lat/lng of the pin the user placed/dragged
  // — use it as-is so the point on the map matches what they actually chose.
  // Fall back to geocoding city/country only when lat/lng are absent or
  // malformed (e.g. an older or non-JS client).
  const rawLatField = String(form.get("lat") ?? "").trim();
  const rawLngField = String(form.get("lng") ?? "").trim();
  const rawLat = Number(rawLatField);
  const rawLng = Number(rawLngField);
  const hasValidPickedCoords =
    rawLatField !== "" && rawLngField !== "" &&
    Number.isFinite(rawLat) && Number.isFinite(rawLng) &&
    rawLat >= -90 && rawLat <= 90 && rawLng >= -180 && rawLng <= 180;
  const [lat, lng] = hasValidPickedCoords
    ? [rawLat, rawLng]
    : await resolveCoordinatesAsync(values.city, values.country);
  // Deletion token: returned once in this response and never persisted in
  // plaintext, so a leaked DB dump alone can't be used to self-delete
  // someone else's contribution.
  const deletionToken = base64UrlEncode(randomBytes(32));
  const deletionTokenHash = hashDeletionToken(deletionToken);
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
    consent: consentTruthy ? 1 : 0,
    created_at: nowIso(),
    deletion_token_hash: deletionTokenHash,
  };

  await createTrace(trace as TraceRecord);

  for (const extra of extraPhotoRows) {
    await addTracePhoto(trace.id, extra.id, extra.path, extra.position, extra.created_at);
  }

  const publicTrace = await dbTraceToPublic(trace as TraceRecord);
  return jsonResponse({ trace: publicTrace, deletionToken }, 201);
}

// Loose "looks like an email" check: one @, no whitespace, a dotted domain.
// Deliberately not RFC-5322-exhaustive — the endpoint only captures addresses
// for a future notification, so a permissive-but-sane guard is enough.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Capture-only newsletter signup: stores an email so the owner can later be
// told when their photo is published. No email is sent from here — delivery
// is out of scope (no provider configured). Rate-limited per IP like the
// other public write endpoint.
async function handleNotifySignup(request: Request, server?: IpResolvingServer): Promise<Response> {
  const clientIp = getClientIp(request, server);
  const rateLimit = checkNotifySignupRateLimit(clientIp);
  if (rateLimit.limited) {
    const response = errorResponse(
      "Demasiadas suscripciones desde esta conexión. Inténtalo más tarde.",
      429,
    );
    response.headers.set("Retry-After", String(rateLimit.retryAfterSeconds));
    return response;
  }

  let payload: { email?: unknown };
  try {
    payload = await request.json();
  } catch {
    return errorResponse("La petición no contiene un cuerpo JSON válido.");
  }

  const email = typeof payload.email === "string" ? payload.email.trim() : "";
  if (!email || email.length > 180 || !EMAIL_PATTERN.test(email)) {
    return errorResponse("Introduce un correo electrónico válido.");
  }
  // Idempotent capture: addNotifySignup uses INSERT OR IGNORE (SQLite) or catches
  // duplicate key errors (Mongo), so re-submitting the same email returns 201.
  await addNotifySignup(randomUUID(), email.toLowerCase(), clientIp, nowIso());

  return jsonResponse({ ok: true }, 201);
}

async function handleUpdateStatus(request: Request, traceId: string, server?: IpResolvingServer): Promise<Response> {
  let payload: { status?: unknown };
  try {
    payload = await request.json();
  } catch {
    return errorResponse("JSON no valido.");
  }
  const status = payload.status;
  if (typeof status !== "string" || !VALID_STATUSES.has(status)) {
    return errorResponse("Estado no válido.");
  }
  const updated = await updateTraceStatus(traceId, status);
  if (!updated) {
    return errorResponse("No existe esa contribución.", 404);
  }
  const trace = await getTraceById(traceId);
  if (!trace) {
    return errorResponse("No existe esa contribución.", 404);
  }
  await recordAuditLog("update_status", traceId, getClientIp(request, server));
  const publicTrace = await dbTraceToPublic(trace);
  return jsonResponse({ trace: publicTrace });
}

async function handleUpdateTrace(request: Request, traceId: string, server?: IpResolvingServer): Promise<Response> {
  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return errorResponse("JSON no válido.");
  }

  const allowed: Record<string, number> = {
    feeling: 600,
  };
  const updates: Record<string, string | number> = {};
  for (const [field, maxLength] of Object.entries(allowed)) {
    if (field in payload) {
      const value = String(payload[field]).trim().slice(0, maxLength);
      if (!value) {
        return errorResponse(`El campo ${field} no puede estar vacío.`);
      }
      updates[field] = value;
    }
  }

  if (Object.keys(updates).length === 0) {
    return errorResponse("No hay campos para actualizar.");
  }

  const updated = await updateTrace(traceId, updates);
  if (!updated) {
    return errorResponse("No existe esa contribución.", 404);
  }
  const trace = await getTraceById(traceId);
  if (!trace) {
    return errorResponse("No existe esa contribución.", 404);
  }
  await recordAuditLog("update_trace", traceId, getClientIp(request, server));
  const publicTrace = await dbTraceToPublic(trace);
  return jsonResponse({ trace: publicTrace });
}

function hashDeletionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function unlinkUploadFile(photoPath: string): void {
  if (!photoPath.startsWith("/uploads/")) return;
  const uploadPath = resolve(UPLOAD_DIR, photoPath.slice("/uploads/".length));
  const uploadRoot = resolve(UPLOAD_DIR) + sep;
  if (!uploadPath.startsWith(uploadRoot)) return;
  try {
    unlinkSync(uploadPath);
  } catch {
    // file already gone; not an error for the logical delete
  }
}

async function deleteTraceRow(traceId: string): Promise<void> {
  // Remove every file this trace owns: the cover plus each extra in trace_photos,
  // then the DB rows themselves — no orphaned files or rows.
  const trace = await getTraceById(traceId);
  if (!trace) return;
  
  const extras = await getTracePhotos(traceId);
  await deleteTrace(traceId);
  
  unlinkUploadFile(trace.photo);
  for (const extra of extras) {
    unlinkUploadFile(extra.path);
  }
}
// Admin fix-up for photos uploaded sideways (e.g. iPhone shots from before
// applyExifOrientation existed). The result goes to a NEW file name: /uploads/
// is served "immutable" for 30 days, so overwriting in place would keep
// showing the old pixels. Votes are keyed by photo id and survive.
async function handleRotatePhoto(request: Request, photoId: string, server?: IpResolvingServer): Promise<Response> {
  let payload: { direction?: unknown };
  try {
    payload = await request.json();
  } catch {
    return errorResponse("JSON no valido.");
  }
  const angle = payload.direction === "cw" ? 90 : payload.direction === "ccw" ? -90 : null;
  if (angle === null) {
    return errorResponse("Dirección no válida.");
  }

  const photo = await getPhotoById(photoId);
  if (!photo || !photo.path.startsWith("/uploads/")) {
    return errorResponse("No existe esa foto.", 404);
  }
  const extension = extname(photo.path).toLowerCase();
  const kind = Object.keys(ALLOWED_IMAGE_TYPES).find((type) => ALLOWED_IMAGE_TYPES[type] === extension);
  const sourcePath = resolve(UPLOAD_DIR, photo.path.slice("/uploads/".length));
  if (!kind || !sourcePath.startsWith(resolve(UPLOAD_DIR) + sep) || !existsSync(sourcePath)) {
    return errorResponse("No existe esa foto.", 404);
  }

  const rotated = await encodeAsType(sharpInput(readFileSync(sourcePath)).rotate(angle), kind);
  const newFileName = `${photoId}-r${Date.now().toString(36)}${extension}`;
  const newPath = `/uploads/${newFileName}`;
  await Bun.write(join(UPLOAD_DIR, newFileName), rotated);
  if (!(await setPhotoPath(photoId, photo.isCover, newPath))) {
    unlinkUploadFile(newPath);
    return errorResponse("No existe esa foto.", 404);
  }
  unlinkUploadFile(photo.path);

  await recordAuditLog("rotate_photo", photo.traceId, getClientIp(request, server));
  return jsonResponse({ photo: { id: photoId, url: newPath } });
}

async function handleDeleteTrace(request: Request, traceId: string, server?: IpResolvingServer): Promise<Response> {
  const trace = await getTraceById(traceId);
  if (!trace) {
    return errorResponse("No existe esa contribución.", 404);
  }
  await deleteTraceRow(traceId);
  await recordAuditLog("delete_trace", traceId, getClientIp(request, server));
  return jsonResponse({ deleted: true, id: traceId });
}

// Public, unauthenticated self-service deletion (GDPR right to erasure): the
// only proof of ownership is the per-contribution token minted once in
// handleCreateTrace and never persisted in plaintext. Compared with
// timingSafeEqual against the stored hash so a wrong guess can't be
// distinguished by response timing.
async function handleSelfDeleteTrace(request: Request, traceId: string): Promise<Response> {
  const trace = await getTraceById(traceId);
  if (!trace) {
    return errorResponse("No existe esa contribución.", 404);
  }
  const providedToken = request.headers.get("X-Deletion-Token") ?? "";
  if (!providedToken || !trace.deletion_token_hash) {
    return errorResponse("Token de borrado no válido.", 403);
  }
  const provided = Buffer.from(hashDeletionToken(providedToken), "utf-8");
  const stored = Buffer.from(trace.deletion_token_hash, "utf-8");
  if (provided.length !== stored.length || !timingSafeEqual(provided, stored)) {
    return errorResponse("Token de borrado no válido.", 403);
  }
  await deleteTraceRow(traceId);
  return jsonResponse({ deleted: true, id: traceId });
}

// Explicit allowlist: every URL below maps to one specific on-disk folder, so
// the backend source under api/, the .dev secrets file, and everything else in
// ROOT_DIR stays unreachable just by virtue of living in the project directory.
const WEB_FILES: Record<string, true> = {
  "/index.html": true,
  "/app.js": true,
  "/nav-toggle.js": true,
  "/styles.css": true,
  "/politica-de-privacidad.html": true,
  "/aviso-legal.html": true,
};
const ADMIN_FILES: Record<string, true> = { "/admin.html": true, "/admin.js": true };
const ROOT_FILES: Record<string, true> = { "/config.json": true };
// Public directory prefixes served from web/ (e.g. logos under /assets/, vendored
// browser libs under /vendor/ such as Leaflet's css/js and marker images).
const WEB_DIRS = ["/assets/", "/vendor/"];

// Confine a resolved path to its base dir, defeating traversal via `..`.
// Splits on the URL's own "/" separator before any platform-specific
// normalization: on Windows, normalize() rewrites "/" to "\" first, which
// leaves nothing to split on and makes resolve() treat the single leftover
// "\"-prefixed segment as drive-root-relative, escaping baseDir entirely.
function confineToDir(baseDir: string, cleaned: string): string | null {
  const segments = cleaned
    .split("/")
    .filter((segment) => segment && segment !== "." && segment !== "..");
  const resolved = resolve(baseDir, ...segments);
  const baseWithSep = resolve(baseDir) + sep;
  if (resolved !== resolve(baseDir) && !resolved.startsWith(baseWithSep)) {
    return null;
  }
  return resolved;
}

function resolveStaticPath(pathname: string): string | null {
  let cleaned = decodeURIComponent(pathname);
  if (cleaned.endsWith("/")) cleaned += "index.html";

  // /uploads/* resolves against UPLOAD_DIR (which GRANADA_UPLOAD_DIR can move
  // outside ROOT_DIR, e.g. for isolated tests), not against the project root.
  if (cleaned.startsWith("/uploads/")) {
    const segments = cleaned
      .slice("/uploads/".length)
      .split("/")
      .filter((segment) => segment && segment !== "." && segment !== "..");
    const resolved = resolve(UPLOAD_DIR, ...segments);
    const uploadRoot = resolve(UPLOAD_DIR) + sep;
    if (!resolved.startsWith(uploadRoot)) return null;
    return resolved;
  }

  if (WEB_FILES[cleaned] || WEB_DIRS.some((dir) => cleaned.startsWith(dir))) {
    return confineToDir(WEB_DIR, cleaned);
  }
  if (ADMIN_FILES[cleaned]) {
    return confineToDir(ADMIN_DIR, cleaned);
  }
  if (ROOT_FILES[cleaned]) {
    return confineToDir(ROOT_DIR, cleaned);
  }
  return null;
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
    if (path === "/politica-de-privacidad" || path === "/politica-de-privacidad/") {
      return serveStatic("/politica-de-privacidad.html");
    }
    if (path === "/aviso-legal" || path === "/aviso-legal/") {
      return serveStatic("/aviso-legal.html");
    }
    if (path === "/api/health") {
      const storage = isMongoMode() ? "mongodb" : "sqlite";
      // Redact credentials from Mongo URI like plan.md's initDatabase log line
      const database = isMongoMode()
        ? (process.env.MONGO_URI ?? "").replace(/:\/\/[^@]+@/, "://<credentials>@")
        : DB_PATH;
      return jsonResponse({
        ok: true,
        service: "mapamundi",
        version: APP_VERSION,
        baseDir: BASE_DIR,
        storage,
        database,
      });
    }
    if (path === "/api/config") {
      return jsonResponse({ config: loadPublicConfig() });
    }
    if (path === "/api/traces") {
      return handleGetTraces();
    }
    if (normalizedPath === "/api/geocode/search") {
      return handleGeocodeSearch(request, server);
    }
    if (normalizedPath === "/api/admin/traces") {
      const denied = requireAdmin(request);
      if (denied) return denied;
      return handleGetAdminTraces();
    }
    if (normalizedPath === "/api/admin/audit-log") {
      const denied = requireAdmin(request);
      if (denied) return denied;
      return handleGetAuditLog(request);
    }
    if (normalizedPath === "/api/admin/login") {
      return errorResponse(
        "El login de administración debe hacerse desde la web, no abriendo esta URL directamente.",
        405,
      );
    }
    if (path.startsWith("/api/")) {
      return errorResponse("Endpoint de API no encontrado.", 404);
    }
    return serveStatic(path);
  }

  if (request.method === "POST") {
    if (normalizedPath === "/api/admin/login") {
      return handleAdminLogin(request, server);
    }
    if (normalizedPath === "/api/traces") {
      return handleCreateTrace(request, server);
    }
    if (normalizedPath === "/api/notify-signup") {
      return handleNotifySignup(request, server);
    }
    if (normalizedPath.startsWith("/api/admin/photos/") && normalizedPath.endsWith("/rotate")) {
      const denied = requireAdmin(request);
      if (denied) return denied;
      const photoId = normalizedPath.slice("/api/admin/photos/".length, -"/rotate".length);
      return handleRotatePhoto(request, photoId, server);
    }
    if (normalizedPath.startsWith("/api/photos/") && normalizedPath.endsWith("/vote")) {
      const photoId = normalizedPath.slice("/api/photos/".length, -"/vote".length);
      return handleVotePhoto(request, photoId, server);
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
      return handleUpdateStatus(request, traceId, server);
    }
    if (normalizedPath.startsWith("/api/admin/traces/")) {
      const denied = requireAdmin(request);
      if (denied) return denied;
      const traceId = normalizedPath.slice("/api/admin/traces/".length);
      return handleUpdateTrace(request, traceId, server);
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
      return handleDeleteTrace(request, traceId, server);
    }
    if (normalizedPath.startsWith("/api/traces/")) {
      const traceId = normalizedPath.slice("/api/traces/".length);
      return handleSelfDeleteTrace(request, traceId);
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
  await initDatabase(DB_PATH, process.env.MONGO_URI);
  const server = Bun.serve({
    hostname: host,
    port,
    fetch: async (request: Request, server) => withSecurityHeaders(await handleRequest(request, server)),
  });
  console.log(`Granada 2031 escuchando en http://${server.hostname}:${server.port}`);
}

export { handleRequest };
