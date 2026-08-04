# REST API: propagación y efemérides

[Integraciones](../index.md) · [REST API](../rest-api.md) · [Propagación](../../propagation/index.md)

## Rutas de propagación

| Método y ruta | Operación | Límites comprobables |
| --- | --- | --- |
| `GET /api/propagate/:satId` | Propaga un satélite de catálogo al instante `at` opcional. | Si se omite `at`, usa el instante UTC actual. |
| `POST /api/propagate` | Propaga desde catálogo o TLE explícito. | Cuerpo `sat_id` o `line1` + `line2`; `at` opcional. |
| `GET /api/orbits/:satId` | Muestrea una órbita futura de catálogo. | `horizon_hours`: 0.1–8760; `samples`: 2–7200 si se especifica. |
| `POST /api/orbits` | Muestrea una órbita desde catálogo o TLE explícito. | Los mismos límites de horizonte y muestras. |
| `POST /api/ephemeris` | Construye una serie temporal. | `start_time < end_time`, `step_seconds` > 0 y ≤ 3600; máximo 20 000 puntos. |
| `POST /api/orbit-parameters` | Calcula elementos osculadores en un rango. | 2–2000 muestras y presupuesto de integración para RK4. |

Ejemplo de propagación desde TLE explícito:

~~~json
POST /api/propagate
Content-Type: application/json

{
  "line1": "1 25544U 98067A   24120.50000000  .00000000  00000+0  00000+0 0  9990",
  "line2": "2 25544  51.6400 120.0000 0005000  20.0000 340.0000 15.50000000000000",
  "at": "2026-08-04T12:00:00Z"
}
~~~

Una efeméride usa `sat_id`, `start_time`, `end_time`, `step_seconds` e
`include_velocity` opcionalmente.

!!! warning "Fidelidad y marcos"

    Los TLE se propagan con SGP4 y tienen estado nativo TEME. La salida de
    renderizado se transforma a ITRF. No use una respuesta de visualización
    como efeméride de navegación de alta fidelidad.

## Órbita manual

`POST /api/manual-orbits` crea una órbita manual transitoria y su efeméride de
vista previa. Admite `two-body`, `sgp4` y `cowell-rk4`; J2 se conserva solo por
compatibilidad.

| Campo | Requisito |
| --- | --- |
| `epoch` | Instante ISO-8601 con zona horaria. |
| `keplerian` | EME2000/UTC; semieje mayor en km y ángulos en grados. |
| `state_vector` | EME2000/UTC; posición km y velocidad km/s. |
| `propagation_options.force_terms` | `central` se añade automáticamente; `j2`, `j3`, `j4` y `drag` son opcionales. |
| `propagation_options.numerical_integrator` | Solo `rk4`. |

La respuesta devuelve la forma canónica, el motor resuelto, el resumen
geométrico y la efeméride. No incorpora la órbita al catálogo persistente.
