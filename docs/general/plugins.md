# Orbit Plugin Model

Orbit plugins are local ES modules with a small lifecycle contract. They are a packaging and ownership boundary, not a mechanism for executing arbitrary third-party code in the browser.

## Plugin contract

```js
export const groundStationsPlugin = {
    id: "orbit.ground-stations",
    async activate(context) {
        // Register UI, commands, routes, or event listeners here.
    },
    async deactivate() {
        // Remove listeners and release plugin-owned resources here.
    }
};
```

Each plugin must have a stable, namespaced identifier. Its module must own its state, UI, Cesium entities, event listeners, and cleanup logic.

## Plugin context

The application shell will provide only explicit dependencies to a plugin. Intended context fields are:

| Field | Purpose |
| --- | --- |
| `viewer` | The Cesium viewer instance. |
| `services.systemConfig` | Read and write runtime configuration. |
| `services.catalog` | Catalog queries and imports. |
| `events` | Application events published by the shell. |
| `ui` | Explicit UI slots and dialogs owned by the shell. |

Plugins must not import `main.js`, access unrelated global state, or rely on DOM traversal outside their declared UI slot.

## Migration order

1. Extract a domain into a standalone module with tests.
2. Replace references to shared `main.js` variables with an explicit context object.
3. Register it as a built-in plugin through `PluginHost`.
4. Keep route names, configuration keys, and WebSocket payloads backward compatible.

Ground stations are the best first feature plugin because their state, Cesium entities, calculations, dialogs, and persistence are already conceptually grouped. Satellite layers should follow after their rendering and catalog responsibilities are separated.

## Security and distribution

Only local, versioned modules are supported. A future marketplace should install reviewed packages during build/deployment, not download and execute code at browser runtime.
