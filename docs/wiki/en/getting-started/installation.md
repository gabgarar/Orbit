# Installation

[Start](../index.md) · [Requirements](requirements.md) · [Quick Start](quick-start.md)

## Installation with Docker Compose

From the root of the repository, with Docker running:

~~~powershell
docker compose up --build
~~~

The command builds the image, runs the tests included in the build phase.
build, starts the gateway and makes Orbit available in
http://localhost:8100. To preserve the terminal:

~~~powershell
docker compose up -d --build
docker compose ps
~~~

The expected container state is healthy. This confirms only that the gateway
and backend are alive; first start may still be downloading or validating
automatic gravity data. The Orbit startup panel and Built-In Test show the
separate readiness decision and progress. The records of the process set are
consult with:

~~~powershell
docker compose logs -f orbit
~~~

To stop it:

~~~powershell
docker compose down
~~~

docker compose down stops and removes the containers, but does not remove the
local config/ folder that Compose mounts as a volume.

## Listening port and interface

The container's internal port is always 8100. Host values are
can be adjusted without modifying the Compose file.

~~~powershell
$env:ORBIT_HTTP_PORT = "18100"
$env:ORBIT_HTTP_BIND = "127.0.0.1"
docker compose up -d --build
~~~

Then open http://localhost:18100. Set ORBIT_HTTP_BIND=0.0.0.0
publishes the gateway on all network interfaces. This option does not add
authentication and must be combined with external network controls.

## Windows operating scripts

The .scripts/ folder contains consistent accessors for the Docker environment.

| Command | Effect |
| --- | --- |
| ./.scripts/restart-orbit.cmd | Rebuild incrementally, recreate the service and wait for the healthcheck. |
| ./.scripts/restart-orbit.cmd -SkipBuild | Reuse the current image and restart the service. |
| ./.scripts/restart-orbit.cmd -NoCache | Force a rebuild without cache. |
| ./.scripts/orbit-status.cmd | Shows the status of Compose. |
| ./.scripts/orbit-logs.cmd | Follow service logs. |

!!! warning "Effect of restart-orbit"

    A restart with build runs the entire build phase of the
    image. That phase installs dependencies, runs the test suites, and
    compile the frontend; Therefore it can produce many output messages and
    take longer than a simple reboot. Use -SkipBuild only when the
    image already contains the code you want to run.

## Installation verification

1. Open the published local URL.
2. Verify that the project or space welcome screen appears
   of work.
3. Run ./.scripts/orbit-status.cmd and confirm the healthy status.
4. In Orbit, wait for the Startup status to publish `projectReady: true` before
   using New/Open/Import project. A first uncached start can take longer; later
   starts normally validate the persisted cache locally and finish sooner.
5. If the viewer does not appear, inspect the logs first and then the
   WebGL availability indicated in [Requirements](requirements.md).

## Optional precision setting

The installation does not download EOP or UTC–TAI tables during execution. For
mount that data reproducibly, place the snapshots under
config/eop/, define your internal routes and restart the service. Consult
[Operation timing and EOP](../operations/time-eop.md) before activating the
strict mode.

Continue with [quick start](quick-start.md).
