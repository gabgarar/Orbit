# Tiempo y EOP: archivos locales

[Operación](../index.md) · [Tiempo, EOP e ITRF](../time-eop.md)

| Producto | Función | Estado y formato |
| --- | --- | --- |
| [IERS EOP 20u24 C04](https://datacenter.iers.org/products/eop/long-term/c04_20u24/) | DUT1, movimiento polar, dX, dY y LOD. | Recomendado: ASCII C04-20 con IAU 2000A `dX`/`dY`; conservar revisión y SHA-256. C04-14 se acepta solo para reproducir archivos históricos. |
| leap-seconds.list | UTC, TAI, TT y escalas GNSS. | ASCII IERS/NTP con identidad y expiración. |
| [IERS Bulletin A](https://maia.usno.navy.mil/products/bulletin-a) / ERP IGS | EOP rápidos, predicciones o productos emparejados a SP3. | El ERP local `.ERP`/`.ERP.gz` se asocia explícitamente al producto GNSS para ITRF → ECI, junto a una ruta de realización válida. Bulletin A sigue sin importador directo y nunca es fallback automático. |

No use un C04 IAU 1980 que declara dPsi/dEps en lugar de dX/dY. Orbit lo
rechaza cuando el encabezado lo identifica.

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
