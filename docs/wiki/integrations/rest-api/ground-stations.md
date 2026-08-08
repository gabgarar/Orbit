# REST API: estaciones de tierra

[Integraciones](../index.md) · [REST API](../rest-api.md) · [Estaciones de tierra](../../user-guide/ground-stations.md)

| Método y ruta | Operación | Requisitos |
| --- | --- | --- |
| **GET /api/aos-los** | Calcula accesos con parámetros de consulta. | Identificador de satélite, latitud y longitud; altura, máscara, intervalo, paso y límites mecánicos opcionales. |
| **POST /api/aos-los** | Calcula accesos con cuerpo JSON. | Fuente de catálogo/TLE **o** definición manual, estación, instante inicial/final y paso de muestreo. |

## Fuente orbital

`GET /api/aos-los` mantiene el contrato ligero de catálogo y requiere `sat_id`.
`POST /api/aos-los` admite además una fuente explícita en `source`:

| `source.kind` | Campos de fuente | Uso |
| --- | --- | --- |
| `catalog` | `sat_id` **o** `line1` + `line2` | Catálogo cargado o TLE explícito, propagado mediante SGP4. |
| `manual` | `manualOrbit` | Definición autorada de órbita manual; no admite `sat_id` ni líneas TLE. |

La forma recomendada para una órbita manual es:

```json
{
  "source": {
    "kind": "manual",
    "manualOrbit": {
      "name": "Órbita de ensayo",
      "epoch": "2026-08-08T12:00:00Z",
      "propagator": "two-body",
      "definitionSource": "keplerian",
      "keplerian": {
        "referenceFrame": "EME2000",
        "timeScale": "UTC",
        "semiMajorAxisKm": 7000,
        "eccentricity": 0.001,
        "inclinationDeg": 98,
        "raanDeg": 20,
        "argumentOfPerigeeDeg": 30,
        "trueAnomalyDeg": 0
      }
    }
  },
  "station": { "lat_deg": 40.4168, "lon_deg": -3.7038 },
  "start_time": "2026-08-08T12:00:00Z",
  "end_time": "2026-08-09T12:00:00Z",
  "step_seconds": 20
}
```

`manualOrbit` es el mismo contrato de creación manual: conserva época,
representación, propagador y opciones de fuerza/integrador. La ventana AOS/LOS
no se toma automáticamente de `manualOrbit.start_time` o `end_time`: los
campos de nivel superior `start_time` y `end_time` son el intervalo que se
analiza. Un cliente que quiera repetir una previsualización de diseño debe
enviar deliberadamente esas mismas fechas.

La fuente manual se propaga primero en su marco dinámico nativo `EME2000` y
cada posición se transforma a `ITRF` para la geometría WGS-84/ENU. La respuesta
por tanto conserva `reference_frame: "ITRF"` y `time_scale: "UTC"`; añade
`source.kind: "manual"`, el propagador canónico y
`source.dynamics_reference_frame: "EME2000"`. El campo `satellite` es solo el nombre de
la definición manual: la solicitud no inscribe un objeto en el catálogo ni crea
un identificador NORAD/COSPAR.

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

## Relación con el intercambio de estaciones

La importación y exportación de estaciones en
[GeoJSON, Orbit JSON y CSV](../../formats/ground-stations/interchange.md) es
una operación local de la aplicación, no una ruta REST. Parte del contrato
autorado de la capa y no serializa ni reinyecta una respuesta de
<code>/api/aos-los</code>.

Por ello los archivos no contienen muestras de elevación, AOS/LOS, rango, SNR
ni resultados dependientes de un satélite remoto. Esos valores siguen siendo
resultados calculados de la API y del modelo RF cliente, con sus instantes
físicos en UTC. Después de importar una estación, el cliente vuelve a solicitar
un análisis cuando el operador elige satélite, instante y ventana.

## Salida y criterio de visibilidad

Cada muestra devuelve elevación y azimut, además de `range_km`, `geometric_visible`, `rf_visible`, `operational_visible`, `pattern_loss_db` y `directional_max_range_km`. Una muestra es visible si supera máscara, límites mecánicos y la puerta de rango direccional enviada. Para una estación estacionaria, `within_main_lobe` informa del contorno HPBW de −3 dB, pero no es una pared de visibilidad: una dirección fuera del contorno puede conservar ganancia por el patrón y sus lóbulos secundarios, aunque su alcance operativo sea menor.

`include_samples` es opcional y vale `true` por defecto. Con `false`, la API evalúa exactamente la misma secuencia interna, conserva `count` y `passes`, pero devuelve `samples: []`. Es apropiado para tarjetas de próximo pase que no dibujan una curva. `chart_padding_seconds` es opcional: con `null` conserva la serie histórica completa; con un número no negativo devuelve solo las muestras dentro de cada pase refinado más ese margen en ambos extremos. `returned_sample_count` y `sample_scope` distinguen la respuesta transmitida de `count`, que siempre es el número de estados evaluados. El cálculo AOS/LOS transforma solo la posición a ITRF: no calcula velocidad, derivadas de rotación ni estados nativos que el criterio de visibilidad no usa.

La efeméride se calcula primero al paso solicitado. Cuando dos muestras consecutivas cambian de visibilidad, la API reevalúa el mismo propagador y la misma geometría ITRF mediante bisección hasta acotar el cruce AOS/LOS a aproximadamente 0.5 s. El paso sigue siendo importante: un pase completo entre dos muestras puede no quedar encerrado y la elevación máxima publicada procede de las muestras del perfil. Los tiempos de respuesta son UTC; la zona IANA de la estación es una preferencia de presentación del cliente. Consulte [Estaciones de tierra](../../user-guide/ground-stations.md) para el modelo RF, sus unidades y sus límites de interpretación.
