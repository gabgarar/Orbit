# Tiempo y EOP: realizaciones y modo visual

[Operación](../index.md) · [Tiempo, EOP e ITRF](../time-eop.md) · [Modo estricto](strict-mode.md)

## Realizaciones GNSS

Por defecto, un estado IGS20 conserva esa realización y no se reescribe a ITRF.
El alineamiento global IGS20 ↔ ITRF2020 exige habilitar expresamente
ORBIT_ENABLE_IGS20_ITRF2020_ALIGNMENT junto con ITRF2020 como realización de
salida. No aplica correcciones de estación o antena. IGb20 e IGc20 no reciben
una conversión implícita.

## Modo visual

Sin C04 local, Orbit conserva una aproximación visual UTC≈UT1 y la marca como
aproximada. Sin tabla local UTC–TAI usa la programación histórica incluida,
con último registro 2017-01-01 y TAI−UTC = 37 s. Este modo no sirve para
análisis preciso ni exportación terrestre reproducible.
