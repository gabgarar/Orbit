# Configuration

[Start](../index.md) · [Operation](index.md) · [Performance](performance.md) · [Time and EOP](time-eop.md)

Orbit preserves application settings and editable catalog within
config/. In the standard Compose deployment, that path is mounted to the container
such as /app/config so that it survives a re-image.

## Configuration file

The main file is config/system_config.json. Its public form groups
values under system and data.

~~~json
{
  "system": {
    "orbit": {},
    "satellites": {},
    "realtime": {},
    "logging": {},
    "rendering": {},
    "recording": {},
    "ui": {}
  },
  "data": {
    "satellites_catalog_file": "catalog.json"
  }
}
~~~

The interface loads this file and saves changes through the internal path
/api/system-config. The runtime also accepts several historical flat keys
when normalizing the configuration, but new configurations must use the
grouped form.

## Interface sections

| Section | Exposed parameters |
| --- | --- |
| Orbits | Propagation horizon, future trace, soil track, width and colors. |
| Satellites | Labels, model scale, 3D model usage, size mode and perigee alert. |
| Real time | Status and orbit update intervals. |
| Logs | Activation, level and visibility of the top clock. |
| Rendering | Antialiasing, background, atmosphere, lighting, stars and basemap. |
| Recording | Quality and format requested for MediaRecorder. |
| Interface | Language and theme. |

Selectable rendering values include antialiasing off, fxaa and
msaa; and the Natural Earth local, Earth 2 km local, OpenStreetMap, and World maps
Esri Imagery.

## Persistent catalog

The data.satellites_catalog_file field indicates the name of the catalog file
inside config/. The backend normalizes the name to prevent routes outside of
that directory and rejects Windows reserved names, path separators,
control characters and system_config.json.

!!! warning "Manual editing"

    Keep valid JSON and backup before editing
    config/system_config.json outside the interface. An unreadable file makes
    have the backend use safe default values for the configuration that
    can load, and can hide the operational error until the logs are reviewed.

## Execution variables

| Variable | Effect |
| --- | --- |
| ORBIT_HTTP_PORT | Published port on the host; does not change the internal port 8100. |
| ORBIT_HTTP_BIND | Listening interface. The default value of 127.0.0.1 maintains local access. |
| PYTHON_BACKEND_URL | Internal URL used by the gateway for the Python backend. |
| ORBIT_EOP_* | Policy and origin of the local C04 snapshot. |
| ORBIT_LEAP_SECONDS_* | Local UTC–TAI table policy. |
| ORBIT_TERRESTRIAL_REALIZATION | Explicitly chosen output ground realization. |

Temporary and implementation variables do not belong in the interface JSON.
They are injected into Compose when starting the process; your contract is documented in
[Time and EOP](time-eop.md).

## Application of changes

Interface changes are persisted to the configuration file. The
changes that affect the image, the published port, EOP data, variables
environment or dependencies require recreating or restarting the runtime. In
Windows, use:

~~~powershell
./.scripts/restart-orbit.cmd
~~~

To reboot without rebuilding the current image:

~~~powershell
./.scripts/restart-orbit.cmd -SkipBuild
~~~

Do not use a reset to replace an unupdated precision policy
also the hashes and versions of the local files; consult
[Time and EOP](time-eop.md).