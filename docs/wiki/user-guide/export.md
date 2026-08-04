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

