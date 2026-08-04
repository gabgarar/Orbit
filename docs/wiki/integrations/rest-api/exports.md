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
