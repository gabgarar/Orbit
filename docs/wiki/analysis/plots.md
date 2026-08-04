# Gráficas y parámetros orbitales

[Análisis](index.md){ .md-button } [Exportación](../user-guide/export.md){ .md-button }

Orbit presenta parámetros orbitales propagados y gráficas asociadas a los
flujos de TLE y órbitas manuales. El objetivo es inspeccionar la evolución de
una trayectoria calculada por el modelo seleccionado, no proporcionar una
plataforma general de análisis científico de series temporales.

## Datos representados

| Conjunto | Fuente | Uso |
| --- | --- | --- |
| Posición y velocidad | Estados propagados | Inspección de trayectoria y telemetría. |
| Parámetros osculantes | Endpoint de parámetros orbitales | Seguimiento de la geometría orbital derivada. |
| Trayectoria visual | Muestras de órbita | Contexto espacial y ground track. |

## Exportación

Las gráficas de la interfaz pueden exportarse como PNG. Las efemérides SGP4
pueden exportarse en los formatos expuestos por el flujo de exportación. Una
exportación no modifica el propagador ni convierte un formato de origen no
admitido en una fuente de alta fidelidad.

## Límites

- No hay una API de notebooks ni una biblioteca de gráficos Python pública.
- No se calculan intervalos de confianza, bandas de incertidumbre ni
  estadística inferencial.
- La disponibilidad de parámetros depende del origen y del modelo; una OEM
  tabulada no adquiere parámetros TLE por conversión de interfaz.

## Referencias relacionadas

- [Representaciones orbitales](../engineering/orbit-representations.md)
- [Propagación](../propagation/overview.md)
- [Estadísticas](statistics.md)
