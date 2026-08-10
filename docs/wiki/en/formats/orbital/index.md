# Orbital formats

[Home](../../index.md) · [Formats](../index.md)

## Overview

These formats describe an orbital object, its elements, or its ephemeris.
Orbit separates operational catalogue ingestion, internal Python readers, and
local viewer tracks.

| Group | Formats | Current contract |
| --- | --- | --- |
| Elements | [TLE](../tle.md), [OMM](../omm.md), [OPM](../opm.md) | TLE and OMM with embedded TLE feed the catalogue; OPM is unavailable. |
| Ephemerides | [OEM](../oem.md), [SP3](../sp3.md), [CPF](../cpf.md) | OEM can be viewed locally; SP3 with optional CLK imports as a durable precise GNSS product; CPF is unavailable. |

## Consumption routes

- The catalogue uses TLE and OMM containing both TLE lines.
- The viewer can load a tabulated OEM as a temporary local track.
- OEM remains a transient local track and is not registered in `OrbitRuntime`.
- SP3 registers per satellite as a tabulated runtime source through local
  [precise GNSS product](../precise-products.md) import. Optional RINEX CLK
  retains clock data, not a second trajectory.

See [ephemerides and interpolation](../../orbit-service.md) for tabular
provider contracts.
