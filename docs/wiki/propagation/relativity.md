# Relatividad

[Inicio](../index.md) · [Propagación](index.md) · [Modelos de fuerza](force-models.md) · [Marcos de referencia](../engineering/reference-frames.md)

## Estado de soporte

Orbit no implementa aceleraciones relativistas en los propagadores manuales ni
correcciones de dinámica relativista para SGP4, OEM o SP3.

La disponibilidad de escalas temporales como TT no implica que se incorporen
términos post-newtonianos en la ecuación de movimiento. TT se usa para la
reducción de marcos cuando corresponde; es una responsabilidad distinta de la
dinámica.

## Límites explícitos

- No hay corrección Schwarzschild, Lense–Thirring, efectos multipolares
  relativistas ni integrador variacional relativista.
- No hay transformación general de coordenadas tiempo-espacio ni conversión
  automática TDB/TCB/TCG.
- No hay modelo de reloj de satélite como producto de propagación.

Los casos que requieran relatividad deben resolverse con una fuente externa y,
si procede, suministrarse a Orbit como efeméride tabulada con sus metadatos
explícitos.
