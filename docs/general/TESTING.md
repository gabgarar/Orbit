# Testing architecture

Orbit uses four independent test layers. Keep a test in the lowest layer that
can prove its behaviour; this keeps feedback fast and failures easy to locate.

| Layer | Location | Scope | Command |
| --- | --- | --- | --- |
| Node gateway unit | `server/tests/node` | Catalog/configuration/proxy runtime modules | `./.scripts/test-node.cmd` |
| Frontend unit | `front/tests/unit` | Pure browser-side JavaScript | `./.scripts/test-frontend.cmd` |
| React build | `react-ui/` | Production bundle and legacy Cesium runtime parsing | `./.scripts/test-react-build.cmd` |
| Backend unit | `server/python/tests` | Python domains, services, and infrastructure, inside Docker | `./.scripts/test-backend.cmd` |
| Integration UI | `tests/ui` | Docker, HTTP API, browser layout, and user flows | `./.scripts/test-ui.cmd` |
| Full suite | all layers | Complete regression check | `./.scripts/test-all.cmd` |

The frontend unit suite does not start Docker. Backend and integration suites
run against the Docker image, so they rebuild and restart Orbit before testing.
`test-all` runs gateway, frontend, and React build checks first, then backend, and finally browser integration.
Each child script runs in an isolated PowerShell process, so its `exit` code
stops the suite at the failing layer without terminating the parent runner
before the remaining layers are reached.
`restart-orbit` builds the replacement image before stopping the current
container, so a failed build leaves the running application available. Its
normal build uses Docker cache; use `-SkipBuild` for an operational restart or
`-NoCache` only when a clean rebuild is necessary.
The Docker image build itself also runs gateway, pure frontend, and Python unit
tests before emitting the production React bundle.

## Conventions

- Frontend tests use Node's native test runner and must avoid Cesium/WebGL.
- Gateway tests use Node's native test runner, inject dependencies, and must not
  require a running Python process or remote catalog access.
- Backend tests use `pytest` and test `orbit_api` modules directly.
- `server/python/tests` mirrors the backend architecture: `api/routes`,
  `application`, `bootstrap`, `catalog`, `communications`, `core`, `domain`,
  `ground_stations`, `infrastructure`, and `orbits/propagators/sgp4`. Add a
  test beside the matching domain rather than creating a generic test file.
- `test_module_contracts.py` imports every Python module below `orbit_api`; a
  new module that cannot be imported fails the backend suite immediately.
- Browser tests use Playwright and may validate viewport, zoom, and complete
  interactions. The integration runner makes the server package dependencies
  available to the root-level UI specs on Windows and Linux, so use
  `npm run test:integration -- --list` from `server/` to validate discovery
  without needing a running browser application.
- Docker-facing scripts resolve `ORBIT_HTTP_PORT` once (default `8100`) and
  `ORBIT_HTTP_BIND` once (default `127.0.0.1`). They pass the resulting local
  URL to the health check and Playwright. Set `ORBIT_HTTP_BIND=0.0.0.0` only
  when the service must be deliberately exposed on the network; the container
  itself always listens on `8100`.
- Test names describe behaviour, not implementation details.
