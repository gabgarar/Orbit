# Alcance del análisis

[Análisis](index.md){ .md-button } [Inicio](../index.md){ .md-button }

Orbit ofrece análisis asociado a una trayectoria concreta: estados propagados,
parámetros orbitales derivados, visualización de órbitas y terreno, y acceso a
ventanas AOS/LOS. El alcance se centra en interpretar el resultado de un
modelo existente; no estima un estado a partir de observaciones.

## Resultados disponibles

| Resultado | Fuente | Consideraciones |
| --- | --- | --- |
| Estado cartesiano | Propagador o efeméride tabulada | Debe conservar marco, escala temporal y unidades. |
| Parámetros osculantes propagados | Servicio de parámetros orbitales | Dependen del modelo y del marco nativo declarado. |
| Trayectoria y ground track | Muestras de propagación para el visor | La resolución y la ventana temporal condicionan la representación. |
| Ventanas AOS/LOS | Muestreo de visibilidad desde una estación | La precisión está limitada por el paso de muestreo. |

## Exclusiones

No se proporcionan indicadores estadísticos de flota, detección de
conjunciones, análisis de reentrada, probabilidades de colisión, Monte Carlo,
optimización de constelaciones ni propagación de incertidumbre.

## Referencias relacionadas

- [Comparación de propagadores](comparison-tools.md)
- [Gráficas](plots.md)
- [Eventos](events.md)
- [Modelos de fuerzas](../propagation/force-models.md)
