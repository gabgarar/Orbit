# Python SDK

## Status

Orbit does not distribute a public Python SDK.

No publishable package, package index, `pyproject.toml`, documentation
installation, SDK semantic version or compatibility policy for
external consumers. Therefore, a package should not be installed or advertised
named `orbit` or `orbit_api` as the supported Orbit interface.

## Python code included in the repository

The `server/python/orbit_api/` tree contains the private implementation of the
FastAPI backend. Its modules cover, among others, propagation, frameworks,
timekeeping, tabular formats, HTTP routes and cache. These imports exist
to compose the Orbit runtime and to execute its tests; do not constitute
an SDK.

| Need | Currently supported path |
| --- | --- |
| Propagate or obtain an ephemeris from another local application | [REST API](rest-api.md) through the gateway. |
| Consult the orbital operations scheme | [OpenAPI](openapi.md) of the active instance. |
| Receive updates from subscribed layers | [WebSocket](websocket.md). |
| Contribute to backend | Repository source code and [Contribute](../development/contributing.md). |

!!! warning "Internal imports"

    Directly importing `orbit_api` from an external process docks that
    process to routes, dependencies and non-versioned contracts. There is no guarantee
    of stability of names, signatures, types or behavior outside the
    runtime that starts Orbit.

## Requirements for a future SDK

There is no approved proposal or publication date. A public SDK
would require, at a minimum, a versioned distribution, transport contracts
or stable domain names, compatibility policy, explicit management of
EOP/leap second data, reproducible examples, and a matrix of
Independent testing of the Orbit process. This list does not advertise that such
capabilities are planned.

## Related references

- [REST API](rest-api.md)
- [OpenAPI](openapi.md)
- [Roadmap](../reference/roadmap.md)