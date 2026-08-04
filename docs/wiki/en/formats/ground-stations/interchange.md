# External station interchange

[Home](../../index.md) · [Ground-station formats](index.md)

## Support status

Orbit does not implement station import or export through CSV, GeoJSON, KML,
SINEX, IGS site log, or another external standard. An external file is not
interpreted as a station layer.

!!! warning "Format planned for future implementation"

    An importer must declare CRS, horizontal and vertical datum, units,
    coordinate epoch, and the mapping of operational attributes. They must not
    be implicitly assigned to WGS-84 from column names.

## Current alternative

Create the station in the workspace and save the project JSON.
