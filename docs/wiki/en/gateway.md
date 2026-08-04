# Gateway

## Overview

The Node.js gateway is Orbit's public boundary. It serves the built frontend, exposes HTTP/WebSocket, manages local data and supervises the private Python service.

## Runtime

Docker runs Node.js 24 as the main process and Python on `127.0.0.1:8765`. The gateway listens on `8100` and mounts host `config/`.

```text
browser → Node gateway :8100 → private Python service :8765
```

The image installs dependencies and runs Node, frontend and Python tests before producing the runtime. If rebuilding fails, the restart script preserves the previous container.

## Configuration

`config/` is persistent operator-owned data. `ORBIT_HTTP_BIND` defines local versus network exposure; `ORBIT_HTTP_PORT` defines port. Orbit provides no authentication, so network exposure requires external controls.

## Limits

- No distributed deployment, remote database or multi-user collaboration.
- Python port is not public API.
- Local configuration is not a secrets manager.

## Next destinations

<div class="grid cards" markdown>

- :material-api: **Use the public boundary**

  HTTP routes, WebSocket and response contracts.

  [Open API →](api.md)

- :material-layers-triple: **Open the client**

  Project behaviour and visualisation.

  [Open workspace →](workspace.md)

</div>
