# Formatos de tiempo

[Inicio](../../index.md) · [Formatos](../index.md) · [Tiempo, EOP e ITRF](../../time.md)

## Visión general

Los productos temporales aportan datos de orientación terrestre y la relación
UTC–TAI. Orbit los trata como entradas locales versionadas: no los descarga ni
los estima silenciosamente durante una transformación.

| Producto | Estado | Uso |
| --- | --- | --- |
| [IERS EOP 20u24 C04](iers-c04.md) | Disponible; fuente recomendada. | DUT1, movimiento polar, dX, dY y LOD. |
| [leap-seconds.list](leap-seconds.md) | Disponible. | UTC, TAI, TT y escalas GNSS. |
| [Boletines IERS A/B y ERP IGS](bulletins.md) | Futuros; sin lector directo. | Requerirán snapshots locales versionados y procedencia explícita. |
