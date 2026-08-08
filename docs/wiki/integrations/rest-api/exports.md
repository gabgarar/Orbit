# REST API: exportación

[Integraciones](../index.md) · [REST API](../rest-api.md) · [Formatos](../../formats/index.md)

| Método y ruta | Producto |
| --- | --- |
| `GET /api/export/tle/:satId` | Archivo TLE de una entrada de origen TLE. |
| `GET /api/export/omm/:satId?format=json\|xml` | OMM JSON o XML de una entrada de origen OMM. |
| `GET /api/export/oem/:satId` | Cabecera OEM simplificada de una entrada de origen OEM. |
| `GET /api/export/ocm/:satId` | OCM JSON simplificado. |
| `GET /api/export/ephemeris/:satId?t0=…&t1=…` | Efeméride SGP4 en `csv`, `json` u `oem`; `dt` > 0 y ≤ 3600 s. |

Las exportaciones de catálogo verifican que el formato solicitado corresponda
al origen cuando procede. OMM, OCM y OEM generados por Orbit no declaran
cobertura completa de todos los perfiles de sus estándares.

## Estaciones terrestres

El intercambio de estaciones no es un endpoint REST. La aplicación importa y
genera localmente GeoJSON RFC 7946, Orbit JSON y CSV a partir del contrato
autorado de las capas. GeoJSON se descarga como <code>application/geo+json</code>,
Orbit JSON como <code>application/json</code> y CSV como
<code>text/csv</code>.

Estas operaciones no llaman a esta API ni convierten una respuesta AOS/LOS en
un archivo de intercambio. Consulte [Intercambio de estaciones terrestres](../../formats/ground-stations/interchange.md)
para el esquema, la validación local y los límites.
