# Testing architecture

Orbit uses three independent test layers. Keep a test in the lowest layer that
can prove its behaviour; this keeps feedback fast and failures easy to locate.

| Layer | Location | Scope | Command |
| --- | --- | --- | --- |
| Frontend unit | `front/tests/unit` | Pure browser-side JavaScript | `./.scripts/test-frontend.cmd` |
| Backend unit | `server/python/tests` | Python domains, services, and infrastructure, inside Docker | `./.scripts/test-backend.cmd` |
| Integration UI | `tests/ui` | Docker, HTTP API, browser layout, and user flows | `./.scripts/test-ui.cmd` |
| Full suite | all layers | Complete regression check | `./.scripts/test-all.cmd` |

The frontend unit suite does not start Docker. Backend and integration suites
run against the Docker image, so they rebuild and restart Orbit before testing.
`test-all` runs frontend first, then backend, and finally browser integration.

## Conventions

- Frontend tests use Node's native test runner and must avoid Cesium/WebGL.
- Backend tests use `pytest` and test `orbit_api` modules directly.
- `server/python/tests` mirrors the backend architecture: `api/routes`,
  `application`, `bootstrap`, `catalog`, `communications`, `core`, `domain`,
  `ground_stations`, `infrastructure`, and `orbits/propagators/sgp4`. Add a
  test beside the matching domain rather than creating a generic test file.
- `test_module_contracts.py` imports every Python module below `orbit_api`; a
  new module that cannot be imported fails the backend suite immediately.
- Browser tests use Playwright and may validate viewport, zoom, and complete
  interactions.
- Test names describe behaviour, not implementation details.
