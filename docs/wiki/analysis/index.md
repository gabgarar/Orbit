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
| Eventos | AOS/LOS de estaciones disponible por muestreo; no hay motor de eventos genérico. | [Eventos](events.md) |
| Estadísticas de flota | No disponible. | [Estadísticas](statistics.md) |
| Medidas y tracking | No disponible como cadena de observación. | [Medidas](measurements.md) y [tracking](tracking.md) |
| Determinación de órbita | No disponible. | [Determinación de órbita](orbit-determination.md) |

## Principio de interpretación

Un resultado de visualización, una gráfica o un paso AOS/LOS representan el
modelo, los datos y la resolución de muestreo configurados. No constituyen una
estimación de incertidumbre, una validación contra medidas ni una solución de
navegación.

## Referencias relacionadas

- [Propagación](../propagation/overview.md)
- [Estaciones de tierra](../user-guide/ground-stations.md)
- [Exportación](../user-guide/export.md)
- [Validación](../operations/validation.md)
