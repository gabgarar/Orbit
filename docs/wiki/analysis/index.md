# Análisis orbital

[Inicio](../index.md){ .md-button }

Las capacidades de análisis de Orbit se limitan a los resultados derivados de
las trayectorias propagadas, a la inspección de parámetros orbitales y a las
herramientas visuales disponibles en el espacio de trabajo. Esta sección
separa esas capacidades de los productos de navegación y determinación de
órbita que Orbit no implementa.

## Áreas

| Área | Estado | Página |
| --- | --- | --- |
| Alcance y límites del análisis | Capacidades derivadas disponibles y límites de producto. | [Visión general](overview.md) |
| Parámetros orbitales propagados y gráficas asociadas | Disponible para flujos TLE y órbitas manuales. | [Gráficas](plots.md) |
| Comparación de propagadores | Sin herramienta comparativa dedicada. | [Comparación](comparison-tools.md) |
| Estadísticas de flota | No disponible. | [Estadísticas](statistics.md) |

## Principio de interpretación

Un resultado de visualización o una gráfica representan el modelo, los datos y
la resolución de muestreo configurados. No constituyen una estimación de
incertidumbre, una validación contra medidas ni una solución de navegación.

## Operación terrestre

Los pases AOS/LOS, las medidas, el tracking y la futura determinación de
órbita se organizan bajo [Segmento terrestre](../ground-segment/index.md).
Esto evita confundir el análisis de una trayectoria con la operación de una
estación y su cadena de observación.

## Referencias relacionadas

- [Propagación](../propagation/overview.md)
- [Pases y visibilidad](events.md)
- [Exportación](../user-guide/export.md)
- [Validación](../operations/validation.md)
