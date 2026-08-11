# Formatos espaciales

[Satélite](../satellite/index.md) · [Propagación](../propagation/index.md) · [Fundamentos de ingeniería](../engineering/index.md)

Los formatos se documentan por su ruta efectiva de producto. Un lector Python
no equivale a una función expuesta por la interfaz, el gateway o la API pública.

## Mapa de formatos

| Página | Estado |
| --- | --- |
| [Visión general](overview.md) | Matriz de importación, exportación y lector interno. |
| [TLE](tle.md) | Catálogo, validación y SGP4. |
| [OMM](omm.md) | Catálogo JSON/XML limitado a elementos TLE embebidos. |
| [OEM](oem.md) | Lector Python segmentado; importación de catálogo solo si contiene TLE. |
| [SP3](sp3.md) | Contrato de efeméride precisa tabulada. |
| [Productos GNSS precisos](precise-products.md) | Importación local de IGS/CDDIS, MGEX y ESA NSO; SP3 obligatorio, CLK/ERP/SUM/ATT/OSB asociados y procedencia. |
| [OPM](opm.md) | No disponible. |
| [Formatos no soportados](unsupported-formats.md) | Límites de producto y alternativas. |

!!! warning "Procedencia obligatoria"

    Las efemérides OEM y SP3 conservan el `REF_FRAME`/sistema de coordenadas,
    la realización y `TIME_SYSTEM` declarados. Orbit no los reetiqueta como
    ITRF o UTC al leerlos.

## Formatos del segmento terrestre

Los contratos de estación, terreno, observación y predicción tienen su área
canónica en [Segmento terrestre](../ground-segment/index.md). Consulte allí
[GeoJSON, KML/KMZ, GeoPackage, WKT/WKB, Orbit JSON y CSV](ground-stations/index.md), así como el estado de
RINEX y CPF.
