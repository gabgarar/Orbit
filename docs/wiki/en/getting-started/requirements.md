# Requirements

[Start](../index.md) · [Installation](installation.md) · [Quick Start](quick-start.md)

Orbit is distributed as a local application composed of a Node.js gateway,
a React/Cesium frontend compiled as static assets and a Python service
internal. Recommended path encapsulates runtime components in Docker
Compose; the frontend is not a third independent running process.

## Recommended environment

| Component | Requirement | Use in Orbit |
| --- | --- | --- |
| Operating system | Windows, macOS, or Linux with Docker Desktop or Docker Engine that supports Compose | Reproducible execution of the complete runtime. |
| Docker | Docker Compose v2 and daemon running | Image construction, config/ volume and HTTP publishing. |
| Browser | Modern browser with WebGL available | 3D viewer based on Cesium and local recording of the canvas. |
| Local port | 8100 available, or an alternative port | Orbit HTTP Gateway. |
| Storage | Space for image, offices and local catalogs | The config/ folder is kept outside the image. |

The default post is limited to 127.0.0.1. Orbit does not incorporate
authentication or authorization; should not be exposed to an untrusted network without a
external access control.

!!! warning "WebGL is required for the workspace"

    If the browser or graphics driver does not support WebGL, the 3D viewer will not
    may offer an equivalent alternative. Check acceleration by
    hardware and corporate policies of the browser before deploying it
    in an operating position.

## Running without Docker

Direct execution requires Node.js **24** and Python **3.10 or later**.
It also requires npm and access to
dependencies fixed during installation. The frontend must be compiled before
starting the gateway.

~~~powershell
py -3 -m pip install -r server/requirements.txt
Set-Location react-ui
npm.cmd ci
npm.cmd run build
Set-Location ..\server
npm.cmd ci
npm.cmd start
~~~

On macOS and Linux, python3 and npm are usually used instead of py -3 and
npm.cmd.

!!! note "Local data"

    The runtime reads configuration and catalog from config/. In Docker that route
    mounts as volume in /app/config; when deleting and recreating a container does not
    those files are deleted.

## Temporal data for accuracy

The visualization can be started without local EOP products. The calculations
reproducible time and terrestrial frames require, instead, a snapshot
IERS C04 and a local leap second table. Requirements, variables
environment and strict mode limits are described in
[Operation timing and EOP](../operations/time-eop.md).

## Preflight

~~~powershell
docker compose version
docker compose config
~~~

The second command resolves the Compose file without starting Orbit. If used
a different port, define ORBIT_HTTP_PORT; if you change the interface
listen, define ORBIT_HTTP_BIND. Keep the latter at 127.0.0.1 for a
normal local use.

## Platform limits

- There is no desktop installer, product CLI or distributed SDK.
- There is no remote storage, users or multi-user collaboration.
- Remote basemaps available in settings require the
  corresponding connectivity; locally generated and included assets
  They do not require a CDN during execution.

Continue with [installation](installation.md) or the
[quick start](quick-start.md).