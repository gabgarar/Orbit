# REST API

## Propósito y límite de red

La API HTTP de Orbit se sirve desde el mismo origen que la interfaz web. El
gateway Node.js expone las rutas públicas, conserva el catálogo y la
configuración, y reenvía las operaciones orbitales al proceso FastAPI privado.
La URL base es la del gateway, normalmente:

```text
http://127.0.0.1:8100
```

No existe un prefijo de versión, autenticación ni autorización. La API está
diseñada para una instalación local o una red controlada. Consulte
[Despliegue](../development/deployment.md) antes de publicar el puerto en una
red.

!!! warning "Contrato sin versionado público"

    Orbit no publica todavía una garantía de compatibilidad para clientes
    externos. Los consumidores deben validar el esquema contra
    [OpenAPI](openapi.md) en la instancia que vayan a usar y tolerar campos
    adicionales en las respuestas.

## Convenciones comunes

| Elemento | Contrato |
| --- | --- |
| Cuerpo | JSON salvo exportaciones de archivo. El gateway limita cuerpos JSON a 25 MB. |
| Fechas | Enviar ISO-8601 con zona horaria, preferiblemente `Z`/UTC. Las rutas orbitales normalizan sus instantes a UTC. |
| Identificador de satélite | `sat_id` y `:satId` se resuelven contra el nombre/identificador cargado en el catálogo. La codificación URL es responsabilidad del cliente. |
| Fuente orbital | Las rutas de propagación aceptan un `sat_id` **o** ambas líneas `line1` y `line2` de un TLE. |
| Estados cartesianos | Cuando la respuesta incluye unidades, la representación para renderizado declara `reference_frame: "ITRF"`, posición en metros y velocidad en m/s. Las fuentes y productos de precisión mantienen contratos de marco y escala más explícitos internamente. |
| Errores del gateway | Un JSON inválido devuelve `400`; un cuerpo excesivo, `413`; un fallo al acceder al backend Python, `502` con `{ "ok": false, "error": "…" }`. |
| Errores de validación FastAPI | Las formas o valores inválidos devuelven normalmente `422`; una fuente no encontrada puede devolver `404`. |

Las consultas reenviadas al backend tienen un tiempo máximo de 30 segundos en
el gateway. La respuesta del backend conserva su estado HTTP y tipo de
contenido cuando el reenvío tiene éxito.

## Estado y configuración

| Método y ruta | Operación | Respuesta o restricciones principales |
| --- | --- | --- |
| `GET /health` | Estado del gateway y del backend Python. | `200` con ambos estados `ok`; `503` mientras el backend no esté disponible. |
| `POST /api/system-config` | Persiste una configuración de sistema saneada y solicita recarga del backend. | Requiere un objeto `system`; no permite cambiar en caliente el archivo de catálogo activo. Puede devolver `503` después de persistir si la recarga falla. |
| `GET /docs` | Swagger UI de FastAPI a través del gateway. | Véase [OpenAPI](openapi.md). |
| `GET /openapi.json` | Descripción OpenAPI generada por FastAPI. | No tiene versión pública independiente. |
| `GET /redoc` | ReDoc de FastAPI a través del gateway. | Disponible mientras el backend esté saludable. |

## Catálogo

| Método y ruta | Operación | Parámetros o cuerpo |
| --- | --- | --- |
| `GET /api/catalog/page` | Página filtrada del catálogo local. | `offset` (≥ 0), `limit` (1–1000), `search`, `orbitKind`, `mission`, `operator`, `owner`, `decayOnly`, `sourceFormat` (`TLE`, `OMM`, `OEM`, `OCM`) y `sourceOrigin` (`CATALOG`, `CUSTOM`). |
| `GET /api/catalog/tle?name=…` | Busca una entrada por nombre normalizado. | `name` es obligatorio; responde `404` si no existe. |
| `POST /api/catalog/import` | Importa contenido textual de catálogo. | `{ "fileName": "…", "content": "…", "merge": true }`. El contenido debe producir TLE válidos; un OEM puro sin líneas TLE embebidas se rechaza. |
| `POST /api/catalog/refresh` | Actualiza las fuentes remotas configuradas. | `?discover=true` solicita descubrimiento de grupos; está deshabilitado en modo offline, limitado a un intento cada dos horas y no permite refrescos concurrentes. |

`/api/catalog/page` devuelve `items`, `total`, `offset`, `limit`, `hasMore`,
filtros auxiliares de operador/propietario y el umbral de perigeo usado para la
alerta de decaimiento. `catalogId` se hace único cuando hay nombres duplicados;
no debe sustituirse silenciosamente por el nombre original al construir una
selección de UI.

## Propagación y efemérides

| Método y ruta | Operación | Límites comprobables |
| --- | --- | --- |
| `GET /api/propagate/:satId` | Propaga un satélite de catálogo al instante `at` opcional. | Si se omite `at`, usa el instante UTC actual. |
| `POST /api/propagate` | Propaga desde catálogo o TLE explícito. | Cuerpo `sat_id` o `line1` + `line2`; `at` opcional. |
| `GET /api/orbits/:satId` | Muestrea una órbita futura de catálogo. | `horizon_hours`: 0.1–8760; `samples`: 2–7200 si se especifica. |
| `POST /api/orbits` | Muestrea una órbita desde catálogo o TLE explícito. | Los mismos límites de horizonte y muestras. |
| `POST /api/ephemeris` | Construye una serie temporal de posición y, opcionalmente, velocidad. | `start_time < end_time`, `step_seconds` > 0 y ≤ 3600; el servicio limita la serie a 20 000 puntos. |
| `POST /api/manual-orbits` | Crea una órbita manual transitoria y su efeméride de vista previa. | Familias nuevas: `two-body`, `sgp4`, `cowell-rk4`; las rutas J2 heredadas se conservan sólo por compatibilidad. |
| `POST /api/orbit-parameters` | Calcula elementos osculadores en un rango. | 2–2000 muestras; la fuente es de catálogo/TLE o una definición manual. Los modelos RK4 se someten además a un presupuesto de integración. |

Ejemplo de propagación desde TLE explícito:

```json
POST /api/propagate
Content-Type: application/json

{
  "line1": "1 25544U 98067A   24120.50000000  .00000000  00000+0  00000+0 0  9990",
  "line2": "2 25544  51.6400 120.0000 0005000  20.0000 340.0000 15.50000000000000",
  "at": "2026-08-04T12:00:00Z"
}
```

Ejemplo de efeméride:

```json
POST /api/ephemeris
Content-Type: application/json

{
  "sat_id": "ISS (ZARYA)",
  "start_time": "2026-08-04T12:00:00Z",
  "end_time": "2026-08-04T14:00:00Z",
  "step_seconds": 60,
  "include_velocity": true
}
```

!!! warning "Fidelidad y marcos"

    Los TLE se propagan con SGP4 y tienen estado nativo TEME. La salida de
    renderizado se transforma a ITRF. Las órbitas manuales de dos cuerpos y
    Cowell parten de EME2000. No utilice una respuesta de visualización como
    sustituto de una efeméride de navegación de alta fidelidad. Véanse
    [Glosario](../reference/glossary.md) y la documentación de tiempo/marcos
    de la instalación para los datos EOP requeridos en modo estricto.

### Órbita manual

`POST /api/manual-orbits` acepta `snake_case` y los alias `camelCase` usados
por el editor React. Una definición debe aportar elementos keplerianos o un
vector de estado; `definition_source` decide cuál es autoritativa si llegan
ambas.

| Campo | Requisito |
| --- | --- |
| `epoch` | Instante ISO-8601 con zona horaria. |
| `propagator` | `two-body`, `sgp4` o `cowell-rk4` para diseños nuevos. |
| `keplerian` | EME2000/UTC; semieje mayor en km, ángulos en grados y una anomalía verdadera o media. |
| `state_vector` | EME2000/UTC; posición en km y velocidad en km/s. |
| `propagation_options.force_terms` | Para Cowell, `central` siempre está activo y se añade automáticamente; `j2`, `j3`, `j4` y `drag` son opcionales. |
| `propagation_options.numerical_integrator` | Sólo `rk4`. |
| Parámetros de drag | Relevantes únicamente cuando Cowell incluye `drag`; SGP4 usa el BSTAR del TLE y rechaza drag manual. |

La respuesta devuelve la forma canónica, metadatos del motor, la definición
resuelta, el resumen geométrico y la efeméride. La órbita no se incorpora al
catálogo persistente por esta operación.

## Estaciones de tierra

| Método y ruta | Operación | Requisitos |
| --- | --- | --- |
| `GET /api/aos-los` | Calcula accesos con parámetros de consulta. | `sat_id`, `station_lat_deg`, `station_lon_deg`; altura, elevación mínima, intervalo y paso opcionales. |
| `POST /api/aos-los` | Calcula accesos con cuerpo JSON. | Fuente TLE, `station`, `start_time`, `end_time` y `step_seconds`. |

Una estación declara `lat_deg` entre −90 y 90, `lon_deg` entre −180 y 180,
`height_m` entre −1000 y 100000 y `min_elevation_deg` entre 0 y 90. La salida
incluye muestras de elevación y pases AOS/LOS. La detección de pases se basa en
el paso de muestreo solicitado; no es una búsqueda de raíces de precisión.

## Exportación

| Método y ruta | Producto |
| --- | --- |
| `GET /api/export/tle/:satId` | Archivo TLE de una entrada de origen TLE. |
| `GET /api/export/omm/:satId?format=json\|xml` | OMM JSON o XML de una entrada de origen OMM. |
| `GET /api/export/oem/:satId` | Cabecera OEM simplificada de una entrada de origen OEM. |
| `GET /api/export/ocm/:satId` | OCM JSON simplificado. |
| `GET /api/export/ephemeris/:satId?t0=…&t1=…` | Efeméride SGP4 en `csv` (predeterminado), `json` u `oem`. `dt` debe ser mayor que 0 y no superar 3600 s; `propagator` sólo admite `sgp4`. |

Las exportaciones de catálogo verifican que el formato solicitado corresponda
al origen de la entrada cuando procede. OMM, OCM y OEM generados por Orbit no
declaran cobertura completa de todos los perfiles de sus estándares.

## Rutas privadas del backend

FastAPI implementa también `/catalog`, `/health`, `/reload` y exportaciones
internas. Salvo los destinos publicados por el gateway, no forman parte del
contrato de integración. No configure clientes externos contra el puerto
Python ni dependa de que permanezca accesible fuera del contenedor.

## Referencias relacionadas

- [OpenAPI y Swagger](openapi.md)
- [WebSocket](websocket.md)
- [Arquitectura](../development/architecture.md)
- [Validación](../development/validation.md)
