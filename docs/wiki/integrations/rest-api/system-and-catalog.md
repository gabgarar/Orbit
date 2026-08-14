# REST API: estado, configuración y catálogo

[Integraciones](../index.md) · [REST API](../rest-api.md) · [OpenAPI](../openapi.md)

## Estado y configuración

| Método y ruta | Operación | Respuesta o restricciones principales |
| --- | --- | --- |
| `GET /health` | Estado del gateway y del backend Python. | `200` con ambos estados `ok`; `503` mientras el backend no esté disponible. |
| `GET /api/system/diagnostics` | Instantánea de diagnóstico para Built-In Test. | Solo lectura; devuelve estado global, hora de generación y componentes `erp`, `sp3`, `oem`, `propagators`, `forces`, `frames`, `cicd` y `monitor`. No ejecuta una suite completa ni modifica datos. |
| `GET /api/diagnostics` | Alias de compatibilidad del diagnóstico. | Mismo contrato que `/api/system/diagnostics`; los clientes nuevos deben preferir la ruta con espacio de nombres `system`. |
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

## Diagnóstico EOP

El componente `erp` publica únicamente procedencia y salud operativa:
`loaded`, `source`, `sourceUrl`, `cacheFile`, `lastUpdate`,
`lastValidation`, `coverage`, `recordCount`, `refreshDue` y un posible
`error`. Una respuesta con `loaded: false` o estado `warning` no autoriza al
cliente a suponer ERP, extrapolar cobertura ni solicitar ECI estricto. Los
productos SP3 mantienen por separado su ERP adjunto y su contrato de marco.
