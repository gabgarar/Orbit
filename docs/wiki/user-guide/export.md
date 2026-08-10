# Exportar datos

[Inicio](../index.md) · [Guía de usuario](index.md) · [Proyectos](projects.md) · [Importar](import.md) · [Operación de tiempo y EOP](../operations/time-eop.md)

Orbit distingue entre una copia del proyecto, el producto reducido que puede
derivar de una entrada de catálogo y una efeméride calculada en un intervalo.
Una exportación nunca convierte por sí sola el runtime en una implementación
completa de todos los perfiles CCSDS ni reconstruye un archivo de entrada que
Orbit no conserva.

## Exportar proyecto

La acción **Exportar proyecto** descarga un JSON `orbit-project` independiente
del archivo abierto. Incluye el estado serializable descrito en
[Proyectos](projects.md). Sirve para trasladar la composición del espacio de
trabajo; no presuponga que incorpora OEM locales tabulados ni resultados
efímeros del visor.

## Exportar estaciones terrestres

El selector de estaciones incluye GeoJSON, KML, KMZ, GeoPackage, WKT, WKB,
Orbit JSON y CSV. Una estación es un punto WGS-84 fijo, por lo que ninguna de
estas salidas genera TLE, OEM, efemérides, *ground tracks*, cobertura calculada
ni resultados AOS/LOS.

| Formato | Uso | Archivo descargado |
| --- | --- | --- |
| GeoJSON | Intercambio GIS con puntos WGS-84 y propiedades RF/visuales. | `.geojson` |
| KML | Puntos de estación con altura autorada para Google Earth. | `.kml` |
| KMZ | KML comprimido para compartir con Google Earth. | `.kmz` |
| GeoPackage | Capa SQLite/GPKG Point Z en EPSG:4979 para GIS profesional. | `.gpkg` |
| WKT / WKB | Geometría Point Z para bases de datos y APIs espaciales. | `.wkt` / `.wkb` |
| Orbit JSON | Copia nativa versionada para volver a importar la estación en Orbit. | `.json` |
| CSV | Tabla editable con los campos escalares de estación. | `.csv` |

KML, KMZ, GeoPackage, WKT y WKB son productos solo de exportación. La
reimportación está disponible con GeoJSON, Orbit JSON y CSV. La exportación
se construye desde el contrato autorado, no desde el instante activo ni desde
un análisis AOS/LOS: no contiene entidades Cesium, mallas de cobertura, cachés
RF, SNR, rangos derivados ni el árbol del espacio de trabajo.

Consulte [Intercambio de estaciones terrestres](../formats/ground-stations/interchange.md)
para el esquema, los campos que se preservan y las limitaciones de importación.

## Exportar un elemento de catálogo

El diálogo muestra productos compatibles con la procedencia de la capa. Solo
un TLE real conserva sus dos líneas originales; las demás salidas de catálogo
se identifican explícitamente como derivadas.

| Procedencia | Producto mostrado | Contrato |
| --- | --- | --- |
| TLE | **TLE** | Descarga las dos líneas TLE importadas. No recalcula elementos ni fabrica un TLE desde un vector de estado. |
| OMM | **OMM JSON/XML derivado desde la entrada catalogada** | Perfil normalizado y reducido a los campos que Orbit conserva. No es una copia byte a byte del OMM cargado ni garantiza todos los campos o extensiones del perfil CCSDS. |
| OEM | **Perfil OEM derivado desde la entrada catalogada** | La interfaz lo mantiene deshabilitado: Orbit no conserva actualmente las muestras, el marco, la escala temporal y los metadatos necesarios para reexportar un OEM utilizable. Conserve el OEM de origen fuera de Orbit. |
| Manual | **TLE sintético** | Visible como límite, pero deshabilitado. Generarlo requeriría ajustar SGP4 a la trayectoria manual y publicar residuos y criterios de calidad. |

!!! warning "Un producto derivado no es el archivo de origen"

    Los productos OMM y OEM derivados desde una entrada catalogada no deben
    presentarse como una recuperación del archivo recibido. Orbit no conserva
    arbitrariamente el documento bruto ni todo su perfil. Guarde el archivo
    fuente cuando la trazabilidad o la fidelidad de intercambio sea importante.

## Exportar efemérides y trayectorias

Una exportación muestreada admite inicio, fin e intervalo en segundos. Para
capas de catálogo TLE u OMM, Orbit usa SGP4; para una órbita manual, usa el
mismo propagador, integrador y modelo de fuerzas configurados en el diseñador.
Un catálogo OEM no se reprocesa silenciosamente con SGP4: sus productos
muestreados permanecen deshabilitados hasta que exista un adaptador de muestras
OEM con marco y escala temporal verificables.

| Formato | Contenido | Uso |
| --- | --- | --- |
| CSV | Muestras cartesianas, época, marco, escala temporal, procedencia y propagador. | Hoja de cálculo y análisis numérico. |
| JSON | Respuesta estructurada de efemérides de Orbit. | Integración con consumidores del contrato de Orbit. |
| CCSDS OEM | Efeméride muestreada con cabecera OEM simplificada. | Intercambio de las muestras generadas; no OEM de alta fidelidad de origen. |
| GeoJSON | *Ground track* 2D de longitud/latitud. | Visor web y GIS 2D. |
| KML / KMZ | Trayectoria muestreada 3D con altitud por muestra. | Google Earth y visores KML. |
| GeoPackage | LineString Z y atributos de procedencia, propagador e intervalo. | QGIS, ArcGIS y GIS técnico. |
| WKT / WKB | Geometría terrestre 2D para SQL, PostGIS y APIs espaciales. | Bases de datos y servicios espaciales. |

La interfaz inicializa un rango de un día y un paso de diez segundos. Ajuste
ambos valores al arco y a la resolución que necesite, dentro de los límites
aceptados por el backend.

### Segmentos al cruzar el antimeridiano

Una trayectoria que pasa de `+180°` a `-180°` no se exporta como una recta
ficticia que atraviesa el otro lado del mapa. Orbit la divide en segmentos
`LineString` en el antimeridiano. El punto de corte es una frontera de
intercambio interpolada para el visor; no es una muestra propagada ni inventa
una época o una dinámica nueva.

| Formato | Resultado cuando hay cruce |
| --- | --- |
| GeoJSON | Una `FeatureCollection` con una `LineString` por segmento, en 2D (longitud/latitud). |
| KML / KMZ | Un `Placemark` y una `LineString` por segmento, con altura elipsoidal por muestra. |
| GeoPackage | Una entidad `LineString Z` por segmento en EPSG:4979. |
| WKT / WKB | Una `GEOMETRYCOLLECTION` / `GeometryCollection` de `LineString` 2D; sin cruce artificial del mapa. |

KML usa `altitudeMode=absolute` y GeoPackage usa altura elipsoidal WGS-84.
Google Earth puede representar una diferencia visual respecto a su datum de
alturas o geoide; no interprete esa diferencia como un cambio de la trayectoria
propagada. GeoJSON, WKT y WKB intencionadamente no incluyen altitud en la
geometría orbital actual.

## Contrato OEM de efeméride

Las salidas OEM muestreadas usan kilómetros y kilómetros por segundo. El backend
exige que los puntos de una misma exportación declaren un marco y una escala
temporal compatibles; no combina silenciosamente puntos de marcos o escalas
distintos.

!!! warning "Cobertura estándar"

    Las salidas OMM, OCM y OEM de Orbit no deben interpretarse como una
    implementación completa de cada perfil CCSDS. Revise campos, comentarios,
    marco y escala temporal antes de entregar una exportación a otro sistema.

## Reproducibilidad

Para una efeméride de precisión, registre junto al archivo exportado:

1. El TLE, OEM u otra fuente que originó la capa y su archivo original si se conserva fuera de Orbit.
2. El rango, paso y propagador solicitados.
3. El marco y la escala temporal declarados por la salida.
4. El *snapshot* EOP y la tabla de segundos intercalares usados por el backend.

El último punto es imprescindible cuando la salida requiere reducción terrestre.
Consulte [Operación de tiempo y EOP](../operations/time-eop.md).
