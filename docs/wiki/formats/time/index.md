# Formatos de tiempo

[Inicio](../../index.md) · [Formatos](../index.md) · [Tiempo, EOP e ITRF](../../time.md)

## Visión general

Los productos temporales aportan datos de orientación terrestre y la relación
UTC–TAI. Orbit los trata como entradas locales versionadas: no los descarga ni
los estima silenciosamente durante una transformación.

| Producto | Estado | Uso |
| --- | --- | --- |
| [IERS EOP C04](iers-c04.md) | Disponible. | DUT1, movimiento polar, dX, dY y LOD. |
| [leap-seconds.list](leap-seconds.md) | Disponible. | UTC, TAI, TT y escalas GNSS. |
| [Boletines IERS A y B](bulletins.md) | No disponibles como lector directo. | Deben convertirse o integrarse explícitamente. |
