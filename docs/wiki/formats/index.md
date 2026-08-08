# Formatos espaciales

[Inicio](../index.md) · [Ingeniería](../engineering/index.md) · [Propagación](../propagation/index.md)

Los formatos se documentan por su ruta efectiva de producto. Un lector Python
no equivale a una función expuesta por la interfaz, el gateway o la API pública.

## Mapa de formatos

| Página | Estado |
| --- | --- |
| [Visión general](overview.md) | Matriz de importación, exportación y lector interno. |
| [TLE](tle.md) | Catálogo, validación y SGP4. |
| [OMM](omm.md) | Catálogo JSON/XML limitado a elementos TLE embebidos. |
| [OEM](oem.md) | Lector Python segmentado; importación de catálogo solo si contiene TLE. |
| [SP3](sp3.md) | Lector Python nativo de posiciones/velocidades. |
| [Formatos de estaciones de tierra](ground-stations/index.md) | Importación y exportación local de GeoJSON, Orbit JSON y CSV. |
| [OPM](opm.md) | No disponible. |
| [CPF](cpf.md) | No disponible. |
| [RINEX](rinex.md) | No disponible. |
| [Formatos no soportados](unsupported-formats.md) | Límites de producto y alternativas. |

!!! warning "Procedencia obligatoria"

    Las efemérides OEM y SP3 conservan el `REF_FRAME`/sistema de coordenadas,
    la realización y `TIME_SYSTEM` declarados. Orbit no los reetiqueta como
    ITRF o UTC al leerlos.
