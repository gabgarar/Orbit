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
| local C04 | Reading, encoding, temporal order, MJD/date consistency, columns and hashing are validated if required. |
| leap-seconds.list | Identity, coverage and, when configured, #@ expiration are validated. |
| EOP Window | In strict mode, the declared limits must be covered by C04 and UTC–TAI. |

C04 policy requires IAU 2000A product with dX/dY; a header that
declares dPsi/dEps is rejected. See [Time and EOP](time-eop.md) for the
hash configuration and coverage.

## Validation before a reproducible operation

1. Keep the source file for each TLE, OMM, or OEM.
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
- AOS/LOS detection of stations is based on sampling, not searching.
  High precision roots.
- Visual mode without local EOP snapshots is still approximate although the
  service pass the healthcheck.
- There is no hosted CI or exposed standard compliance report
  for the product.

Presentation and cost controls are described in
[Performance](performance.md).