# Configuration

[Start](../index.md) · [Operation](index.md) · [Performance](performance.md) · [Time and EOP](time-eop.md)

Orbit preserves application settings, the editable catalogue, and imported
precise GNSS products within config/. In the standard Compose deployment, that
path is mounted to the container as /app/config so that it survives an image
recreation.

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

## Persistent precise GNSS products

Each GNSS import, with required SP3 and associated CLK/ERP/SUM/ATT/OSB when
supplied, is stored under `config/precise-products/<product_id>/`. The directory contains decompressed
logical sources and a `manifest.json` with provider, class, original name,
compression, ZIP member where applicable, and SHA-256 checksums. The runtime
verifies checksums and parses sources again at startup; a corrupt entry is
reported as a diagnostic and must not be replaced manually while the service is
running.

Include `config/precise-products/` in the instance backup. A project can
contain stable references to these products, but does not include the source
files themselves. If a project is restored without its product directory, the
layer cannot be rehydrated.

See [Precise GNSS products](../formats/precise-products.md) for the import and
provenance contract.

## Execution variables

| Variable | Effect |
| --- | --- |
| ORBIT_HTTP_PORT | Published port on the host; does not change the internal port 8100. |
| ORBIT_HTTP_BIND | Listening interface. The default value of 127.0.0.1 maintains local access. |
| PYTHON_BACKEND_URL | Internal URL used by the gateway for the Python backend. |
| ORBIT_PYTHON_STARTUP_TIMEOUT_MS | Python-backend startup budget: `180000` ms by default; only integer values from `10000` to `600000` are accepted. Leave enough time to rehydrate strict local GNSS products (SP3/ERP) before the service is declared available. |
| ORBIT_EOP_* | Policy and origin of the local C04 snapshot. |
| ORBIT_EOP_C01_CACHE_PATH | Mutable automatic C01 cache; defaults to `/app/data/erp/EOP_C01_IAU2000_1846-now.txt`. It is used only when `ORBIT_EOP_C04_PATH` is not configured. |
| ORBIT_LEAP_SECONDS_* | Local UTC–TAI table policy. |
| ORBIT_DIAGNOSTICS_MONITOR_INTERVAL_SECONDS | Health-monitor interval; defaults to `21600` (6 h), accepted from 30 s to 24 h. |
| ORBIT_GITHUB_ACTIONS_MONITOR | `true` enables a bounded public token-free query of recent workflows for Built-In Test; defaults to `false`. |
| ORBIT_GITHUB_REPOSITORY | Public `owner/repository` queried by the CI monitor; defaults to `gabgarar/Orbit`. |
| ORBIT_GRAVITY_CACHE_DIR | Persistent automatic NGA cache directory; defaults to `data/geopotential` (`/app/data/geopotential` in the standard container). |
| ORBIT_GRAVITY_MODEL | Automatic model selection: `EGM96` or `EGM2008`; defaults to `EGM2008`. |
| ORBIT_GRAVITY_REFRESH_DAYS | Age at which the monitor refreshes the automatic cache; defaults to `30`, allowed range `1`–`3650`. |
| ORBIT_GRAVITY_AUTO_DOWNLOAD | Enables the background official-NGA refresh; defaults to `true`. Set `false` to use validated local cache files only. |
| ORBIT_GRAVITY_DOWNLOAD_TIMEOUT_SECONDS | Bounded automatic download timeout; defaults to `45` seconds. |
| ORBIT_GRAVITY_FIELD_PATH | Optional in-container path to an explicit static ICGEM `.gfc` field. It has priority over the automatic cache. |
| ORBIT_GRAVITY_FIELD_SHA256 | Mandatory SHA-256 when an explicit ICGEM field is configured; startup fails on mismatch. |
| ORBIT_GRAVITY_FIELD_SOURCE | Optional human/published provenance of the explicit ICGEM field; otherwise controlled local provenance is derived. |
| ORBIT_GRAVITY_FIELD_VERSION | Optional publication version or identifier of the explicit ICGEM field; otherwise header `modelname` is used. |
| ORBIT_TERRESTRIAL_REALIZATION | Output terrestrial realization; Compose defaults to `ITRF2020`. |
| ORBIT_ENABLE_IGS20_FAMILY_ITRF2020_ALIGNMENT | Enables, together with `ORBIT_TERRESTRIAL_REALIZATION=ITRF2020`, the published IGS20/IGb20/IGc20→ITRF2020 operation for satellite-orbit states; Compose defaults to `true`. |

The family policy retains the source realization and does not correct stations
or antennas. Set it to `false` to disable it. Do not enable it with the legacy exact
`ORBIT_ENABLE_IGS20_ITRF2020_ALIGNMENT` variable; the two policies are
mutually exclusive. See [Realizations and visual mode](time-eop/realizations.md)
before enabling it.

Temporary and implementation variables do not belong in the interface JSON.
They are injected into Compose when starting the process; your contract is documented in
[Time and EOP](time-eop.md).

### Automatic NGA cache and explicit local field

Without `ORBIT_GRAVITY_FIELD_PATH`, `geopotential` can use the automatic NGA
registry. After FastAPI is healthy, the monitor validates the local
`ORBIT_GRAVITY_CACHE_DIR` copy and, when enabled, refreshes a missing or stale
entry from the fixed official EGM96/EGM2008 URL. The cache is not a startup
dependency and is never downloaded during a propagation stage. Keep this
directory on the persistent `./data` volume.

On a cold cache, this asynchronous work can make the first usable startup
longer than a later cached start. `/health` may already be healthy while the
NGA download and validation ledger is still pending. The application exposes
per-model download/validation progress through diagnostics and keeps project
actions gated until readiness is explicitly published. A valid persistent cache
avoids the network download on later starts, but is still revalidated locally.
If the upstream server does not disclose a reliable total size, progress is
indeterminate instead of reporting a fabricated percentage.

The registry validates the URL and redirect policy, ZIP size and paths, exact
coefficient member, coefficient continuity and plausibility, and SHA-256
before atomically activating a cache entry. A valid stale copy may be retained
with **Warning** if NGA cannot be reached. If no valid cache exists,
`geopotential` remains unavailable; it is not replaced with J2/J3/J4.

`ORBIT_GRAVITY_FIELD_PATH` remains the explicit reproducible alternative and
has priority over the automatic cache. It must name a static ICGEM `.gfc` field
with `fully_normalized` convention; header, coefficient completeness, and the
mandatory digest are validated. Mount its directory under `/app/config` or
another container-visible path and use that internal path. An explicit ICGEM
field is never overwritten or silently changed by the NGA monitor.

After the archive is unpacked and validated, Orbit derives and publishes its
`maxDegree`, `maxOrder`, and coverage profile; the UI uses those detected
values as its only effective limits. Before that validation they are `null`,
so the selector remains unavailable rather than guessing a cap. The EGM2008
archive is handled inside a protective/advisory 2190 × 2190 parser envelope,
but the actual validated coefficient file—not that envelope—controls what can
be selected.

Those source-derived limits are separate from the current Python RK4 guard of
2,555 non-central terms per stage. A selection whose materialisation exceeds
that guard is rejected; a complete mission-scale dense field remains a future
optimized-engine task.

For manual orbits, `geopotential` and `drag` consume the shared automatic IERS
C01 provider. With valid coverage they apply its EOP; without it they retain a
nominal Earth rotation labelled **Warning**, without requiring a manual ERP.
The EME2000↔ITRF route still needs the local leap-second table and ERFA/SOFA.
`ORBIT_EOP_STRICT=true` remains available for strict reproducible routes and
does not relax the fail-closed ECI policy for SP3 products.

`restart-orbit` waits for the configured budget, rounded up to seconds, plus
60 s for the gateway and healthcheck cadence. The default therefore waits up
to 240 s. If strict GNSS collection rehydration needs longer, set the variable
within its valid range and restart the runtime.

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
