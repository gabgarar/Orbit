# Intercambio de estaciones terrestres

[Inicio](../../index.md) · [Formatos de estaciones](index.md) · [Estaciones de tierra](../../user-guide/ground-stations.md) · [JSON de proyecto](project-json.md)

## Visión general

Orbit puede exportar e importar estaciones terrestres como archivos
independientes. El intercambio conserva la posición WGS-84 y la configuración
autorada de la estación; no reutiliza resultados de cálculo, entidades Cesium
ni geometría derivada de la escena.

| Formato | Extensión | Cuándo usarlo | Importar y exportar |
| --- | --- | --- | --- |
| **GeoJSON** | `.geojson` | GIS, QGIS, PostGIS y APIs cartográficas. | Sí. |
| **Orbit JSON** | `.json` | Copia nativa y versionada de estaciones para volver a abrirlas en Orbit. | Sí. |
| **CSV** | `.csv` | Revisión o edición tabular en una hoja de cálculo. | Sí. |
| **KML** | `.kml` | Puntos de estación para Google Earth y visores KML. | Solo exportar. |
| **KMZ** | `.kmz` | KML comprimido para compartir con Google Earth. | Solo exportar. |
| **GeoPackage** | `.gpkg` | Capa Point profesional para QGIS, ArcGIS y GIS técnico. | Solo exportar. |
| **WKT** | `.wkt` | Geometría Point Z/MultiPoint Z para SQL y PostGIS. | Solo exportar. |
| **WKB** | `.wkb` | Geometría binaria Point Z/MultiPoint Z para APIs espaciales. | Solo exportar. |

GeoJSON es la opción recomendada para interoperabilidad geográfica. Orbit JSON
es la ruta nativa para conservar el contrato de estación admitido por Orbit.
CSV es un perfil tabular práctico: no debe tratarse como una copia sin pérdida
cuando una herramienta externa modifica tipos, codificación o columnas.

## Usar el selector de intercambio

Para incorporar un archivo, pulse **Importar** en el panel **Ground Stations**
o **Importar estaciones** en las acciones del proyecto. Para descargar una
estación concreta, abra su acción **Exportar**; desde las acciones del proyecto
puede exportar todas las estaciones del espacio de trabajo. El selector muestra
GeoJSON, KML, KMZ, GeoPackage, WKT, WKB, Orbit JSON y CSV antes de iniciar la
descarga. La tarjeta amarilla del diálogo explica el destino y los límites del
formato seleccionado.

La importación añade capas al proyecto abierto; no reemplaza el proyecto ni
elimina las estaciones existentes. Si un identificador del archivo no puede
usarse en el espacio de trabajo actual, Orbit asigna un identificador de capa
válido sin alterar el nombre mostrado ni la configuración de la estación.

!!! info "Validación al importar"

    La interfaz acepta archivos de hasta **5 MiB**. Valida cada entidad GeoJSON
    o fila CSV por separado. Las entradas sin una posición válida, fuera de los
    límites WGS-84 o con una estructura incompatible se omiten y Orbit informa
    cuántos registros fueron importados y cuántos fueron rechazados. Un formato
    no reconocido o un documento mal formado no crea ninguna capa.

## GeoJSON RFC 7946

Cada estación se representa como una `Feature` con geometría `Point`. Las
coordenadas están siempre en el orden **`[longitud, latitud, altitud_m]`**:
longitud y latitud WGS-84 en grados, seguida de altura elipsoidal en metros.

~~~json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "id": "gst:1",
      "geometry": {
        "type": "Point",
        "coordinates": [-3.70379, 40.41678, 667.0]
      },
      "properties": {
        "station_id": "gst:1",
        "name": "Estación Madrid",
        "station_schema_version": 2,
        "altitude_m": 667.0,
        "time_zone": "Europe/Madrid",
        "min_elevation_deg": 10.0,
        "frequency_mhz": 2200.0,
        "polarization": "RHCP",
        "operation_mode": "tracking",
        "orbit:rf": {
          "antenna_diameter_m": 2.4,
          "antenna_efficiency": 0.62,
          "tx_power_dbm": 38.0,
          "receiver_bandwidth_hz": 1000000
        },
        "orbit:visual": {
          "coverage_visible": true,
          "visible": true,
          "point_color": "#3cc4ff"
        },
        "monitor_satellite_ids": []
      }
    }
  ]
}
~~~

Las propiedades planas facilitan consultas GIS. La configuración RF completa
se conserva en `properties["orbit:rf"]`; las preferencias autoradas de
presentación, incluida la visibilidad de la capa, están en
`properties["orbit:visual"]`. El importador acepta tanto ese perfil exportado
por Orbit como propiedades planas compatibles, pero la geometría `Point` es la
fuente de la posición.

El archivo no incorpora un miembro `crs`: RFC 7946 fija GeoJSON a WGS-84. La
altura es elipsoidal, no una altura ortométrica ni una altura sobre el terreno.

### Abrir GeoJSON en QGIS

1. Seleccione **Capa → Añadir capa → Añadir capa vectorial**.
2. Abra el archivo `.geojson` exportado por Orbit.
3. Compruebe que se interpreta como una capa `Point` geográfica WGS-84.
4. Consulte los campos planos como `name`, `frequency_mhz` y
   `min_elevation_deg` desde la tabla de atributos.

La componente Z se conserva para una escena 3D de QGIS. Esa visualización no
es un modelo RF ni un cálculo de visibilidad.

## Orbit JSON

Orbit JSON es un contenedor de intercambio nativo para una lista de estaciones.
Es versionado y está pensado para volver a importar el contrato admitido por
Orbit sin depender de las convenciones de atributos de una herramienta GIS.
Orbit identifica el documento por su envolvente, por lo que acepta un `.json`
descargado y también el nombre compatible `.orbit-ground-stations.json`.

~~~json
{
  "format": "orbit-ground-stations",
  "version": 1,
  "stations": [
    {
      "id": "gst:1",
      "name": "Estación Madrid",
      "station_schema_version": 2,
      "latitude_deg": 40.41678,
      "longitude_deg": -3.70379,
      "altitude_m": 667.0,
      "time_zone": "Europe/Madrid",
      "min_elevation_deg": 10.0,
      "antenna_diameter_m": 2.4,
      "frequency_mhz": 2200.0,
      "coverage_visible": true
    }
  ]
}
~~~

`format` identifica el contenedor y `version` identifica el contrato de
intercambio, no la versión de la aplicación. Cada objeto de `stations` usa el
contrato de estación descrito en [JSON de proyecto](project-json.md), sin el
árbol de carpetas, el modo temporal, otras capas ni manejadores de renderizado.

## CSV

El CSV contiene una fila por estación y cabeceras estables, entre ellas
`station_id`, `name`, `latitude_deg`, `longitude_deg`, `altitude_m`,
`min_elevation_deg` y los campos RF/visuales escalares conocidos por Orbit.
`monitor_satellite_ids` se escribe como una matriz JSON dentro de su celda.

Para importar un CSV creado manualmente, son obligatorias las columnas
`latitude_deg` y `longitude_deg`. Los campos ausentes usan los valores por
defecto de la estación; las celdas numéricas o booleanas vacías del perfil
exportado representan valores opcionales nulos. Mantenga el separador coma y
la codificación UTF-8 si va a reimportar el archivo.

## Exportaciones espaciales adicionales

El dialogo **Exportar estaciones** muestra una tarjeta amarilla al cambiar el
formato. La tarjeta explica el destino y que informacion se conserva antes de
iniciar la descarga. Las estaciones se representan siempre como puntos WGS-84:
no son orbitas, ground tracks, TLE, OEM ni efemerides.

| Formato | Geometria | Atributos | Uso y limite |
| --- | --- | --- | --- |
| KML / KMZ | `Point` con altitud autorada. | KML mantiene un resumen legible de la estacion. | Abrir en Google Earth. KMZ contiene el mismo KML comprimido. |
| GeoPackage | `Point Z` EPSG:4979. | Nombre, tipo y JSON de propiedades autoradas. | Archivo SQLite/GPKG real generado por el servicio local para GIS profesional. |
| WKT / WKB | `Point Z` para una estacion, `MultiPoint Z` para varias. | Ninguno: solo geometria. | Insertar en SQL, PostGIS o una API espacial; use GeoJSON u Orbit JSON para RF completo. |

KML, KMZ, GeoPackage, WKT y WKB son productos de exportacion y no se pueden
importar de vuelta por ahora. La reimportacion conserva el contrato de Orbit
solo mediante **GeoJSON**, **Orbit JSON** o **CSV**. GeoJSON y Orbit JSON son
las opciones preferidas cuando se necesiten parametros RF, mascara, limites
mecanicos o preferencias visuales.

!!! warning "No se fabrican datos orbitales"

    Una estacion terrestre es un punto fijo en WGS-84. Orbit no ofrece TLE u
    OEM para estaciones, ni agrega una trayectoria, una cobertura derivada,
    una malla Cesium, resultados AOS/LOS o datos de enlace a estos archivos.

## Datos que Orbit recalcula

Ninguno de los formatos exporta o acepta como fuente de verdad:

- mallas 2D/3D, huella, patrón discreto o entidades del visor;
- alcance RF, `G/T`, pérdidas agregadas, SNR o potencia recibida derivados;
- muestras de elevación, AOS, LOS, tablas de pases o una respuesta de la API;
- una asociación obligatoria entre estación y satélite;
- carpetas, otras capas, selección, cámara o modo temporal del proyecto.

Tras importar, Orbit vuelve a calcular los modelos RF, la cobertura y los
resultados AOS/LOS con el instante, satélite y configuración actualmente
seleccionados.

## Compatibilidad

Todos los formatos de intercambio representan estaciones puntuales WGS-84. Si un sistema
externo utiliza otro datum, altura ortométrica, época geodésica o unidades
distintas, convierta y documente esos datos antes de importarlos. Orbit no
deduce el datum vertical, la zona horaria ni la semántica RF a partir del
nombre de una columna.

Para restaurar el espacio de trabajo completo, incluidos árbol de capas y
estado de proyecto, use [JSON de proyecto](project-json.md), no un archivo de
intercambio de estaciones.
