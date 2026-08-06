# Orbit Architecture

Orbit is a single-container application with three runtime domains:

```text
Browser UI  ──HTTP / WebSocket──>  Node gateway  ──localhost──>  Python API
```

## Runtime domains

| Domain | Location | Responsibility |
| --- | --- | --- |
| Browser application | `front/` | Cesium rendering, UI state, configuration controls, and same-origin WebSocket consumption. |
| Node gateway | `server/nodeServer.js` | Static files, configuration persistence, catalog import/update, and HTTP/WebSocket proxying to Python. |
| Python propagation API | `server/python/` | SGP4 propagation, ephemerides, station visibility, and WebSocket state delivery. |
| Shared runtime data | `config/` | User-editable system configuration and catalog data. |
| Visual regression checks | `tests/ui/` | Responsive UI checks executed with Playwright. |

## Frontend module boundaries

New frontend code should be added to one of these domains instead of extending `front/main.js`:

```text
react-ui/src/
  components/     reusable React presentation and dialog components
  features/       React workflows grouped by domain (camera, simulation, ...)
  App.jsx         application composition only; no Cesium runtime logic

front/js/
  runtime/       viewport policies, startup helpers, and application lifecycle
  rendering/     Cesium-specific scene and entity rendering
  features/      self-contained user-facing workflows
  services/      HTTP, WebSocket, and persistence clients
  ui/            reusable UI controls and dialogs
```

`front/main.js` remains the Cesium runtime entry during the migration, but it
is imported through `react-ui/src/runtime/legacyRuntime.js`. Vite emits it as
a versioned chunk, so a production build validates the full runtime module
graph instead of leaving browser parsing to a raw static import.

`front/js/runtime/projectEventBridge.js` owns the event boundary between React
project dialogs and the Cesium runtime. It queues project commands issued while
the runtime chunk is loading and replays them only after the lifecycle is
ready; React keeps the welcome screen visible until the lifecycle confirms
`orbit:project-opened`, so a failed runtime chunk cannot leave the user in a
false project state.

`front/js/runtime/projectDocument.js` owns the versioned project-file contract
(normalisation, validation, and serialization shape). `projectLifecycle.js`
uses that contract to apply a document to the Cesium runtime.
`front/js/runtime/projectFileIO.js` owns browser file-handle, JSON read, and
download adapters, keeping DOM and Blob APIs out of the project domain.

The existing files are kept stable while functionality moves gradually. The first extracted runtime module is `runtime/adaptiveDisplay.js`.

## Future plugin boundary

Orbit does not currently contain a plugin host, plugin registry, or extension
runtime. Features are ordinary repository modules loaded by their frontend,
gateway, or backend entry point. A future extension boundary must define an
explicit lifecycle, a versioned dependency context, compatibility, persistence,
security, and tests before it is exposed. See [plugins.md](plugins.md) for the
roadmap and current limits.

## Server boundaries

`server/nodeServer.js` is the process entry point only. `server/src/runtime/orbit-runtime.js`
composes dependencies and owns startup/shutdown, while `server/src/app.js`
composes Express middleware and route adapters. Public routes remain unchanged
while the implementation is separated by responsibility:

```text
server/src/
  catalog/       validation, parsing, identity, metadata, queries, persistence,
                 exports, and remote refresh scheduling
  config/        system-configuration validation and persistence repository
  proxy/         Python HTTP client, forwarding mechanics, and route registration
  routes/        HTTP adapters and the JSON API error contract
  runtime/       runtime settings, HTTP server lifecycle, local Python backend,
                 and application startup/shutdown composition
```

Catalog read/import routes and catalog download routes are registered
separately (`routes/catalog.js` and `routes/catalog-exports.js`), so adding a
new export format does not expand the catalog query controller.

The browser always opens `ws://` or `wss://` on the same host and port as the
web application at `/ws`. `runtime/http-server.js` proxies that upgrade to the
private Python backend, so Docker only publishes Orbit's HTTP port; the Python
port remains an internal implementation detail and HTTPS reverse proxies keep
working without a second public port.

The Compose deployment binds that HTTP port to `127.0.0.1` by default. Network
exposure is an explicit operator choice through `ORBIT_HTTP_BIND=0.0.0.0`; the
published port remains configurable independently with `ORBIT_HTTP_PORT`.

`catalog/page-service.js` owns filtering, pagination, and catalogue summary
metadata, while `routes/catalog-actions.js` owns the refresh, import, and
single-TLE HTTP actions. `catalog/parsers.js` is the single format dispatcher
used by both local imports and remote downloads; format aliases such as OMM
are normalised there before parsing.

`catalog/identity.js` keeps the two NORAD contracts explicit: catalogue
queries derive a numeric value from TLE line 1, while export payloads preserve
an explicit external identifier when one exists. `proxy/forwarder.js` owns
query/body forwarding and upstream error translation, so route declarations do
not contain transport details and applies a bounded request timeout. The Python
supervisor treats initial child-process startup failures as terminal, ignores
late events from an older replaced process, and retries an owned backend that
exits after becoming healthy with bounded backoff. Intentional shutdown cancels
that recovery path.

`config/repository.js` serializes full replacements and functional updates in
one process-local write queue. System-settings saves and catalog refresh
timestamps therefore read the latest persisted configuration before changing
their own fields. The catalog-refresh timestamp is server-managed data, so a
browser preferences save cannot erase or forge it. The active
`satellites_catalog_file` is likewise a boot-time operational setting: browser
preference saves may preserve it, but cannot retarget the live catalog while
imports or refreshes can be in flight.

`catalog/repository.js` applies the same queued read-modify-write rule to
catalog mutations. Imports and remote refreshes therefore merge against the
latest durable entries rather than overwriting one another. A catalog or
system-settings response reports `persisted: true` with a `503` when the
Python reload is unavailable, making the temporary runtime/data divergence
explicit instead of reporting a false complete success.

Catalog entry resolution has a shared, deterministic collision policy:
`CUSTOM` entries override `CATALOG` entries with the same NORAD ID, while the
first entry from the same origin remains authoritative. The automatic refresh
scheduler stores its most recent remote attempt in the volume-backed
configuration, so a Docker restart resumes the remaining interval instead of
resetting it.

A refresh never rewrites the catalog when it receives no valid remote TLE. If
only some remote sources fail, prior catalog entries remain as a fallback while
fresh entries are merged in; this favors availability over a destructive partial
replacement.

## Conventions

- Source identifiers, comments, documentation, commit messages, and user-facing developer logs are written in English.
- Keep UI strings in the existing translation layer; do not hard-code translated labels in domain modules.
- A module owns one domain and exposes a small public API through named exports.
- Add a focused test whenever behavior moves across a module boundary.
- Preserve `config/` as a volume-backed runtime boundary; application code must not depend on container-local mutable state.
