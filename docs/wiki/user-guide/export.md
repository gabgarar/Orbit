# Exportar datos

[Inicio](../index.md) · [Guía de usuario](index.md) · [Proyectos](projects.md) · [Importar](import.md) · [Operación de tiempo y EOP](../operations/time-eop.md)

Orbit permite descargar una copia de proyecto, elementos de catálogo según su
origen y efemérides calculadas sobre un rango. La exportación no convierte el
runtime en una implementación completa de todos los perfiles CCSDS.

## Exportar proyecto

La acción **Exportar proyecto** descarga un JSON orbit-project independiente
del archivo abierto. Incluye el estado serializable descrito en
[Proyectos](projects.md). Use esta opción para trasladar la composición del
espacio de trabajo; no asuma que incorpora OEM locales tabulados.

## Exportar estaciones terrestres

Use **Exportar** sobre una estación para descargar esa capa, o la acción
**Exportar estaciones** del proyecto para descargar todas las capas de
estación. El selector permite elegir el formato antes de crear el archivo.

| Formato | Uso | Archivo descargado |
| --- | --- | --- |
| GeoJSON | Intercambio GIS con puntos WGS-84 y propiedades RF/visuales. | `.geojson` |
| Orbit JSON | Copia nativa versionada de estaciones para volver a importarlas en Orbit. | `.json` |
| CSV | Tabla editable con los campos escalares de estación. | `.csv` |

La exportación se construye desde el contrato autorado, no desde el instante
activo ni desde un análisis AOS/LOS. Por ello no contiene mallas de cobertura,
resultados de pases, SNR, rangos derivados, entidades del visor o el árbol del
espacio de trabajo. GeoJSON es la opción recomendada para QGIS, GDAL, PostGIS y
otros flujos GIS; Orbit JSON es la opción nativa para reimportar estaciones.
Consulte [Intercambio de estaciones terrestres](../formats/ground-stations/interchange.md)
para el esquema y las limitaciones de cada formato.

## Exportar elemento de catálogo

El diálogo de exportación muestra las acciones compatibles con el formato de
origen del objeto.

| Origen | Exportación directa disponible |
| --- | --- |
| TLE | TLE. |
| OMM | OMM JSON y OMM XML. |
| OEM | OEM de cabecera cuando el origen corresponde a ese formato. |

La disponibilidad de un botón no convierte un objeto de un formato a otro. La
exportación directa conserva el tipo de origen admitido por el runtime.

## Exportar efemérides

La exportación de efemérides admite un inicio, un fin, un intervalo en segundos
y uno de estos formatos:

| Formato | Contenido |
| --- | --- |
| CSV | Muestras de efeméride en un archivo tabular. |
| JSON | Muestras de efeméride serializadas. |
| OEM | Efeméride con cabecera CCSDS OEM 2.0 simplificada. |

La interfaz inicializa el rango con la época actual y una duración de un día,
un paso de diez segundos y el propagador SGP4. El operador puede ajustar el
rango y paso dentro de los límites que acepte el backend.

## Contrato OEM

Las salidas OEM usan kilómetros y kilómetros por segundo. El backend exige que
los puntos de una misma exportación declaren un marco y una escala temporal
compatibles; no combina silenciosamente puntos de marcos o escalas distintos.

!!! warning "Cobertura estándar"

    Las salidas OMM, OCM y OEM de Orbit no deben interpretarse como una
    implementación completa de cada perfil CCSDS. Revise campos, comentarios,
    marco y escala temporal antes de entregar una exportación a otro sistema.

## Reproducibilidad

Para una efeméride de precisión, registre junto al archivo exportado:

1. El TLE, OEM u otra fuente que originó la capa.
2. El rango, paso y propagador solicitados.
3. El marco y escala declarados por la salida.
4. El snapshot EOP y la tabla de segundos intercalares usados por el backend.

El último punto es imprescindible cuando la salida requiere reducción
terrestre. Consulte [Operación de tiempo y EOP](../operations/time-eop.md).
