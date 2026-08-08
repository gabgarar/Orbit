# JSON de proyecto

[Inicio](../../index.md) · [Formatos de estaciones de tierra](index.md)

## Contrato actual

Las estaciones se serializan dentro del documento JSON de proyecto. El contrato actual usa **station_schema_version: 2** y conserva la geometría, la configuración RF introducida y las opciones visuales. Las métricas derivadas se recalculan al restaurar el proyecto; no deben utilizarse como una fuente independiente de verdad.

## Campos persistidos

| Grupo | Ejemplos de campos |
| --- | --- |
| Identidad y geometría | Nombre, latitud, longitud, altura, `time_zone` IANA, máscara de elevación. |
| Apertura | Diámetro, eficiencia, frecuencia, polarización, modo de ganancia y valores forzados opcionales. |
| Patrón | Tipo, HPBW de azimut/elevación opcional y nivel de lóbulos secundarios. |
| RF y ruido | Potencia TX, receptor de referencia de planificación, umbral RX, temperatura de sistema, ancho de banda, SNR requerida y pérdidas atmosféricas, lluvia, cable y conectores. |
| Apuntado | RMS de apuntado, modo, boresight y límites mecánicos de azimut/elevación. |
| Visualización | Visibilidad de la estación y de su cobertura. |

La frecuencia puede conservarse en MHz y Hz como ayuda de interoperabilidad interna, pero el modelo normaliza una única frecuencia física. La potencia puede entrar en dBm o W y se normaliza a dBm para el presupuesto. `time_zone` es una zona IANA de presentación: las gráficas y tablas pueden mostrar hora local, mientras que las épocas físicas, AOS/LOS y CSV permanecen en UTC.

Los HPBW guardados son anchos completos a media potencia. No convierten el patrón en una puerta binaria: en modo `stationary` el patrón gaussiano o `cos^n` se evalúa de forma continua y el HPBW solo identifica el contorno de −3 dB. En `tracking`, el objetivo se presupuesta con apuntamiento; en `scan`, el campo persistido describe cobertura potencial hasta que exista una agenda o una ley de barrido.

`coverage_visible` controla únicamente la presentación. La huella 2D, el sector/anillo derivado de los topes de montura, la malla 3D, los cortes de patrón y el mapa discreto de ganancia se regeneran desde el contrato; no son datos físicos independientes ni determinan por sí mismos AOS/LOS. Los valores de alcance, huella y métricas RF que puedan acompañar una exportación son cachés de presentación y se recalculan al cargar.

## Relación con GeoJSON

[GeoJSON](interchange.md) es una proyección de intercambio de cada estación,
no una sustitución de este documento. Expone una geometría <code>Point</code>
WGS-84 y un subconjunto de identidad/configuración; conserva el contrato RF
autorado bajo <code>properties["orbit:rf"]</code> y las preferencias de
presentación bajo <code>properties["orbit:visual"]</code>.

No transporta el árbol de carpetas, otras capas, el modo temporal, estado de
selección, manejadores Cesium, mallas derivadas, rangos, <code>G/T</code>, SNR ni
análisis AOS/LOS. Para una copia reabrible y completa del espacio de trabajo,
exporte el proyecto JSON; para QGIS o un sistema GIS, exporte GeoJSON.

## Alcance

Este JSON es un formato interno de espacio de trabajo, no un estándar de intercambio. La envolvente que se conserva es una configuración de planificación recíproca; no sustituye un perfil RF remoto ni certifica una SNR. Una SNR real requerirá además EIRP efectivo, polarización del terminal remoto y que la señal ocupada cumpla \(|\Delta f|+B_{\mathrm{señal}}/2\le B_{\mathrm{RX}}/2\). Consulte [Estaciones de tierra](../../user-guide/ground-stations.md) para las ecuaciones, unidades y límites del modelo.
