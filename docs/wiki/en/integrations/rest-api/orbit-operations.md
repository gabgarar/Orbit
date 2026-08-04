# REST API: propagation and ephemeris

[Integrations](../index.md) · [REST API](../rest-api.md) · [Propagation](../../propagation/index.md)

## Propagation routes

| Method and route | Operation | Testable limits |
| --- | --- | --- |
| `GET /api/propagate/:satId` | Propagate a catalog satellite instantly `at` optional. | If `at` is omitted, uses the current UTC time. |
| `POST /api/propagate` | Propagates from catalog or explicit TLE. | Body `sat_id` or `line1` + `line2`; `at` optional. |
| `GET /api/orbits/:satId` | Samples a future catalog orbit. | `horizon_hours`: 0.1–8760; `samples`: 2–7200 if specified. |
| `POST /api/orbits` | Samples an orbit from catalog or explicit TLE. | The same horizon limits and samples. |
| `POST /api/ephemeris` | Build a time series. | `start_time < end_time`, `step_seconds` > 0 and ≤ 3600; maximum 20,000 points. |
| `POST /api/orbit-parameters` | Calculates osculating elements in a range. | 2–2000 samples and integration budget for RK4. |

Example of propagation from explicit TLE:

~~~json
POST /api/propagate
Content-Type: application/json

{
  "line1": "1 25544U 98067A   24120.50000000  .00000000  00000+0  00000+0 0  9990",
  "line2": "2 25544  51.6400 120.0000 0005000  20.0000 340.0000 15.50000000000000",
  "at": "2026-08-04T12:00:00Z"
}
~~~

An ephemeris uses `sat_id`, `start_time`, `end_time`, `step_seconds` and
`include_velocity` optionally.

!!! warning "Fidelity and frameworks"

    TLEs are propagated with SGP4 and have native TEME state. The departure of
    rendering is transformed to ITRF. Don't use a display response
    as a hi-fi navigation anniversary.

## Manual orbit

`POST /api/manual-orbits` creates a temporary manual orbit and its ephemeris
preview. Supports `two-body`, `sgp4` and `cowell-rk4`; J2 is kept only for
compatibility.

| Field | Requirement |
| --- | --- |
| `epoch` | ISO-8601 instant with time zone. |
| `keplerian` | EME2000/UTC; semimajor axis in km and angles in degrees. |
| `state_vector` | EME2000/UTC; position km and speed km/s. |
| `propagation_options.force_terms` | `central` is added automatically; `j2`, `j3`, `j4` and `drag` are optional. |
| `propagation_options.numerical_integrator` | `rk4` only. |

The response returns the canonical form, the resolved engine, the summary
geometric and the ephemeris. It does not incorporate the orbit into the persistent catalog.