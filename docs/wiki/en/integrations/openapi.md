# OpenAPI, Swagger and ReDoc

## Documentation endpoints

The FastAPI backend generates its OpenAPI document during boot. The gateway
publishes it to the same origin as the interface:

| Resource | Public route |
| --- | --- |
| OpenAPI JSON Document | `/openapi.json` |
| Swagger UI | `/docs` |
| ReDoc | `/redoc` |

The FastAPI application is currently identified as `Orbit Propagation API`
with internal version `0.1.0`. That string describes the backend configuration,
not a promise of stable versioning for external integrators.

## Use of the document

The document is the source of details of the Pydantic schemes that support
FastAPI routes: required fields, formats, limits and responses
validation. It should be consulted in the specific instance before generating a
client or establish a contract.

```text
http://127.0.0.1:8100/openapi.json
```

The gateway exposes Swagger and ReDoc via proxy. If the Python backend is not
available, these routes do not replace the gateway healthcheck nor do they guarantee
make orbital operations available.

## Scope of the generated document

OpenAPI describes the FastAPI routes included in the application: propagation,
orbits, ephemeris, stations, manual orbits, orbital parameters and
some system operations. The gateway adds its own catalog routes,
import, refresh, configuration and export that are not generated from
FastAPI and are therefore not fully covered by `/openapi.json`.

Conversely, some internal FastAPI routes are not forwarded as an interface
gateway public. A posted transaction requires you to be present at the
OpenAPI document **and** that its route is exposed by the gateway. The table of
[REST API](rest-api.md) identifies that boundary.

## Client generation restrictions

There is no OpenAPI client generated, distributed SDK, schema authentication or
breaking changes policy. The generation of an external client must
considered a local integration maintained by its owner.

Before using a generated client:

1. Obtain the document from the destination instance.
2. Check that the route is published by the gateway.
3. Send dates with time zone and preserve frame, units and fields
   time scale of responses.
4. Treat `422`, `502` and `503` responses as operational results
   recoverable, not as indistinguishable transport exceptions.

## Related references

- [REST API](rest-api.md)
- [Python SDK](python-sdk.md)
- [Validation](../development/validation.md)