# Orbital formats

[Home](../../index.md) · [Formats](../index.md)

## Overview

These formats describe an orbital object, its elements, or its ephemeris.
Orbit separates operational catalogue ingestion, internal Python readers, and
local viewer tracks.

| Group | Formats | Current contract |
| --- | --- | --- |
| Elements | [TLE](../tle.md), [OMM](../omm.md), [OPM](../opm.md) | TLE and OMM with embedded TLE feed the catalogue; OPM is unavailable. |
| Ephemerides | [OEM](../oem.md), [SP3](../sp3.md), [CPF](../cpf.md) | OEM can be viewed locally and OEM/SP3 have Python readers; CPF is unavailable. |

## Consumption routes

- The catalogue uses TLE and OMM containing both TLE lines.
- The viewer can load a tabulated OEM as a temporary local track.
- Python OEM and SP3 readers are not registered in `OrbitRuntime` or exposed
  as public UI/API ingestion.

See [ephemerides and interpolation](../../orbit-service.md) for tabular
provider contracts.
