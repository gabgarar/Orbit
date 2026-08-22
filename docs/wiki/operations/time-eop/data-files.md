# Tiempo y EOP: archivos locales

[Operación](../index.md) · [Tiempo, EOP e ITRF](../time-eop.md)

| Producto | Función | Estado y formato |
| --- | --- | --- |
| [IERS EOP_C01_IAU2000](https://datacenter.iers.org/data/latestVersion/EOP_C01_IAU2000_1846-now.txt) | Caché global operativa de orientación terrestre. | Descarga automática solo en segundo plano al arrancar/monitorizar, en `data/erp/EOP_C01_IAU2000_1846-now.txt`; se renueva si supera 7 días **o** no cubre el instante comprobado, se valida antes de activar y no sustituye un C04 explícito ni un ERP de SP3. C01 declara `UT1-TAI`, no `UT1-UTC`. |
| [IERS finals2000A.all](https://datacenter.iers.org/products/eop/rapid/standard/finals2000A.all) | Puente rápido IAU 2000A cuando C01 no cubre una época. | Caché automática HTTPS separada de IERS en `data/erp/finals2000A.all` (override `ORBIT_FINALS2000A_CACHE_PATH`). Una tupla Bulletin B completa es `final` (LOD sigue siendo Bulletin A/opcional); si no, Bulletin A `I` es `rapid` y una bandera `P` es `predicted`. No sustituye un C04 explícito ni un ERP de SP3; LOD vacío no se inventa. |
| [IERS EOP 20u24 C04](https://datacenter.iers.org/products/eop/long-term/c04_20u24/) | DUT1, movimiento polar, dX, dY y LOD. | Recomendado: ASCII C04-20 con IAU 2000A `dX`/`dY`; conservar revisión y SHA-256. C04-14 se acepta solo para reproducir archivos históricos. |
| leap-seconds.list | UTC, TAI, TT y escalas GNSS. | ASCII IERS/NTP con identidad y expiración. |
| ERP IGS | Producto emparejado a SP3. | El ERP local `.ERP`/`.ERP.gz` se asocia explícitamente al producto GNSS para ITRF → ECI, junto a una ruta de realización válida. No se sustituye por C01, finals2000A ni extrapolación. |

No use un C04 IAU 1980 que declara dPsi/dEps en lugar de dX/dY. Orbit lo
rechaza cuando el encabezado lo identifica.

`finals2000A.all` es el producto oficial de IERS Rapid Service / Prediction
Centre publicado también por el Data Center de IERS. El fichero tiene una
bandera distinta para movimiento polar, UT1–UTC y nutación; por eso la frontera
de cobertura usable no se deduce de su última línea sin más. Orbit valida los
campos que necesita y publica la calidad más conservadora de cada tramo. Tras
el último tramo usable de C01 y finals, una extrapolación lineal local puede
estar disponible durante como máximo 30 días si hay dos muestras compatibles:
aparece separada como **extrapolada**, no como un archivo IERS ni como ERP
válido. Más allá de esos 30 días no hay EOP automático; la vista se degrada a
rotación nominal y una operación estricta se rechaza.

Las tres fronteras operativas —fin C01, fin usable de `finals2000A.all` e inicio
de extrapolación— se calculan desde los snapshots instalados; no son fechas
fijas de esta documentación. Consulte **Diagnóstico** o la agenda para los
instantes reales y actualice los archivos antes de una operación que requiera
precisión fuera de cobertura.

## Snapshot UTC-TAI incluido en Compose

La distribucion incluye `config/eop/leap-seconds.list`, copiado de la fuente
oficial [IERS EOC](https://hpiers.obspm.fr/iers/bul/bulc/ntp/leap-seconds.list)
actualizada por Bulletin C 72 (2026-07-06). El despliegue por defecto fija:

| Dato | Valor |
| --- | --- |
| SHA-256 | `db5a895f16853b03bfc865e8d68f9fc8710ef1740e3400c701cd46a5bbbc3433` |
| Version | `IERS-Bulletin-C-72-2026-07-06` |
| Actualizacion NTP | `3992312697` |
| Horizonte IERS `#@` | `2027-06-28T00:00:00Z` (exclusivo) |

Era vigente el 2026-08-12. No se descarga en tiempo de ejecucion: el hash se
verifica al arrancar y una conversion SP3-to-ECI se rechaza al alcanzar ese
horizonte. Actualice fichero, SHA y version juntos desde IERS, no desde un
mirror.
