# Ground Segment

This area covers ground stations, their RF configuration, AOS/LOS passes and the operational formats that Orbit exchanges.

## Areas

- [Stations and RF](../user-guide/ground-stations.md): station creation, antennas, masks and link budget.
- [Passes and visibility](../analysis/events.md): AOS/LOS windows, elevation and access visualisation.
- [Ground-station formats](../formats/ground-stations/index.md): GeoJSON, Orbit JSON, CSV, RINEX and CPF.
- [Terrain and site](../formats/terrain/index.md): world terrain and local sources.
- [Tracking and orbit determination](../analysis/tracking.md): the future measurements, tracking and OD chain.
- [Ground-station API](../integrations/rest-api/ground-stations.md): the integration contract for stations and passes.

Derived pass results are not part of a station's persisted configuration; they are recalculated for the selected time window and satellite.
