# Determinación de órbita

[Análisis](index.md)

La determinación de órbita no está implementada en Orbit. El runtime propaga
un TLE, una definición manual o una efeméride tabulada; no estima el estado ni
sus parámetros a partir de observaciones.

## Estado

**No disponibles:** filtros de Kalman, batch least squares, estimación de
parámetros, ajuste de maniobras, estimación de sesgos, matrices de covarianza
de solución, residuales, pruebas de consistencia y generación de productos OD.

## Separación de responsabilidades

Una covarianza contenida en un OEM puede conservarse como metadato de una
época nativa. Su presencia no crea un estimador ni habilita propagación de
incertidumbre. De igual modo, un catálogo TLE sirve de entrada a SGP4 y no
representa una solución OD generada por Orbit.

## Referencias relacionadas

- [OEM](../formats/oem.md)
- [Medidas](measurements.md)
- [Modelos de fuerzas](../propagation/force-models.md)
