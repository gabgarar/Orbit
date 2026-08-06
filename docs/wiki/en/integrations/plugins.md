# Plugins

## Current status

Orbit **does not have a plugin host or a plugin runtime**. There is no active
`PluginHost` class, extension registry, manifest, or API through which external
code can participate in the application process.

Current features are integrated as ordinary repository modules, reviewed with
the rest of the codebase, and loaded by the appropriate frontend, gateway, or
backend entry point. That is not an extension system.

| Capability | Current status |
| --- | --- |
| Plugin host and lifecycle | Not implemented. |
| Runtime plugin registry | Not implemented. |
| Public frontend or backend plugin API | Not published. |
| Manifest, versioning, compatibility, or marketplace | Not implemented. |
| Installation through UI, CLI, npm, or pip | Not available. |
| Remote code loading in the browser | Not available. |

!!! warning "There is no extension API"

    Internal modules must not be imported as if they were supported plugins.
    Internal routes, events, configuration structures, and contracts can
    change without an extension compatibility guarantee.

## Extensibility roadmap

A plugin system will only be considered after a product decision and at least
the following contracts have been defined:

1. A host integrated with runtime startup and shutdown, with deterministic
   activation and cleanup.
2. An explicit, versioned context for dependencies such as Cesium, services,
   events, and UI slots.
3. Identity, manifest, compatibility, and upgrade policy for each extension.
4. Security boundaries: arbitrary code will not be downloaded or executed in
   the browser.
5. Project persistence, migrations, observability, and lifecycle tests before
   exposing any extension point.

Until then, extracting a domain into a tested module is an internal
architecture improvement, not an installable plugin.

## Available alternatives today

- Use the local [REST API](rest-api.md), [WebSocket](websocket.md), and
  [OpenAPI](openapi.md) interfaces to interoperate with Orbit.
- To contribute to the product, add code to the appropriate repository domain
  and validate it with the relevant tests.

## Related references

- [Architecture](../development/architecture.md)
- [Contributing](../development/contributing.md)
- [Roadmap](../reference/roadmap.md)
