# Comparación de propagadores

[Análisis](index.md){ .md-button } [Propagación](../propagation/overview.md){ .md-button }

Orbit no incluye una herramienta dedicada que ejecute, alinee, compare y
califique automáticamente varios propagadores contra una misma referencia.
Las diferencias entre SGP4, dos cuerpos y Cowell deben interpretarse desde sus
contratos de entrada, marcos nativos, escalas temporales, fuerzas activas y
ventanas temporales.

## Comparación manual trazable

Una comparación manual debe conservar, como mínimo, los siguientes elementos:

| Elemento | Requisito |
| --- | --- |
| Época inicial | Misma época física, con escala temporal declarada. |
| Estado o elementos iniciales | Misma definición y mismas unidades. |
| Marco | Conversión explícita a un marco común antes de calcular diferencias. |
| Modelo | Lista de fuerzas, parámetros y versión de datos auxiliares. |
| Malla temporal | Mismos instantes de evaluación y política de interpolación. |
| Métrica | Definición explícita de posición, velocidad o elemento comparado. |

!!! warning "No equivalencia de modelos"

    Un TLE interpretado por SGP4 no es el mismo objeto matemático que un
    estado osculante manual integrado por Cowell. Una diferencia entre ambos
    modelos no es, por sí misma, un error de propagación.

## Estado

**No disponible:** tablas de comparación automatizadas, estadísticas de error
frente a verdad terreno, métricas de precisión por propagador y análisis de
sensibilidad sistemático.

## Referencias relacionadas

- [SGP4](../propagation/sgp4.md)
- [Dos cuerpos](../propagation/two-body.md)
- [Cowell](../propagation/cowell.md)
- [Sistemas de coordenadas](../engineering/coordinate-systems.md)
