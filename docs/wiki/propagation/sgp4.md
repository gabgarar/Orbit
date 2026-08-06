# SGP4

[Inicio](../index.md) · [Propagación](index.md) · [Propagadores](overview.md) · [TLE](../formats/tle.md)

## Visión general

`SGP4Propagator` propaga un TLE con `sgp4.api.Satrec`. Es el motor por defecto
para los objetos de catálogo de Orbit y su estado nativo se declara siempre en
`TEME`.

SGP4 sólo acepta la definición TLE de catálogo. No se ofrece como propagador
de una órbita manual `EME2000`; convertir esa definición en un TLE exigiría un
ajuste explícito que no forma parte del editor.

SGP4 es un propagador **analítico** para TLE: parte de la teoría de
Brouwer-Lyddane y de las correcciones operacionales NORAD. No es un integrador
numérico ni recalcula una trayectoria a partir de fuerzas seleccionadas por el
usuario.

## Por qué usar SGP4

- Es el estándar práctico para continuar un TLE de catálogo.
- Es rápido: cada consulta evalúa el modelo analítico del TLE, sin integrar
  pasos RK4.
- Conserva el marco nativo correcto (`TEME`) y delega la conversión terrestre
  al servicio común de marcos y EOP.

## Guía del módulo

| Tema | Qué aprenderá |
| --- | --- |
| [TLE y contrato de estado](sgp4/tle-and-contract.md) | Qué representa un TLE, cómo se consulta y qué devuelve Orbit. |
| [Tiempo y marcos](sgp4/time-and-frames.md) | Por qué la consulta es UTC, por qué el estado nativo es TEME y cómo pedir ITRF. |
| [Uso recomendado y límites](sgp4/validity-and-use.md) | El régimen donde un TLE es útil, los errores esperables y la comparación con Cowell. |

## Regla fundamental

SGP4 no tiene `force_terms`: J2 de Cowell, arrastre configurable, SRP o una
composición propia de fuerzas no modifican un resultado SGP4. Para controlar
el estado inicial y la dinámica, use [Cowell](cowell.md); para continuar un
objeto descrito por un TLE reciente, use SGP4.
