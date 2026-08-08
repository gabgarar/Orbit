# Importar datos

[Inicio](../index.md) · [Guía de usuario](index.md) · [Proyectos](projects.md) · [Exportar](export.md) · [Operación de tiempo y EOP](../operations/time-eop.md)

Orbit separa la importación de un proyecto de la incorporación de datos al
catálogo o al visor. Un archivo de proyecto restaura una composición local; un
archivo orbital incorpora objetos o una trayectoria compatible.

## Proyecto Orbit

El comando de abrir o importar proyecto acepta un JSON con formato
orbit-project y versión 1. Un archivo con otro formato o versión se rechaza.
El proyecto que esté abierto se reemplaza sólo después de confirmación.

Consulte [Proyectos](projects.md) para los campos restaurados y las
limitaciones de OEM local.

## Catálogo orbital

El servicio de catálogo reconoce TLE y OMM cuando aportan las dos líneas TLE
necesarias para crear un objeto propagable. La detección se basa en contenido
y extensión.

| Entrada | Extensiones habituales | Resultado |
| --- | --- | --- |
| TLE | .tle, .txt | Uno o más objetos de catálogo TLE. |
| OMM JSON | .json | Objetos OMM que contienen TLE_LINE1 y TLE_LINE2. |
| OMM XML | .omm, .xml | Objetos OMM XML que contienen las líneas TLE. |
| OEM textual con TLE embebido | .oem | Entrada de catálogo sólo si contiene los campos textuales `TLE_LINE1 = …` y `TLE_LINE2 = …`. |

Los datos importados se validan antes de incorporarse al catálogo. Un OEM que
no contiene un TLE embebido no puede convertirse en un objeto de catálogo
nativo y se rechaza en esa ruta.

## Trayectorias OEM locales

El visor puede cargar una trayectoria OEM tabulada local como órbita temporal.
Esta ruta no equivale a importar un objeto de catálogo ni garantiza la
transformación de un OEM arbitrario TEME o GCRF por el servicio de marcos de la
UI.

Cuando se activa el dominio de un OEM, la [Línea temporal](timeline.md) queda
limitada a sus muestras. Mantenga el archivo fuente disponible: sus muestras
no se restauran de manera fiable desde un documento de proyecto.

## Estaciones terrestres

Las estaciones se importan de forma independiente desde **Importar** en
**Ground Stations** o desde **Importar estaciones** en las acciones del
proyecto. Esta acción añade las estaciones válidas al proyecto abierto; no
reemplaza su árbol de capas ni importa un objeto orbital.

| Formato | Uso recomendado | Requisito mínimo de importación |
| --- | --- | --- |
| GeoJSON RFC 7946 | GIS y herramientas cartográficas. | Una `Feature` `Point` con coordenadas WGS-84 válidas. |
| Orbit JSON | Copia nativa de estaciones Orbit. | Contenedor `orbit-ground-stations` con una lista `stations`. |
| CSV | Edición tabular. | Columnas `latitude_deg` y `longitude_deg`. |

El límite de la interfaz es 5 MiB. Cada entidad o fila se valida de manera
independiente: Orbit importa las estaciones válidas, omite las inválidas y
notifica ambos recuentos. Consulte [Intercambio de estaciones terrestres](../formats/ground-stations/interchange.md)
para el contrato, las extensiones admitidas y los datos que se recalculan.

## Formatos no expuestos por la interfaz

| Formato | Situación actual |
| --- | --- |
| SP3 | Existe lector Python con metadatos nativos; no existe importación SP3 por UI, gateway público ni runtime de Orbit. |
| OPM, CPF y RINEX | No disponibles. |
| OEM de precisión segmentado | Existe lector Python para uso interno; no existe carga operativa mediante UI o API pública. |

!!! warning "Marco y escala temporal"

    La extensión de un archivo no determina su marco ni escala temporal.
    Verifique los metadatos de OEM/SP3 y use la configuración estricta de
    [tiempo y EOP](../operations/time-eop.md) cuando los resultados deban ser
    reproducibles o comparables con precisión terrestre.

No existe importación de observaciones, tracking, medidas o soluciones de
determinación de órbita.
