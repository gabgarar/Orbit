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

## Productos GNSS precisos: SP3 y CLK

La opción **Import precise GNSS (SP3 / CLK)**, disponible en **Layers → + →
Add layer → Add satellite**, carga efemérides GNSS locales como fuentes
tabuladas. No usa el importador de catálogo TLE/OMM: un SP3 conserva sus
identificadores GNSS, su marco y su escala temporal nativos, y no se convierte
en un TLE.

Seleccione al menos un SP3 y, opcionalmente, el CLK RINEX correspondiente de
la misma serie. Se pueden proporcionar archivos sin comprimir, `gzip`, ZIP o
la compresión histórica `.Z` admitida por el importador. Orbit identifica el
contenido y rechaza un archivo de reloj aislado como trayectoria, porque un CLK
no contiene posiciones. Un producto admite un único SP3 y, como máximo, un CLK
después de descomprimir; no mezcle productos de fechas o centros distintos en
la misma carga.

| Producto descargado localmente | Ejemplo de uso |
| --- | --- |
| IGS Final/Rapid/Ultra-Rapid desde [NASA CDDIS](https://cddis.nasa.gov/Data_and_Derived_Products/GNSS/orbit_and_clock_products.html) | Cargar el SP3 de la fecha de análisis; añadir el CLK asociado si se debe conservar la información de reloj. |
| [IGS MGEX](https://igs.org/mgex/data-products/) SP3 + CLK | Importar una constelación multi-GNSS conservando IDs como `G01`, `E11` o `C19`. |
| [ESA NSO](https://navigation-office.esa.int/GNSS_based_products.html) Final/Rapid/Ultra-Rapid | Cargar los ficheros descargados de la serie ESA correspondiente. |

Revise antes de importar la clase de producto, la fecha, el marco y
`TIME_SYSTEM`. Un Ultra-Rapid puede mezclar intervalos observados y predichos;
esa cobertura no debe interpretarse como uniformemente observada. La entrada
se registra de forma durable en el almacén local de productos precisos y se
rehidrata al arrancar. Un proyecto referencia el producto estable, pero no
incluye una copia de su binario fuente.

La interfaz permite hasta ocho archivos, 32 MiB por archivo y 64 MiB en total
antes de descomprimir. Los ZIP cifrados o anidados se rechazan, al igual que
los archivos que excedan el límite de seguridad descomprimido.

!!! warning "No es una descarga remota"

    CDDIS puede requerir Earthdata Login, y los proveedores cambian sus
    esquemas de distribución. Orbit no inicia sesión ni descarga estos
    productos: la autenticación y verificación del archivo ocurren fuera de la
    aplicación. Consulte [Productos GNSS precisos](../formats/precise-products.md)
    para calidad, procedencia, CLK, marcos y límites. Tras una carga correcta,
    la pestaña de entrada del objeto muestra la ficha de producto y la línea
    temporal simulada se alinea a su cobertura común.

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
| OPM, CPF y RINEX | No disponibles. |
| OEM de precisión segmentado | Existe lector Python para uso interno; no existe carga operativa mediante UI o API pública. |

!!! warning "Marco y escala temporal"

    La extensión de un archivo no determina su marco ni escala temporal.
    Verifique los metadatos de OEM/SP3 y use la configuración estricta de
    [tiempo y EOP](../operations/time-eop.md) cuando los resultados deban ser
    reproducibles o comparables con precisión terrestre.

No existe importación de observaciones, tracking, medidas o soluciones de
determinación de órbita.
