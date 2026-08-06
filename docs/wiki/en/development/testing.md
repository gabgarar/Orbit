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

Python tests cover FastAPI routes, requests, runtime, propagators,
stations, caches, OEM/SP3 formats, frames, implementations, EOP and scales
time. The Node tests cover the gateway, repositories, catalog, proxy and
deployment contracts. The existence of evidence does not imply total coverage or
an orbital precision certification.

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

The **Verify Orbit** workflow runs for every push or pull request targeting
`main` or `develop`. It repeats the Node, frontend, and Python tests, builds
React, and runs the static audit. Browser tests remain a separate operational
step because they require a healthy Docker instance.

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
| React, Vite, Cesium or assets runtime | `test:react-build`, frontend tests and, if visible interaction changes, UI. |
| Docker, Compose or operation scripts | Deployment contract testing, Docker build and healthcheck. |
| Transverse change | `test-all` plus a review of the affected REST/WebSocket contracts. |

## Automation limitations

There is no continuous integration configuration declared in the repository
(e.g. no GitHub Actions workflows). Running tests and
The publication of results depends on the environment that maintains the instance.

No coverage metric, coverage threshold, or matrix is published
of supported browsers. They should not be inferred from existing commands.

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
