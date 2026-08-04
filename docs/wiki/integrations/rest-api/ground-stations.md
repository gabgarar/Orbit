# REST API: estaciones de tierra

[Integraciones](../index.md) · [REST API](../rest-api.md) · [Estaciones de tierra](../../user-guide/ground-stations.md)

| Método y ruta | Operación | Requisitos |
| --- | --- | --- |
| `GET /api/aos-los` | Calcula accesos con parámetros de consulta. | `sat_id`, latitud y longitud; altura, elevación mínima, intervalo y paso opcionales. |
| `POST /api/aos-los` | Calcula accesos con cuerpo JSON. | Fuente TLE, `station`, `start_time`, `end_time` y `step_seconds`. |

Una estación declara `lat_deg` entre −90 y 90, `lon_deg` entre −180 y 180,
`height_m` entre −1000 y 100000 y `min_elevation_deg` entre 0 y 90. La salida
incluye muestras de elevación y pases AOS/LOS. La detección depende del paso de
muestreo solicitado; no es una búsqueda de raíces de precisión.
