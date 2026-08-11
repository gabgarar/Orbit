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

## Precise GNSS products

Precise products load through a route separate from the TLE catalogue. The
gateway exposes the Python-backend contract, but the file always comes from the
local client: Orbit does not accept a URL, Earthdata token, or CDDIS/IGS/ESA
credential.

| Method and route | Operation | Main limit |
| --- | --- | --- |
| `GET /api/precise-products` | Lists persisted products, rehydration diagnostics, and runtime IDs per satellite. | It does not download sources again. |
| `POST /api/precise-products/import` | Validates, persists, and registers a GNSS product. | One required SP3 and at most one of every ancillary file: CLK, ERP, SUM, ATT, and OSB. |

The canonical import body is:

~~~json
POST /api/precise-products/import
Content-Type: application/json

{
  "sp3": {
    "name": "IGS0OPSFIN_20262230000_01D_15M_ORB.SP3.gz",
    "kind": "sp3",
    "content_base64": "<base64-of-local-file>"
  },
  "clk": {
    "name": "IGS0OPSFIN_20262230000_01D_05M_CLK.CLK.gz",
    "kind": "clk",
    "content_base64": "<base64-of-local-file>"
  },
  "erp": {
    "name": "IGS0OPSFIN_20262230000_01D_ERP.ERP.gz",
    "kind": "erp",
    "content_base64": "<base64-of-local-file>"
  }
}
~~~

`content_base64` carries the binary without a `data:` prefix. Provider, family,
and class are determined exclusively from the sources: requests must not assign
`provider_hint` or `product_class` manually. For compatibility, the service
accepts only `auto`; a manual override is rejected. When evidence is
insufficient, it records `custom`/`unknown`.

Every input is classified from its window field and extension: required SP3
`.SP3`/`.SP3.gz`; optional CLK `.CLK`/`.CLK.gz`; optional ERP
`.ERP`/`.ERP.gz`; SUM `.SUM`/`.SUM.gz`; ATT `.ATT.OBX`/`.ATT.OBX.gz` or the
`.ATT`/`.OBX` aliases and their `.gz` variants; and OSB
`.OSB.BIA`/`.OSB.BIA.gz` or `.BIA`/`.BIA.gz`. The service rejects an upload
with no SP3 using `422` and the exact text **“Debe proporcionar un fichero SP3.”**.

The current UI does not request ECI at import time. `require_eci` is reserved
for a future feature that needs an ITRF-to-ECI conversion; with `true`, ERP
will be required and its absence will produce `422` with the exact text
**“Debe proporcionar un fichero ERP para convertir a ECI.”**. ERP supplies UT1
and polar motion; when SP3 declares an IGS realization, a registered and
applied realization transform is also required. ERP does not invent that
transformation, so ECI remains blocked until both conditions are met.

A successful response contains `product`, `satellites`, and `importedIds`.
`product` declares provider, class, family, detection, native frame,
operational frame label, time scale, coverage, ancillary products, and
SHA-256 checksums of its sources. Each registered satellite ID has the form
`precise:<product_id>:<gnss_identifier>`, for example
`precise:precise-0123456789abcdef0123:G01`. That ID can be used as `sat_id` in
ephemeris, orbital-parameter, propagation, and AOS/LOS routes, but a query
must remain inside SP3 coverage.

The service stores the product and its verified manifest under the
`config/precise-products/` volume; the runtime loads it again at startup. A
project can retain the stable ID, but it does not embed a binary copy. See
[Precise GNSS products](../../formats/precise-products.md) for providers,
quality, ancillary products, realizations, and scientific limitations.

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
