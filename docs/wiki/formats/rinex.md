# RINEX

[Inicio](../index.md) · [Formatos](index.md) · [Formatos no soportados](unsupported-formats.md) · [SP3](sp3.md)

## Estado de soporte

Orbit no implementa RINEX de observación, navegación, meteorología ni reloj.

No hay parser, preprocesado de medidas, modelo de receptor, efeméride de
navegación, estimación de reloj, determinación de órbita ni integración con
estaciones de tierra a partir de RINEX.

## Relación con SP3

SP3 y RINEX son formatos distintos. La existencia de un lector
[SP3](sp3.md) no aporta compatibilidad con RINEX ni permite reconstruir un SP3
a partir de observaciones RINEX dentro de Orbit.

## Alternativas

Para visualizar una trayectoria calculada externamente, use una efeméride
tabulada compatible con los lectores Python disponibles y conserve en la
procedencia que procede de procesamiento GNSS externo. Orbit no ejecuta ese
procesamiento.
