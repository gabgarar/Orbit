# REST API: ground stations

[Integrations](../index.md) · [REST API](../rest-api.md) · [Ground Stations](../../user-guide/ground-stations.md)

| Method and route | Operation | Requirements |
| --- | --- | --- |
| `GET /api/aos-los` | Calculates accesses with query parameters. | `sat_id`, latitude and longitude; optional height, minimum elevation, interval and step. |
| `POST /api/aos-los` | Calculates accesses with JSON body. | Source TLE, `station`, `start_time`, `end_time` and `step_seconds`. |

A station declares `lat_deg` between −90 and 90, `lon_deg` between −180 and 180,
`height_m` between −1000 and 100000 and `min_elevation_deg` between 0 and 90. The output
includes lift samples and AOS/LOS passes. Detection depends on the step of
requested sampling; It is not a search for precision roots.