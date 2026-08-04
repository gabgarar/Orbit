# Propagador analítico J2

[Inicio](../index.md) · [Propagación](index.md) · [Propagadores](overview.md) · [J2 como modelo de fuerza](j2.md)

## Visión general

Esta ruta de compatibilidad es un **propagador analítico**, no el modelo de fuerza J2 usado por Cowell. Parte de elementos keplerianos manuales y aplica tasas seculares de primer orden.

Conserva semieje mayor, excentricidad e inclinación; actualiza RAAN, argumento de periapsis y anomalía media. El estado nativo es `EME2000` y se expresa internamente en km y km/s.

## Relación con el modelo J2

El modelo [J2](j2.md) de **Modelos de fuerzas** es otra implementación: Cowell evalúa su aceleración zonal en cada etapa RK4 y puede combinarla con J3, J4 y arrastre. No deben tratarse como el mismo mecanismo de propagación.

| Ruta | Tipo | Entrada | Integrador |
| --- | --- | --- | --- |
| `j2` | Propagador analítico secular | Elementos keplerianos | No aplica. |
| `cowell-rk4` con `j2` | Modelo de fuerza numérico | Estado cartesiano | [RK4](rk4.md). |

## Límites

No modela arrastre, cambios de energía, geopotencial completo, términos teserales o sectoriales, mareas ni coeficientes temporales. Para combinar fuerzas se debe usar [Cowell](cowell.md).
