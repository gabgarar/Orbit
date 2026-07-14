# Orbit Architecture

Orbit is a single-container application with three runtime domains:

```text
Browser UI  ──HTTP / WebSocket──>  Node gateway  ──localhost──>  Python API
```

## Runtime domains

| Domain | Location | Responsibility |
| --- | --- | --- |
| Browser application | `public/` | Cesium rendering, UI state, configuration controls, and WebSocket consumption. |
| Node gateway | `server/nodeServer.js` | Static files, configuration persistence, catalog import/update, and proxying to Python. |
| Python propagation API | `server/python/` | SGP4 propagation, ephemerides, station visibility, and WebSocket state delivery. |
| Shared runtime data | `config/` | User-editable system configuration and catalog data. |
| Visual regression checks | `server/tests/ui/` | Responsive UI checks executed with Playwright. |

## Frontend module boundaries

New frontend code should be added to one of these domains instead of extending `public/main.js`:

```text
public/js/
  runtime/       viewport policies, startup helpers, and application lifecycle
  rendering/     Cesium-specific scene and entity rendering
  features/      self-contained user-facing workflows
  services/      HTTP, WebSocket, and persistence clients
  ui/            reusable UI controls and dialogs
```

The existing files are kept stable while functionality moves gradually. The first extracted runtime module is `runtime/adaptiveDisplay.js`.

## Plugin boundary

Feature plugins will be local ES modules managed by `public/js/plugins/pluginHost.js`. This keeps a future ground-stations or satellites plugin independent without allowing arbitrary remote browser code. See [plugins.md](plugins.md) for the lifecycle contract and migration rules.

## Server boundaries

`server/nodeServer.js` currently contains multiple responsibilities. Future extraction should keep public routes unchanged and move code into:

```text
server/src/
  catalog/       download, validation, parsing, and persistence
  config/        system configuration read/write and validation
  proxy/         Python API proxy routes
  routes/        Express route registration
```

## Conventions

- Source identifiers, comments, documentation, commit messages, and user-facing developer logs are written in English.
- Keep UI strings in the existing translation layer; do not hard-code translated labels in domain modules.
- A module owns one domain and exposes a small public API through named exports.
- Add a focused test whenever behavior moves across a module boundary.
- Preserve `config/` as a volume-backed runtime boundary; application code must not depend on container-local mutable state.
