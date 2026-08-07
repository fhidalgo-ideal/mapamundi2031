# Implementation Plan: Endurecimiento de producción de la plataforma del mapa participativo

**Branch**: `001-plataforma-mapa-participativo` | **Date**: 2026-08-07 | **Spec**: `specs/001-plataforma-mapa-participativo/spec.md`

**Input**: Feature specification from `specs/001-plataforma-mapa-participativo/spec.md`

## Summary

El MVP de Granada 2031 (`server.ts`, Bun + `bun:sqlite`) no tiene ningún límite de tasa, valida
imágenes solo por `Content-Type`/extensión declarados, ignora el consentimiento real del
formulario, no sirve las páginas legales que su propio `config.json` referencia, no emite
cabeceras de seguridad y no audita las acciones de administración. Esta feature cierra esas seis
brechas manteniendo la restricción original del proyecto: runtime Bun únicamente, sin
dependencias externas de npm, sin necesidad de desplegar como parte del trabajo (solo verificación
local vía un smoke test nuevo, ya que el proyecto no tiene ninguna suite de pruebas hoy).

> Nota: el backend original de este plan estaba escrito en Python 3 stdlib. Se reescribió a
> Bun/TypeScript (`server.ts`) manteniendo la misma API y el mismo comportamiento; las referencias
> técnicas de esta sección ya reflejan el runtime actual.

## Technical Context

**Language/Version**: Bun (runtime JavaScript/TypeScript — `Bun.serve`, `bun:sqlite`, `node:crypto`, sin paquetes npm de terceros)

**Primary Dependencies**: Ninguna nueva. Se reutiliza `Bun.serve`, `bun:sqlite`,
`node:crypto` (hmac/timingSafeEqual), la Web API `FormData`. La detección de firma/dimensiones/EXIF
de imagen y el límite de tasa se implementan a mano por ser runtime-only (sin `sharp`, sin
Express/Hono).

**Storage**: SQLite (`data/granada2031.sqlite3`), archivo único ya existente; se añade una
columna (`deletion_token_hash` en `traces`) y una tabla nueva (`audit_log`) vía migración idempotente
en `initDb()`.

**Testing**: No existe suite hoy. Se introduce `tests/smoke.test.ts` (`bun test` + `Bun.spawn` +
`fetch`), sin frameworks externos, como único gate automatizado del proyecto.

**Target Platform**: Linux server (Ubuntu 22/24) detrás de Nginx como proxy TLS; desarrollo/CI en
macOS/Linux indistintamente (mismo runtime Bun).

**Project Type**: Single project — servidor único (`server.ts`) + frontend estático sin build
(`index.html`, `app.js`, `admin.html`, `admin.js`).

**Performance Goals**: Sin cambio de objetivo — el proyecto es de baja concurrencia (campaña
participativa moderada, per README). El límite de tasa y el saneado de imagen no deben añadir
latencia perceptible (<50 ms) sobre el flujo de subida actual.

**Constraints**: Cero dependencias nuevas; cero pasos de build; el servidor sigue arrancando con
`bun run server.ts --host 0.0.0.0 --port 8080` sin flags adicionales obligatorios; no se toca el
flujo de despliegue documentado en el README (`systemctl restart mapamundi` manual).

**Scale/Scope**: Un único proceso, una campaña, tráfico bajo/moderado — no se diseña para
horizontal scaling ni almacenamiento distribuido del límite de tasa.

## Constitution Check

El repositorio no tiene una constitución rellenada (`.specify/memory/constitution.md` sigue en
plantilla) — no hay gates de proyecto que verificar más allá de las restricciones ya capturadas
en Technical Context (stdlib-only, sin despliegue nuevo). No se detectan violaciones.

## Project Structure

### Documentation (this feature)

```text
specs/001-plataforma-mapa-participativo/
├── spec.md               # Especificación (este ciclo)
├── plan.md               # Este archivo
├── tasks.md              # Lista de tareas (siguiente salida)
└── checklists/           # Vacío por ahora
```

### Source Code (repository root)

```text
server.ts                 # Único módulo del backend — se extiende in-place:
                           #   - rate limiter (US1) + honeypot
                           #   - sniffImageSignature / readImageDimensions / stripExif (US2)
                           #   - consent real + deletion token + rutas legales (US3)
                           #   - withSecurityHeaders envolviendo handleRequest (US4)
                           #   - audit_log + lockout de login (US5)
index.html, app.js        # Frontend público — se añade campo honeypot oculto y aviso del
                           # token de borrado tras enviar el formulario
admin.html, admin.js      # Panel de administración — opcionalmente lista la bitácora de auditoría
politica-de-privacidad.html,
aviso-legal.html          # Páginas legales nuevas, servidas estáticamente por server.ts
config.json               # Se añaden claves de texto legal por defecto (DEFAULT_PUBLIC_CONFIG)
tests/
└── smoke.test.ts         # Nuevo — único gate automatizado del proyecto
README.md                 # Se documenta el smoke test y se añaden cabeceras recomendadas en Nginx
```

**Structure Decision**: Proyecto de un solo módulo (`server.ts`); no se introduce una carpeta
`src/` nueva ni un framework — toda la lógica de endurecimiento vive en el mismo archivo para no
romper el modelo mental "un archivo, sin dependencias npm" que el propio README declara como
decisión deliberada del MVP. Único directorio nuevo: `tests/`.

## Complexity Tracking

Sin violaciones de constitución que justificar — no aplica.
