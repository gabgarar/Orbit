# Tiempo y EOP: archivos locales

[Operación](../index.md) · [Tiempo, EOP e ITRF](../time-eop.md)

| Producto | Función | Formato aceptado |
| --- | --- | --- |
| IERS EOP C04 | DUT1, movimiento polar, dX, dY y LOD. | ASCII C04-14 o C04-20 con IAU 2000A dX/dY. |
| leap-seconds.list | UTC, TAI, TT y escalas GNSS. | ASCII IERS/NTP con identidad y expiración. |

No use un C04 IAU 1980 que declara dPsi/dEps en lugar de dX/dY. Orbit lo
rechaza cuando el encabezado lo identifica.
