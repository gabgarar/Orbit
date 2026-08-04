# Conceptos de ingeniería

## Visión general

Los conceptos de ingeniería definen qué datos entran en Orbit y qué significado debe sobrevivir a cada operación. Orbit prefiere etiquetas explícitas a alias cómodos.

## Por qué importa

Un vector sin escala temporal, marco, centro o unidades no es interoperable. Orbit rechaza `ECI` y `ECEF` porque son ambiguos.

## Estado vectorial

`StateVector` es el contrato SI compartido: época, escala, marco, realización, centro, posición en metros, velocidad en m/s, aceleración opcional y covarianza 6×6. Es inmutable tras la validación.

```python
StateVector(epoch=epoch, time_scale="UTC", frame="TEME",
            frame_realization=None, center="EARTH", position_m=(...))
```

## Representaciones

Los cartesianos son la representación de intercambio. Los elementos keplerianos describen la geometría intuitivamente; los equinocciales evitan singularidades cerca de órbitas circulares o ecuatoriales. Los parámetros derivados se etiquetan como osculantes cuando proceden de un estado en una época.

## Marcos y tiempo

Se admiten TEME, GCRF, ICRF, EME2000, CIRS, TIRS, PEF e ITRF. `ITRF2020` se expresa mediante `frame=ITRF` y `frame_realization=ITRF2020`.

Se conservan UTC, TAI, TT, GPS y UT1. UTC se deriva internamente para IERS/ERFA; la escala fuente se mantiene en la salida. Una tabla de segundos intercalares puede fijarse por instancia para evitar que un cambio global altere un resultado científico.

## Tierra y entorno

La gravedad central está siempre presente. El modelo numérico puede componer J2/J3/J4, geopotencial, terceros cuerpos, arrastre, presión de radiación y relatividad cuando el propagador lo declara.

## Límites

- Solo se transforman marcos geocéntricos Earth.
- ITRF genérico no se convierte silenciosamente en una realización nombrada.
- Etiquetas externas como IGS20 requieren una operación de datum registrada y publicada.
- Componentes no finitos, escalas desconocidas y marcos ambiguos se rechazan en el límite de entrada.
