# REST API: exportación

[Integraciones](../index.md) · [REST API](../rest-api.md) · [Formatos](../../formats/index.md)

Las rutas de exportación distinguen una fuente original conservada, un perfil
derivado desde una entrada de catálogo y una efeméride calculada. Una ruta no
debe utilizarse para presentar un documento derivado como si fuera el archivo
CCSDS que se importó.

## Productos de catálogo

| Método y ruta | Producto y restricción |
| --- | --- |
| `GET /api/export/tle/:satId` | Las dos líneas de una entrada cuyo origen real es TLE. Rechaza otra procedencia o líneas incompletas. |
| `GET /api/export/omm/:satId?format=json\|xml` | OMM JSON/XML **derivado desde la entrada catalogada** cuando su procedencia es OMM. Es un perfil normalizado y reducido; no es el archivo bruto ni una copia byte a byte. |
| `GET /api/export/oem/:satId` | Ruta de compatibilidad heredada para un perfil reducido derivado. No aporta las muestras ni los metadatos del OEM original y no debe consumirse como un OEM de efemérides utilizable. No se ofrece como acción en la interfaz. |
| `GET /api/export/ocm/:satId` | OCM JSON simplificado generado por Orbit, no una cobertura completa del estándar. |

Las rutas validan la procedencia de catálogo. El parámetro opcional
`sourceFormat` de una exportación muestreada no puede sobrescribirla: si no
coincide con el origen almacenado, la respuesta es `400`.

## Efemérides muestreadas

| Método y ruta | Producto |
| --- | --- |
| `GET /api/export/ephemeris/:satId?t0=…&t1=…&dt=…&format=…` | Efeméride de un catálogo TLE u OMM mediante SGP4. `dt` debe ser mayor que 0 y menor o igual que 3600 s. |
| `POST /api/export/manual-ephemeris?format=…` | Efeméride de una definición manual con el mismo propagador, integrador y modelo de fuerzas de la solicitud `ManualOrbitRequest`. No crea un TLE sintético. |

Los formatos `csv`, `json` y `oem` entregan muestras cartesianas o una
serialización de ellas. Los formatos geoespaciales aceptados son `geojson`,
`kml`, `kmz`, `gpkg`, `wkt` y `wkb`; requieren muestras terrestres
ITRF/ITRS/WGS-84. Una solicitud que intente reprocesar una entrada de origen
OEM con SGP4 recibe `409`: Orbit no relabela ese OEM ni usa un propagador ajeno
a sus muestras.

| `format` | Extensión | `Content-Type` | Geometría orbital |
| --- | --- | --- | --- |
| `geojson` | `.geojson` | `application/geo+json` | *Ground track* `LineString` 2D. |
| `kml` | `.kml` | `application/vnd.google-earth.kml+xml` | Trayectoria `LineString` 3D con altura elipsoidal. |
| `kmz` | `.kmz` | `application/vnd.google-earth.kmz` | KML 3D comprimido. |
| `gpkg` | `.gpkg` | `application/geopackage+sqlite3` | `LineString Z` en EPSG:4979. |
| `wkt` | `.wkt` | `text/plain` | Geometría `LineString` 2D en texto. |
| `wkb` | `.wkb` | `application/vnd.ogc.wkb` | Geometría `LineString` 2D binaria. |

### Cruce del antimeridiano

Cuando una trayectoria cruza entre `+180°` y `-180°`, la API la separa en
segmentos `LineString`. Esto evita una cuerda falsa a través del mapa. GeoJSON
contiene una `Feature` por segmento; KML/KMZ un `Placemark` por segmento;
GeoPackage una entidad `LineString Z` por segmento; WKT/WKB una colección de
geometrías 2D cuando hay más de un segmento. El punto de frontera se interpola
solo para intercambio: no es una muestra propagada ni tiene una época nueva.

Las alturas de KML/KMZ y GeoPackage son elipsoidales WGS-84. KML marca la ruta
como `absolute`; un visor que use otro datum vertical, incluido Google Earth,
puede mostrar un desplazamiento visual respecto a su geoide. GeoJSON, WKT y
WKB no incluyen altura en la geometría orbital actual.

## Estaciones terrestres

El navegador genera GeoJSON RFC 7946, KML, KMZ, WKT, WKB, Orbit JSON y CSV
localmente a partir del contrato autorado de cada capa. GeoJSON, Orbit JSON y
CSV son los únicos formatos de estación que se pueden reimportar. KML/KMZ,
WKT y WKB son representaciones espaciales solo de exportación.

| Método y ruta | Producto |
| --- | --- |
| `POST /api/ground-stations/export` | Un GeoPackage real (`format: "gpkg"`) con entidades Point Z WGS-84 en EPSG:4979. |

La solicitud contiene `format` y una lista `stations` saneada. Antes de
enviarla, el cliente elimina entidades Cesium, mallas de cobertura, cachés RF,
resultados de pases y cualquier otro valor exclusivo del runtime. El endpoint
binario devuelve `application/geopackage+sqlite3` y un nombre de descarga. No
crea TLE, OEM, efemérides ni datos de cobertura derivados.

Consulte [Intercambio de estaciones terrestres](../../formats/ground-stations/interchange.md)
para el esquema, la validación local y los límites de formato.
