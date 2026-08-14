# Testing

## Objective

Orbit separately verifies the gateway, interface modules,
React build, Python backend, and frontend running in a browser.
Testing is not a substitute for scientific validation of a mission product:
They validate the implemented contracts, their limits and their known regressions.

## Testing matrix

| Layer | Location | Tool | Main command |
| --- | --- | --- | --- |
| Gateway Node.js | `server/tests/node/` | `node --test` | `npm run test:node --prefix server` |
| Legacy frontend modules | `front/tests/unit/` | `node --test` | `npm run test:frontend --prefix server` |
| Build React/Vite | `react-ui/` | Vite and validation of local assets | `npm run test:react-build --prefix server` |
| Python Backend | `server/python/tests/` | `pytest` | `npm run test:backend --prefix server` or Docker Windows script. |
| Browser interface | `tests/ui/` | Playwright | `npm run test:integration --prefix server` with Orbit now healthy. |
| Public-product integration | `server/python/tests/integration/` | `pytest` with a validated cache | `./.scripts/test-real-data.ps1 -Download` (explicit). |
| Real-data performance | Tests marked `performance` | `pytest` and a monotonic clock | `./.scripts/test-real-data.ps1 -Download -Performance` (explicit). |

Python tests cover FastAPI routes, requests, runtime, propagators,
stations, caches, OEM/SP3 formats, frames, implementations, EOP and scales
time. The Node tests cover the gateway, repositories, catalog, proxy and
deployment contracts. The existence of evidence does not imply total coverage or
an orbital precision certification.

## Unit, integration, and performance tests

The normal suite consists of unit and contract tests with local synthetic or
versioned fixtures. It covers, among other things, Kepler invariants,
high-eccentricity Kepler solving, central gravity and harmonics, third bodies,
SRP, Hermite continuity, time scales, ERP/EOP, frame transformations, SP3/OEM,
and Master Time Range. It does not open a network connection, which is why it
is the evidence required on every `push` and `pull request`.

Integration tests with real products are a second, opt-in layer. They verify
the end-to-end contract of a public SP3+ERP bundle: provenance, the applicable
hash or content validation, time coverage, SP3 parsing, interpolation, and the
transformations implemented by Orbit. The cache is stored under
`data/test-real-data/` and is not versioned. A corrupt or incomplete artifact
is rejected and does not count as a valid run.

The current immutable bundle is the 2025-131 CODE MGEX pair (SP3 and ERP), with
SHA-256 pinned for the compressed bytes. Orbit first looks for the equivalent
pair in `../SP3`; if it is missing, `-Download` retrieves it over HTTPS from
the allowed CODE host, validates it, and atomically publishes it in the cache.
`-IncludeIers` adds IERS C01 as a separate probe: its `latestVersion` endpoint
is mutable, so format, bounds, and a locally recorded SHA-256 are validated,
but it is not presented as a source-pinned reproducible snapshot.

Performance measurements are opt-in too. They report time observed on the host
that runs them and can apply an explicit budget via
`ORBIT_REAL_DATA_PERF_MAX_SECONDS`; they are not a promise that every CPU,
hosted runner, GPU, or mission configuration will achieve the same number.

The suite does not pretend that unavailable external evidence exists: it does
not call STK or GMAT, does not download or validate JPL DE430, and does not
claim MSISE-00 or NRLMSISE-00 support until those models are implemented. When
an optional capability is unavailable — for example a local EGM2008
2190×2190 field — the result is reported as `skipped` with its reason, not as a
scientific success.

## Running on Windows

The `.cmd` and `.ps1` scripts centralize the reproducible route with Docker:

```powershell
.\.scripts\test-node.cmd
.\.scripts\test-frontend.cmd
.\.scripts\test-react-build.cmd
.\.scripts\test-backend.cmd
.\.scripts\test-ui.cmd
.\.scripts\test-all.cmd
```

`test-backend` restarts Orbit and runs `pytest` inside the container.
`test-ui` restarts and waits for the healthcheck before launching Playwright. The
`test-all` sequence is Node, legacy frontend, build React, Python backend
and UI.

Public-data validation is not run by `test-all`, because a network download
must not make the daily test path non-deterministic. Run it deliberately when
the additional evidence is needed:

```powershell
# Uses a local SP3 in ../SP3 first when present; otherwise downloads the
# permitted public bundle, validates it, and stores it in data/test-real-data/.
.\.scripts\test-real-data.ps1 -Download

# Adds performance measurements using the same validated bundle.
.\.scripts\test-real-data.ps1 -Download -Performance

# Optional: validates and records mutable C01; it does not turn it into a
# source-hash-pinned mission reference.
.\.scripts\test-real-data.ps1 -Download -IncludeIers

# Example of a machine-specific budget in seconds.
$env:ORBIT_REAL_DATA_PERF_MAX_SECONDS = "5"
.\.scripts\test-real-data.ps1 -Download -Performance
```

`ORBIT_RUN_REAL_DATA=1` enables this layer; `ORBIT_DOWNLOAD_REAL_DATA=1`
permits a download when the cache is empty. Without these variables, real-data
tests deliberately skip and state the missing capability. `ORBIT_REAL_DATA_DIR`
forces a local source and `ORBIT_REAL_DATA_CACHE` changes the persistent cache
location.

## Running from npm

From the root of the repository:

```bash
npm run test:node --prefix server
npm run test:frontend --prefix server
npm run test:react-build --prefix server
npm run test:backend --prefix server
npm run test:integration --prefix server
```

`npm run test:backend --prefix server` uses `python3` and requires an environment with
`server/requirements.txt` dependencies. The equivalent Windows script
uses Docker to run the same test tree on the Orbit image.

## Static audit

The code audit finds unused imports, variables, exports, and files before code
is removed. It runs Knip for Node, React, and the legacy runtime; ESLint for
JavaScript; and Ruff/Vulture for the Python backend:

```powershell
.\.scripts\audit-code.ps1
```

On the first run, install the Python tools in the virtual environment:

```powershell
.\.venv\Scripts\python.exe -m pip install -r server\requirements-dev.txt
```

These tools provide review signals; they do not by themselves authorize removal
of an API, since an export may be consumed by another layer or be a documented
contract.

## Continuous integration

GitHub Actions applies three reproducible gates:

| Workflow | Trigger | Evidence produced |
| --- | --- | --- |
| `quality.yml` (**Orbit quality**) | Every `push` and `pull request`. | Node and frontend tests (including MTR), React build, ITRF/ECI, EOP/ERP, SP3/OEM, interpolation, propagator and force-model contracts; complete Python suite; Knip/ESLint/Ruff/Vulture audit; strict MkDocs build. |
| `docs-pages.yml` (**Deploy documentation**) | Documentation pull requests and pushes to `main`. | Builds both translations with `mkdocs build --strict`, checks the generated entry pages, and publishes GitHub Pages only after a push to `main`. |
| `release.yml` (**Release Orbit**) | `vMAJOR.MINOR.PATCH` tags and releases created from a valid tag. | Orbit Tracker build, reproducible archive, and `SHA256SUMS.txt` verified before it is attached to the release. |
| `real-data.yml` (**Orbit real-data validation**) | `workflow_dispatch` only; manually started. | Restores or downloads the public SP3/ERP bundle, validates its contents and runs integration; the `performance` input enables the performance measurement. |

The workflows use GitHub Actions npm, pip, or public-data caches. Browser tests remain a
separate operational step because they need a healthy Docker instance; they
are not represented as a remote check that can run without that service.

Documentation validation is local and deterministic: navigation, pages,
Markdown links, and anchors become errors through `--strict`. CI does not
probe external URLs because their availability is not controlled by the
repository and would make the build non-reproducible.

`quality.yml` explicitly sets the real-data and performance variables to `0`.
Consequently, a push or PR cannot accidentally trigger an external download;
the public-product cache is used only by the manual workflow, where every item
is validated before use.

## Interface tests

Playwright uses by default `http://127.0.0.1:8100`, one worker and a timeout of
60 seconds per test. You can change the target instance using
`ORBIT_UI_BASE_URL`. The suite is serial because its project and catalogue
flows share persistent state.

```powershell
$env:ORBIT_UI_BASE_URL = "http://127.0.0.1:18100"
npm run test:ui --prefix server
```

The results are saved in `tests/artifacts/ui-results/`; the HTML report is
generated in `tests/artifacts/ui-report/`. Captures and traces are retained
fail a test.

## Validation during Docker image

The `Dockerfile` installs Node and Python dependencies, runs Node tests,
frontend and Python, and then build the React distribution. The tests of
browser are not part of that build phase: they require an Orbit instance
healthy and are run by Playwright separately.

## Test selection by change

| Change | Minimum verification |
| --- | --- |
| Express, proxy or catalog routes | `test:node` and catalog/proxy specific tests. |
| Pydantic model, propagator, format, frames or time | `pytest server/python/tests` and contract tests affected. |
| SP3/ERP parser, data cache, or integration-contract change | Offline suite plus `test-real-data.ps1 -Download`; add `-Performance` only when cost is affected. |
| React, Vite, Cesium or assets runtime | `test:react-build`, frontend tests and, if visible interaction changes, UI. |
| Docker, Compose or operation scripts | Deployment contract testing, Docker build and healthcheck. |
| Transverse change | `test-all` plus a review of the affected REST/WebSocket contracts. |

## Automation limits

CI blocks integration when a declared test or build fails, but it is not a
mission-precision certification and does not replace scientific review of
data, frames, time scales, or force models. No coverage metric, coverage
threshold, or supported-browser matrix is published yet; none should be
inferred from the existing commands.

`release.yml` does not create a version for every commit: it packages and
publishes only when a tag has SemVer form `vMAJOR.MINOR.PATCH` (with optional
SemVer metadata). Before creating a tag, verify that **Orbit quality** is
green for the exact commit that will be tagged.

## Good practices

1. Reproduce a failure with the smallest piece of evidence that expresses it.
2. Add a limit test when modifying validation, samples,
   timing or cache transformations.
3. Avoid fixtures that hide a frame, a time scale or units.
4. Run the React build when modifying assets that must be offline.
5. Review Playwright artifacts before accepting a visual change.

## Related references

- [Validation](validation.md)
- [Contribute](contributing.md)
- [Deployment](deployment.md)
