# REST API: estaciones de tierra

[Integraciones](../index.md) · [REST API](../rest-api.md) · [Estaciones de tierra](../../user-guide/ground-stations.md)

| Método y ruta | Operación | Requisitos |
| --- | --- | --- |
| **GET /api/aos-los** | Calcula accesos con parámetros de consulta. | Identificador de satélite, latitud y longitud; altura, máscara, intervalo, paso y límites mecánicos opcionales. |
| **POST /api/aos-los** | Calcula accesos con cuerpo JSON. | Fuente TLE, estación, instante inicial/final y paso de muestreo. |

## Contrato de estación

El objeto **station** contiene geometría y límites operativos:

| Campo | Unidad | Regla |
| --- | --- | --- |
| **lat_deg**, **lon_deg** | grados | Latitud entre −90 y 90; longitud entre −180 y 180. |
| **height_m** | m | Entre −1 000 y 100 000. |
| **min_elevation_deg** | grados | Máscara de elevación entre 0 y 90. |
| **max_range_km** | km, opcional | Puerta de alcance operativo de la envolvente RF, enviada por el cliente; no es una propiedad de dibujo. |
| **mechanical_elevation_min_deg**, **mechanical_elevation_max_deg** | grados | Entre 0 y 90; el mínimo no puede superar el máximo. |
| **mechanical_azimuth_min_deg**, **mechanical_azimuth_max_deg** | grados | Entre −180 y 180; admiten un intervalo que cruza el norte. |
| **operation_mode** | tracking, scan o stationary | `tracking` sigue el objetivo; `scan` describe acceso potencial dentro de la montura; `stationary` conserva un haz fijo. |
| **boresight_azimuth_deg**, **boresight_elevation_deg** | grados | Dirección del haz fijo. |
| **beam_half_angle_deg** | grados, opcional | Compatibilidad con clientes antiguos; si faltan HPBW, aporta el semiancho circular de referencia. |
| **pattern_type** | gaussian o cosine | Ley continua de caída de ganancia para `stationary`. |
| **hpbw_azimuth_deg**, **hpbw_elevation_deg** | grados, opcionales | Anchos completos a media potencia; si faltan, la API usa el valor de compatibilidad. |
| **side_lobe_level_db** | dB | Suelo de pérdida por lóbulos secundarios del patrón simplificado. |

La API no recibe toda la cadena RF del diseñador ni un perfil RF remoto. El cliente calcula su envolvente de planificación recíproca con el contrato RF de la estación y entrega su puerta de alcance operativo de boresight como **max_range_km**, separada de cualquier límite de dibujo de la escena. En `stationary`, la API reduce esa puerta por la ganancia continua del patrón en cada dirección; HPBW solo informa del contorno de −3 dB. En `tracking` se aplica la ganancia de apuntamiento. En `scan`, el resultado es una cobertura potencial: no existe todavía una agenda, tiempo de permanencia o ley de barrido que confirme adquisición.

Por tanto, este endpoint no afirma una SNR de satélite: una SNR real exige EIRP efectivo, polarización del terminal remoto y que toda la señal ocupada cumpla \(|\Delta f|+B_{\mathrm{señal}}/2\le B_{\mathrm{RX}}/2\). Esas comprobaciones pertenecen al cliente cuando una capa publica un perfil RF remoto completo.

## Relación con la exportación GeoJSON

La exportación de estaciones a
[GeoJSON](../../formats/ground-stations/interchange.md) no serializa una
respuesta de <code>/api/aos-los</code>: parte de la configuración autorada en el
espacio de trabajo. Por tanto, el archivo no contiene muestras de elevación,
AOS/LOS, rango, SNR ni resultados dependientes de un satélite remoto. Esos
valores siguen siendo resultados calculados de la API y del modelo RF cliente,
con sus instantes físicos en UTC.

## Salida y criterio de visibilidad

Cada muestra devuelve elevación y azimut, además de `range_km`, `geometric_visible`, `rf_visible`, `operational_visible`, `pattern_loss_db` y `directional_max_range_km`. Una muestra es visible si supera máscara, límites mecánicos y la puerta de rango direccional enviada. Para una estación estacionaria, `within_main_lobe` informa del contorno HPBW de −3 dB, pero no es una pared de visibilidad: una dirección fuera del contorno puede conservar ganancia por el patrón y sus lóbulos secundarios, aunque su alcance operativo sea menor.

La efeméride se calcula primero al paso solicitado. Cuando dos muestras consecutivas cambian de visibilidad, la API reevalúa el mismo propagador y la misma geometría ITRF mediante bisección hasta acotar el cruce AOS/LOS a aproximadamente 0.5 s. El paso sigue siendo importante: un pase completo entre dos muestras puede no quedar encerrado y la elevación máxima publicada procede de las muestras del perfil. Los tiempos de respuesta son UTC; la zona IANA de la estación es una preferencia de presentación del cliente. Consulte [Estaciones de tierra](../../user-guide/ground-stations.md) para el modelo RF, sus unidades y sus límites de interpretación.
