# Contribute

## Policy Status

The repository does not currently contain an `CONTRIBUTING` file, a template
of pull request, `CODEOWNERS` rules, a contribution agreement or automation
declared IQ. This page establishes the maintenance rules necessary for
that a change is reviewable within the existing architecture; does not create a
external publication process nor a guarantee of acceptance.

## Environment preparation

The recommended reproducible path is Docker Compose. For development without Docker,
the repository documents Node.js 24 and Python 3.10+ at least,
in addition to the dependencies set by the lockfiles and
`server/requirements.txt`.

```bash
docker compose up --build
```

The [Deployment](deployment.md) documentation describes ports, volume of
settings and exposure controls. [Testing](testing.md) documentation
describes local verification.

## Areas of change

| Area | Responsibility | Expected verification |
| --- | --- | --- |
| `react-ui/` | React/Vite composition and frontend components. | BuildReact; UI tests if the visible flow changes. |
| `front/` | Legacy Cesium runtime, assets and modules in migration. | Frontend testing; build/runtime assets where applicable. |
| `server/src/` | Gateway, catalogs, configuration and proxy. | Node tests. |
| `server/python/orbit_api/` | Orbital domain, API, frames, time and formats. | Pytest of the modified modules and route contracts. |
| `config/` | Example operational data or persisted configuration. | Verify format, mounted path and absence of secrets. |
| `docs/wiki/` | Publishable documentation and relative links. | Review links, limits and consistency with the code. |

Don't mix an interface refactoring with a physics or contract change
HTTP unless the relationship is necessary and is proven end-to-end.

## Orbital contract rules

1. Each state must preserve epoch, time scale, frame, center and units.
2. Do not enter `ECI` or `ECEF` as new labels: they are ambiguous and the
   contract `StateVector` rejects them.
3. SGP4 retains TEME as the native framework; two bodies and Cowell manuals use
   EME2000. A conversion to ITRF must go through `FrameTransformService`.
4. EOP and leap second data are loaded from local files to the
   start. Do not add a network download to a transformation or propagation.
5. If an output depends on a reference product, incorporate its identity
   to provenance and cache.
6. Do not advertise a format, force model or ground implementation as
   supported until you have a contract, tests and a usage path defined.

## Interface rules

- Maintain shape and boundary validation in `domain/requests.py` and the
  HTTP mapping in `api/routes/`.
- Keep input errors as explicit client errors (`400`,
  `422`, `404`) instead of turning them into silent failures.
- Document `camelCase` or legacy compatibility fields along with your
  canonical form; Don't delete one without a declared migration.
- Do not directly expose the Python port as an integration shortcut.
- Treat the WebSocket as snapshots with no delivery guarantee and update your
  documentation if you change encoding, frequency or semantics.

## Persistence and security rules

- The catalog and configuration are operator data. Do not overwrite them or
  reorder them massively as a side effect of a test or build.
- Respect file name normalization and directory limit
  `config/`.
- Do not incorporate secrets, provider tokens, user routes or snapshots
  EOP without its origin and operational policy.
- The absence of authentication requires special care: do not expand the exposure
  of administrative routes without infrastructure and documentation controls.

## Verification process

1. Inspect existing foreign modifications before editing and do not
   reverse them.
2. Add or update tests that reproduce the modified behavior.
3. Run the corresponding minimal layer and the traversal tests that
   affect the change.
4. Verify that the React build and offline assets are still valid if
   the interface or its packaging is touched.
5. Update documentation, limits and cross references.
6. Include in the change proposal what was verified and what could not be verified
   in the available environment.

## Documentation and language

The official documentation is written in Spanish, uses Markdown compatible
Material for MkDocs and links between pages using relative paths. must
describe only what can be verified in code, tests, or configuration
from the repository. Missing capabilities are documented as limits, not as
promises.

## Related references

- [Architecture](architecture.md)
- [Testing](testing.md)
- [Validation](validation.md)
- [Internal plugins](../integrations/plugins.md)