# Tiempo y EOP: realizaciones y modo visual

[Operación](../index.md) · [Tiempo, EOP e ITRF](../time-eop.md) · [Modo estricto](strict-mode.md)

## Realizaciones GNSS

Un estado `IGS20`, `IGb20` o `IGc20` conserva siempre su realización fuente en
la procedencia. El despliegue Compose aplica por defecto el alineamiento global
publicado de esa familia con ITRF2020 a estados orbitales de satélite mediante:

```text
ORBIT_TERRESTRIAL_REALIZATION=ITRF2020
ORBIT_ENABLE_IGS20_FAMILY_ITRF2020_ALIGNMENT=true
```

Defina `ORBIT_ENABLE_IGS20_FAMILY_ITRF2020_ALIGNMENT=false` si necesita
deshabilitar esa ruta de realización.

La política sólo se aplica a estados orbitales geocéntricos de satélite y
conserva la etiqueta fuente en la procedencia. No aplica correcciones de
estación o antena. La variable histórica
`ORBIT_ENABLE_IGS20_ITRF2020_ALIGNMENT` conserva el comportamiento exacto para
`IGS20`, pero no puede activarse a la vez. `IGS14` y otras realizaciones
históricas no reciben una conversión implícita: requieren su propia operación
publicada.

## Marco nativo SP3 y vista terrestre

Un SP3 conserva siempre el marco y la realización declarados por su cabecera.
Por ejemplo, `IGS20` sigue siendo un estado terrestre nativo `IGS20`: que el
visor lo sitúe sobre un globo no lo convierte en `ITRF2020`. Una operación de
realización registrada puede llevar una realización fuente a la realización
ITRF elegida; esa operación y la etiqueta de origen quedan en la procedencia.

Esto es distinto de una vista terrestre obtenida desde un estado inercial con
la aproximación UTC≈UT1 y EOP nulos. Esa salida se etiqueta **terrestre
aproximada (sin EOP)**. Es útil para orientación visual, pero no es una
realización ITRF rigurosa ni justifica resultados precisos de geometría,
AOS/LOS o exportación terrestre.

## Modo visual

Sin C04 local, Orbit conserva una aproximación visual UTC≈UT1 y la marca como
aproximada. Sin tabla local UTC–TAI usa la programación histórica incluida,
con último registro 2017-01-01 y TAI−UTC = 37 s. Este modo no sirve para
análisis preciso ni exportación terrestre reproducible. Para una salida ITRF
reproducible, fije un snapshot local de [IERS EOP 20u24 C04](../../formats/time/iers-c04.md),
la tabla UTC–TAI y, cuando corresponda, la operación de realización fuente→ITRF.
