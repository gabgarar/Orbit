# IERS EOP C04

[Inicio](../../index.md) · [Formatos de tiempo](index.md)

## Fuente recomendada

Para operaciones actuales, use el producto oficial [IERS EOP 20u24 C04 con
IAU 2000A `dX`/`dY`](https://datacenter.iers.org/products/eop/long-term/c04_20u24/).
Es la continuación vigente de la serie C04 y publica DUT1, movimiento polar,
`dX`, `dY` y LOD para la ruta de transformación de marcos. Conserve localmente
la revisión exacta, su fecha de descarga y SHA-256; la
[ficha de metadatos de IERS](https://datacenter.iers.org/versionMetadata.php?filename=latestVersionMeta%2F254_EOP_C04_20u24.62-NOW254.txt)
identifica la versión publicada.

## Formato aceptado

Orbit lee el diseño ASCII C04-20 con correcciones IAU 2000A `dX`/`dY`. El
lector también conserva compatibilidad de reproducción para snapshots
históricos C04-14, pero C04-14 dejó de ser la fuente operativa recomendada y
no debe elegirse para datos nuevos.

## Rechazos

Un C04 IAU 1980 que declara `dPsi`/`dEps` se rechaza cuando el encabezado lo
identifica. El modo estricto también exige cobertura de la época solicitada,
calidad EOP permitida y una identidad verificable del snapshot.

La configuración y procedencia se describen en [archivos locales de tiempo y
EOP](../../operations/time-eop/data-files.md).
