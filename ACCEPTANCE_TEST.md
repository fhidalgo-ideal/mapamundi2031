# T-628 Acceptance Test Report

## Sequence Executed

Per task specification, the following exact sequence was run and all outputs captured:

### STEP 1: `docker-compose up -d --build`
✓ All services built and started successfully

### STEP 2: `curl -s http://localhost/ | head`
```
<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Granada 2031 | Geolocalizacion del Sentimiento</title>
    <link rel="stylesheet" href="vendor/leaflet/leaflet.css">
    <link rel="stylesheet" href="styles.css?v=20260507-config-footer">
  </head>
  <body>
```

### STEP 3: `curl -s http://localhost/admin/ | head`
```
<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Administracion | Granada 2031</title>
    <link rel="stylesheet" href="styles.css">
  </head>
  <body>
    <header class="topbar">
```

### STEP 4: `curl -s http://localhost/api/health`
```json
{"ok":true,"service":"mapamundi","version":"2026-05-07-config-footer","baseDir":"/app/api","storage":"mongodb","database":"mongodb://db:27017/granada2031"}
```

**Verification**: ✓ `"storage":"mongodb"` confirms MongoDB backend active

### STEP 5: Submit trace via `POST http://localhost/api/traces`

**Initial count** (via `docker exec granada-db mongosh granada2031 --eval "db.traces.countDocuments()"`)
```
5
```

**Request**: multipart/form-data with valid JPEG image (100x100px)
```
curl -s -X POST http://localhost/api/traces \
  -F "name=Test User" \
  -F "email=test@example.com" \
  -F "city=Granada" \
  -F "country=Spain" \
  -F "relation=student" \
  -F "emotion=futuro" \
  -F "feeling=optimistic" \
  -F "lat=37.1769" \
  -F "lng=-3.5979" \
  -F "consent=1" \
  -F "photo=@/tmp/test_image.jpg"
```

**Response**:
```json
{"trace":{"id":"d99e9847-dc61-4ea4-a93a-6c24c54fac76","name":"Test User","email":"test@example.com","city":"Granada","country":"Spain","lat":37.1734995,"lng":-3.5995337,"relation":"student","emotion":"futuro","feeling":"optimistic","photo":"/uploads/d99e9847-dc61-4ea4-a93a-6c24c54fac76.jpg","photos":["/uploads/d99e9847-dc61-4ea4-a93a-6c24c54fac76.jpg"],"status":"pending","createdAt":"2026-08-09T08:25:04+00:00"},"deletionToken":"KxtHfCPXFiA1L9kbhgHEjl57OvJo3YsrSlsq81mrtAw"}
```

**Final count** (via `docker exec granada-db mongosh granada2031 --eval "db.traces.countDocuments()"`)
```
6
```

**Verification**: ✓ Count increased from 5 → 6 (1 trace inserted and persisted in MongoDB)

### STEP 6: `docker-compose restart` and verify data persistence

**Count before restart**: `6`

**Restart command**:
```bash
docker-compose restart
```

**Output**:
```
Container granada-api Restarting 
Container granada-db Restarting 
Container granada-gateway Restarting 
```

**Count after restart** (via `docker exec granada-db mongosh granada2031 --eval "db.traces.countDocuments()"`)
```
6
```

**Verification**: ✓ Count unchanged (6 == 6) — data persisted across container restart

## Acceptance Criteria — ALL MET ✓

- [x] `docker-compose up -d --build` completes successfully
- [x] `curl -s http://localhost/ | head` returns public web HTML
- [x] `curl -s http://localhost/admin/ | head` returns admin panel HTML
- [x] `curl -s http://localhost/api/health` returns JSON with `"storage":"mongodb"`
- [x] POST valid trace to `/api/traces` with JPEG attachment succeeds
- [x] Document count in MongoDB increases from 5 to 6
- [x] `docker-compose restart` preserves document count (data persistence verified)

## Implementation Summary

### Files Created/Modified
- **docker-compose.yml**: Full three-service stack (db, api, proxy) with healthchecks, volumes, networking
- **.env.example**: Environment variables documentation (MONGO_URI, MONGO_DB_NAME, Granada paths)
- **Dockerfile.api**: Fixed healthcheck to use `127.0.0.1:8080` (avoids IPv6 localhost resolution)

### Services Verified
- **db (mongo:7.0)**: Healthy, responding to `mongosh --eval "db.adminCommand('ping')"`
- **api (bun)**: Healthy, serving `/api/health` with storage="mongodb"
- **proxy (nginx)**: Running, routing `/`, `/admin/`, `/api/`, `/uploads/` correctly

### Network & Volumes
- Network: `granada_net` (bridge) ✓
- Volumes: `mongo_data`, `uploads_data`, `data_data` (all local driver) ✓
