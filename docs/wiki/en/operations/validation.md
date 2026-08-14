# Validation

[Start](../index.md) · [Operation](index.md) · [Installation](../getting-started/installation.md) · [Settings](configuration.md) · [Time and EOP](time-eop.md)

Orbit validation combines a runtime healthcheck, automated testing
by layer and validation of input contracts. A status check
healthy confirms that the service is responsive; does not in itself certify the
accuracy of an anniversary or the suitability of the source data.

## Service healthcheck

The container exposes an HTTP healthcheck against the gateway's /health path.
After a boot or reboot, check the status:

~~~powershell
docker compose ps
./.scripts/orbit-status.cmd
~~~

The expected state is healthy. If not reached within the waiting time of the
reboot script, check the logs:

~~~powershell
docker compose logs -f orbit
./.scripts/orbit-logs.cmd
~~~

`healthy` is **liveness**: the gateway and application can respond. It is not
**readiness** and deliberately does not wait for background IERS C01 or NGA
gravity-cache work. An automatic cache may still be loading, stale, or
unavailable after startup. Check Built-In Test and the startup panel before
enabling a dependent operation; a healthcheck alone is neither a precision nor
a force-model certificate.

## Startup readiness and progress

The authoritative startup record is the `startup` component returned by
`GET /api/system/diagnostics`. Its `ready` and `projectReady` booleans become
true only after the service has explicitly completed the required validation
steps. `readiness` makes the gate inspectable instead of treating any terminal
or warning state as usable:

| Field | Meaning |
| --- | --- |
| `readiness.state` | `pending`, `ready`, `degraded-ready`, or `blocked`. Gated work requires the explicit `ready`/`projectReady` boolean. |
| `readiness.requiredSteps` | The checks required by this startup; do not infer them from a fixed UI sequence. |
| `readiness.blockers` | Each unfinished or failed requirement with its identifier, status, and operator-facing message. |
| `readiness.degradations` | Completed but non-blocking degradations, such as the explicitly labelled nominal-Earth-rotation path when ERP is unavailable. |
| `details.progress` | Startup phase, active gravity model, completed/total model count, and per-model download/validation facts. |

`details.progress.percent` is shown as 0–100 only when the server knows the
total size. If the upstream response has no trustworthy `Content-Length`, it
is `null` and the UI presents an indeterminate download rather than inventing a
percentage. Per-model entries report their state/stage, downloaded and total
bytes when known, last update, and message. The progress states are `pending`,
`downloading`, `validating`, `ready`, and `error`.

### First start, cached start, and gated actions

On a first start without valid local NGA files, downloading and validating the
gravity archives can take noticeably longer. The startup panel exposes the
current model and progress while this happens. Later starts normally validate
the persistent cache locally and are much faster; a missing, corrupt, or stale
entry may still trigger a controlled refresh.

If an NGA failure blocks startup, Orbit retries the background operation up to
five times with backoffs of 30, 60, 120, 240, and 300 seconds. It neither
restarts the container nor makes `/health` fail just because that work is
pending. After those attempts, the error remains visible and monitoring returns
to its normal interval. A later successful download and validation moves the
same runtime from the visible error/blocker to `ready` (or `degraded-ready`
when a separately non-blocking degradation remains); no manual retry promise
should be inferred from this policy.

Until `ready`/`projectReady` is explicitly true, Orbit keeps the scene, Startup
panel, and Built-In Test available but gates actions that would create, replace,
or restore project state. The project control does not enable **New project**
or **Open/Import project**. Forced manual-orbit preview/creation and orbit-
parameter calculations are rejected by the service with HTTP 503 and the
published readiness reason. Do not bypass this gate by calling an endpoint or
retrying blindly: resolve the reported blocker or wait for validation.

`Warning`, `healthy`, or a completed-looking progress bar is not enough by
itself. The application enables those actions only from the explicit readiness
booleans. `degraded-ready` can have those booleans true after all blocking
checks pass, but retains the visible degradation and does not certify a strict
ERP/ECI route. `blocked` remains a visible operator action, not a hidden
fallback.

## Automated suites

The repository separates tests by responsibility.

| Script | Executed coverage |
| --- | --- |
| ./.scripts/test-node.cmd | Node.js gateway unit tests. |
| ./.scripts/test-frontend.cmd | Unit tests of front/ modules. |
| ./.scripts/test-react-build.cmd | React frontend build and runtime asset validation. |
| ./.scripts/test-backend.cmd | Python tests under server/python/ within Docker. |
| ./.scripts/test-ui.cmd | Runtime restart and browser tests. |
| ./.scripts/test-all.cmd | Orderly execution of frontend, backend and integration. |

The Docker image also runs the Node, frontend and Python suites before
to compile the final frontend. A failure of these tests prevents it from being completed
the build of the image.

!!! note "Scope of a suite"

    A suite that terminates successfully demonstrates the contracts covered by
    their cases. It does not imply independent validation of a TLE source,
    OEM, C04 or leap-seconds.list that the operator has subsequently mounted.

## Operation data validation

| Data | Applied validation |
| --- | --- |
| System Settings | Normalization of values ​​and catalog name contained within config/. |
| Project | The importer requires the orbit-project format and version 1. |
| Catalog | TLE, OMM and OEM formats are analyzed before being incorporated; Pure OEM does not become a catalog object. |
| Precise GNSS product | Required SP3; per-field CLK, ERP, SUM, ATT, and OSB; extensions, checksums, frame, time scale, and duplicate epochs are validated. Provider and class are derived from the SP3. `require_eci` is an internal guard for a future comparison, not an import control. The manifest is verified again at startup. |
| local C04 | Reading, encoding, temporal order, MJD/date consistency, columns and hashing are validated if required. |
| leap-seconds.list | Identity, coverage and, when configured, #@ expiration are validated. |
| EOP Window | In strict mode, the declared limits must be covered by C04 and UTC–TAI. |

C04 policy requires IAU 2000A product with dX/dY; a header that
declares dPsi/dEps is rejected. See [Time and EOP](time-eop.md) for the
hash configuration and coverage.

## Validation before a reproducible operation

1. Keep the source file and SHA-256 for every TLE, OMM, OEM, or GNSS SP3/CLK/ERP/SUM/ATT/OSB product.
2. Run the appropriate suite after updating code or configuration.
3. Check the healthcheck and the logs of the runtime started.
4. Record time range, step, propagator, frame and scale of any
   exported anniversary.
5. Register the version and SHA-256 of C04 and leap-seconds.list when intervening
   a precision terrestrial transformation.

## Limits

- There is no certification of mission accuracy, validation of
  orbit determination or automatic comparison against a truth of
  external reference.
- AOS/LOS station detection scans by sampling. It bisects already bracketed
  visibility changes to approximately 0.5 s, but it is not a general
  root solver and does not guarantee finding a full pass between two
  discovery samples.
- Visual mode without local EOP snapshots is still approximate although the
  service pass the healthcheck.
- There is no hosted CI or exposed standard compliance report
  for the product.

Presentation and cost controls are described in
[Performance](performance.md).
