# Intercambio externo: GeoJSON

[Inicio](../../index.md) · [Formatos de estaciones de tierra](index.md) · [Estaciones de tierra](../../user-guide/ground-stations.md) · [JSON de proyecto](project-json.md)

## Visión general

Orbit exporta las estaciones terrestres del espacio de trabajo como un archivo
**GeoJSON RFC 7946**. Es una exportación de configuración: conserva posición,
identidad y parámetros introducidos para inspeccionarlos o reutilizarlos en
herramientas geoespaciales. No exporta resultados de pases, mallas de cobertura,
valores RF derivados ni estado del renderizador.

GeoJSON es el formato de intercambio inicial recomendado porque es un único
archivo UTF-8, nativo del ecosistema web y legible directamente por QGIS, GDAL,
PostGIS y muchas API cartográficas. Es preferible aquí a Shapefile: Shapefile
requiere varios ficheros coordinados (<code>.shp</code>, <code>.shx</code>,
<code>.dbf</code>, ...), limita los nombres de campos y no representa bien una
configuración RF estructurada ni texto Unicode. Orbit no cambia la geometría ni
el datum solo para encajar en un formato heredado.

!!! info "Intercambio, no copia de proyecto"

    GeoJSON sirve para compartir e inspeccionar estaciones. Para reabrir el
    espacio de trabajo con carpetas, capas, visualización y demás estado de
    Orbit, use [JSON de proyecto](project-json.md). La importación GeoJSON de
    estaciones todavía no está implementada.

## Exportar estaciones

Use **Exportar GeoJSON** sobre una estación para descargar esa capa, o la acción
equivalente del proyecto para descargar todas las estaciones terrestres del
espacio de trabajo. El resultado es una <code>FeatureCollection</code>.

La exportación parte del contrato autorado de la estación. No depende del
instante activo, de que haya un satélite seleccionado ni de una consulta AOS/LOS
previa. Así se puede compartir configuración sin convertir una envolvente de
planificación en una afirmación de disponibilidad o SNR.

## Geometría y sistema de referencia

Cada estación se escribe como una <code>Feature</code> con geometría
<code>Point</code>:

~~~json
{
  "type": "Point",
  "coordinates": [-3.70379, 40.41678, 667.0]
}
~~~

El orden es siempre **<code>[longitud, latitud, altitud_m]</code>**, nunca
latitud-longitud. Las dos primeras componentes son coordenadas geográficas
WGS-84 en grados. La tercera es la altura elipsoidal WGS-84 en metros que usa la
estación en Orbit.

RFC 7946 fija WGS-84 para GeoJSON. Por ello Orbit no añade la propiedad
<code>crs</code>, obsoleta en GeoJSON estándar. Una aplicación que necesite una
altura ortométrica debe convertirla con un geoide conocido; no debe interpretar
silenciosamente <code>altitude_m</code> como altura sobre el nivel medio del mar.

## Esquema de la colección

La raíz es una <code>FeatureCollection</code>. <code>Feature.id</code> y
<code>properties.station_id</code> identifican la misma capa. Las propiedades
que QGIS suele necesitar como columnas son planas; la configuración RF y visual
completa se conserva en objetos con espacio de nombres.

~~~json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "id": "ground-station:1",
      "geometry": {
        "type": "Point",
        "coordinates": [-3.70379, 40.41678, 667.0]
      },
      "properties": {
        "station_id": "ground-station:1",
        "name": "Est. Madrid",
        "altitude_m": 667.0,
        "time_zone": "Europe/Madrid",
        "min_elevation_deg": 10.0,
        "frequency_mhz": 2200.0,
        "polarization": "RHCP",
        "operation_mode": "tracking",
        "station_schema_version": 2,
        "orbit:rf": {
          "antenna_diameter_m": 2.4,
          "antenna_efficiency": 0.62,
          "tx_power_dbm": 38.0,
          "receiver_bandwidth_hz": 1000000
        },
        "orbit:visual": {
          "coverage_visible": true,
          "point_color": "#3cc4ff"
        },
        "monitor_satellite_ids": []
      }
    }
  ]
}
~~~

### Propiedades planas

| Propiedad | Tipo | Significado |
| --- | --- | --- |
| <code>station_id</code> | cadena | Identificador persistente de la capa; coincide con <code>Feature.id</code>. |
| <code>name</code> | cadena | Nombre mostrado de la estación. |
| <code>altitude_m</code> | número | Altura elipsoidal WGS-84 en metros; se repite para facilitar consultas tabulares. |
| <code>time_zone</code> | cadena | Zona IANA de presentación, por ejemplo <code>Europe/Madrid</code>; no altera cálculos físicos en UTC. |
| <code>min_elevation_deg</code> | número | Máscara de elevación operacional, en grados. |
| <code>frequency_mhz</code> | número | Frecuencia física normalizada, en MHz. |
| <code>polarization</code> | cadena | <code>RHCP</code>, <code>LHCP</code> o lineal según el contrato de Orbit. |
| <code>operation_mode</code> | cadena | <code>tracking</code>, <code>scan</code> o <code>stationary</code>. |
| <code>station_schema_version</code> | entero | Versión del contrato de estación de Orbit. |
| <code>monitor_satellite_ids</code> | matriz de cadenas | Identificadores guardados por el proyecto; no crean una asociación de pases obligatoria. |

### Configuración RF y visual

<code>orbit:rf</code> contiene los parámetros RF **introducidos** que no deben
perderse en el intercambio: apertura y eficiencia, frecuencia y unidad,
polarización y tilt, potencia y unidad, modos/forzados de ganancia, patrón,
HPBW, lóbulos secundarios, umbral RX, temperatura de sistema, ancho de banda,
SNR requerida, pérdidas, RMS de apuntado, boresight y límites mecánicos. Las
claves siguen [JSON de proyecto](project-json.md), por ejemplo
<code>antenna_diameter_m</code>, <code>tx_power_dbm</code>,
<code>pattern_type</code> o <code>mechanical_elevation_max_deg</code>.

<code>orbit:visual</code> contiene solo preferencias de presentación como
símbolo, tamaño, color y visibilidad de cobertura. <code>monitor_satellite_ids</code>,
cuando exista, mantiene contexto del proyecto, pero no filtra las tablas AOS/LOS:
en Orbit se puede elegir libremente cualquier satélite compatible para analizar
pases.

Los objetos <code>orbit:rf</code> y <code>orbit:visual</code> no son geometrías
GIS ni resultados. Las herramientas que solo admitan columnas planas pueden
conservarlos como JSON o ignorarlos y seguir usando la posición y las
propiedades planas.

## Abrir el archivo en QGIS

1. Seleccione **Capa → Añadir capa → Añadir capa vectorial**.
2. Elija el archivo <code>.geojson</code> exportado por Orbit y ábralo.
3. Compruebe que QGIS lo interpreta como una capa <code>Point</code> geográfica
   WGS-84.
4. Abra la tabla de atributos para consultar <code>name</code>,
   <code>frequency_mhz</code>, <code>min_elevation_deg</code> y los demás campos
   planos.

La altura Z se conserva en la geometría. Para verla en una escena 3D de QGIS,
configure la elevación de la capa con su valor Z; no use esa visualización como
modelo de visibilidad RF. La malla de patrón, la huella, la orografía, la
refracción y los pases no forman parte del GeoJSON.

## Límites y compatibilidad

- La exportación es unidireccional en la versión actual: Orbit todavía no importa
  GeoJSON de estaciones.
- El archivo describe estaciones puntuales y configuración, no geometría
  dinámica de satélites ni cobertura calculada.
- No exporta rangos RF, <code>G/T</code>, SNR, potencia recibida, AOS, LOS ni
  resultados dependientes de una capa remota: son derivados que Orbit recalcula.
- El patrón simplificado de Orbit no es un patrón de antena medido. Su presencia
  en <code>orbit:rf</code> no certifica el rendimiento de una estación física.
- La zona IANA solo es una preferencia de etiquetas locales. Los instantes de
  operación y AOS/LOS deben seguir intercambiándose en UTC.

Para una integración que necesite estaciones de redes geodésicas, logs IGS,
SINEX, KML o altura ortométrica, declare datum vertical, época, unidades y
mapeo de atributos antes de convertir datos. Orbit no deduce esos datos a partir
del nombre de una columna.
