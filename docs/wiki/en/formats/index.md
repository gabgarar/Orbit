# Spatial formats

[Satellite](../satellite/index.md) · [Propagation](../propagation/index.md) · [Engineering foundations](../engineering/index.md)

The formats are documented by their effective product route. A Python reader
it is not equivalent to a function exposed by the interface, gateway, or public API.

## Format map

| Page | State |
| --- | --- |
| [Overview](overview.md) | Import, export matrix and internal reader. |
| [TLE](tle.md) | Catalog, validation and SGP4. |
| [WMO](omm.md) | JSON/XML catalog limited to embedded TLE elements. |
| [OEM](oem.md) | Segmented Python Reader; catalog import only if it contains TLE. |
| [SP3](sp3.md) | Native Python position/velocity reader. |
| [OPM](opm.md) | Not available. |
| [Unsupported formats](unsupported-formats.md) | Product limits and alternatives. |

!!! warning "Mandatory provenance"

    The OEM and SP3 ephemeris preserve the `REF_FRAME`/coordinate system,
    the realization and `TIME_SYSTEM` declared. Orbit does not relabel them as
    ITRF or UTC when reading them.

## Ground-segment formats

Station, terrain, observation and prediction contracts have their canonical
area in [Ground Segment](../ground-segment/index.md). See
[GeoJSON, Orbit JSON and CSV](ground-stations/index.md), as well as the
current RINEX and CPF status there.
