# REST API: estado, configuración y catálogo

[Integraciones](../index.md) · [REST API](../rest-api.md) · [OpenAPI](../openapi.md)

## Estado y configuración

| Método y ruta | Operación | Respuesta o restricciones principales |
| --- | --- | --- |
| `GET /health` | Estado del gateway y del backend Python. | `200` con ambos estados `ok`; `503` mientras el backend no esté disponible. |
| `POST /api/system-config` | Persiste una configuración saneada y solicita recarga del backend. | Requiere `system`; no permite cambiar en caliente el catálogo activo. Puede devolver `503` tras persistir si la recarga falla. |
| `GET /docs` | Swagger UI de FastAPI a través del gateway. | Véase [OpenAPI](../openapi.md). |
| `GET /openapi.json` | Descripción OpenAPI generada por FastAPI. | No tiene versión pública independiente. |
| `GET /redoc` | ReDoc de FastAPI a través del gateway. | Disponible mientras el backend esté saludable. |

## Catálogo

| Método y ruta | Operación | Parámetros o cuerpo |
| --- | --- | --- |
| `GET /api/catalog/page` | Página filtrada del catálogo local. | `offset` (≥ 0), `limit` (1–1000), `search`, `orbitKind`, `mission`, `operator`, `owner`, `decayOnly`, `sourceFormat` y `sourceOrigin`. |
| `GET /api/catalog/tle?name=…` | Busca una entrada por nombre normalizado. | `name` es obligatorio; responde `404` si no existe. |
| `POST /api/catalog/import` | Importa contenido textual de catálogo. | `{ "fileName": "…", "content": "…", "merge": true }`; debe producir TLE válidos. |
| `POST /api/catalog/refresh` | Actualiza las fuentes remotas configuradas. | `?discover=true` solicita descubrimiento; está deshabilitado offline, limitado a un intento cada dos horas y sin refrescos concurrentes. |

`/api/catalog/page` devuelve `items`, `total`, `offset`, `limit`, `hasMore`,
filtros auxiliares y el umbral de perigeo de decaimiento. `catalogId` se hace
único cuando hay nombres duplicados; no debe sustituirse por el nombre original
al construir una selección de UI.
