# Tiempo y EOP: archivos locales

[Operación](../index.md) · [Tiempo, EOP e ITRF](../time-eop.md)

| Producto | Función | Estado y formato |
| --- | --- | --- |
| [IERS EOP 20u24 C04](https://datacenter.iers.org/products/eop/long-term/c04_20u24/) | DUT1, movimiento polar, dX, dY y LOD. | Recomendado: ASCII C04-20 con IAU 2000A `dX`/`dY`; conservar revisión y SHA-256. C04-14 se acepta solo para reproducir archivos históricos. |
| leap-seconds.list | UTC, TAI, TT y escalas GNSS. | ASCII IERS/NTP con identidad y expiración. |
| [IERS Bulletin A](https://maia.usno.navy.mil/products/bulletin-a) / ERP IGS | EOP rápidos, predicciones o productos emparejados a SP3. | No importados actualmente; ruta futura local y versionada, no fallback automático. |

No use un C04 IAU 1980 que declara dPsi/dEps en lugar de dX/dY. Orbit lo
rechaza cuando el encabezado lo identifica.
