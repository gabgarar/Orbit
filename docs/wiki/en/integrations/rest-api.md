# REST API

## Network purpose and limit

The Orbit HTTP API is served from the same origin as the web interface. The
Node.js gateway exposes public routes, preserves the catalog and the
configuration, and forwards the orbital operations to the private FastAPI process.
The base URL is that of the gateway, normally:

```text
http://127.0.0.1:8100
```

There is no version, authentication, or authorization prefix. The API is
Designed for a local installation or a controlled network. Consult
[Deploy](../development/deployment.md) before publishing the port to a
network.

!!! warning "Contract without public versioning"

    Orbit does not yet publish a compatibility guarantee for customers
    external. Consumers must validate the scheme against
    [OpenAPI](openapi.md) in the instance that will use and tolerate fields
    additional in the answers.

## Common conventions

| Element | Contract |
| --- | --- |
| Body | JSON except file exports. The gateway limits JSON bodies to 25 MB. |
| Dates | Send ISO-8601 with time zone, preferably `Z`/UTC. Orbital routes normalize their instants to UTC. |
| Satellite identifier | `sat_id` and `:satId` resolve against the name/id loaded into the catalog. URL encoding is the responsibility of the client. |
| Orbital source | Catalogue routes accept a `sat_id` **or** both `line1` and `line2` TLE lines. `POST /api/aos-los` also accepts an explicit manual definition in `source`; it does not register it in the catalogue. |
| Cartesian states | When the response includes units, the rendering representation declares `reference_frame: "ITRF"`, position in meters, and velocity in m/s. Precision sources and products maintain more explicit scale and framework contracts internally. |
| Gateway errors | An invalid JSON returns `400`; an excessive body, `413`; a failure when accessing the Python backend, `502` with `{ "ok": false, "error": "…" }`. |
| FastAPI validation errors | Invalid forms or values ​​normally return `422`; a source not found may return `404`. |

Queries forwarded to the backend have a maximum time of 30 seconds
the gateway. The backend response retains its HTTP state and type.
content when resending is successful.

## API areas

| Area | Content |
| --- | --- |
| [Status, configuration and catalog](rest-api/system-and-catalog.md) | Healthcheck, persistent configuration, documentation and catalog. |
| [Propagation and ephemeris](rest-api/orbit-operations.md) | TLE, precise GNSS SP3/CLK/ERP/SUM/ATT/OSB products, time series, parameters, and manual orbits. |
| [Ground Stations](rest-api/ground-stations.md) | AOS/LOS and limits of passing geometry. |
| [Export](rest-api/exports.md) | TLE, OMM, OEM, OCM and exported anniversaries. |
| [Backend Border](rest-api/backend-boundary.md) | Private routes that are not a public contract. |

## Related references

- [OpenAPI and Swagger](openapi.md)
- [WebSocket](websocket.md)
- [Architecture](../development/architecture.md)
- [Validation](../development/validation.md)
