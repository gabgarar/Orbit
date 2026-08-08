# Project JSON

[Home](../../index.md) · [Ground-station formats](index.md)

## Current contract

Stations are serialised inside the project JSON document. The current contract uses **station_schema_version: 2** and retains geometry, entered RF configuration, and visual options. Derived metrics are recalculated when the project is restored; they must not be treated as an independent source of truth.

## Persisted fields

| Group | Example fields |
| --- | --- |
| Identity and geometry | Name, latitude, longitude, height, IANA `time_zone`, elevation mask. |
| Aperture | Diameter, efficiency, frequency, polarisation, gain mode, and optional overrides. |
| Pattern | Type, optional azimuth/elevation HPBW, and side-lobe level. |
| RF and noise | TX power, planning reference receiver, RX threshold, system temperature, bandwidth, required SNR, and atmospheric, rain, cable, and connector losses. |
| Pointing | Pointing RMS, mode, boresight, and mechanical azimuth/elevation limits. |
| Visualisation | Station and coverage visibility. |

Frequency can be retained in MHz and Hz for internal interoperability, but the model normalises one physical frequency. Power can be entered in dBm or W and is normalised to dBm for the budget. `time_zone` is an IANA presentation zone: charts and tables may display local time, while physical epochs, AOS/LOS, and CSV remain UTC.

Persisted HPBW values are full half-power widths. They do not turn the pattern into a binary gate: in `stationary` mode the Gaussian or `cos^n` pattern is evaluated continuously and HPBW only identifies the −3 dB contour. In `tracking`, the target is budgeted at pointing gain; in `scan`, the persisted field describes potential coverage until a schedule or scan law exists.

`coverage_visible` controls presentation only. The 2D footprint, mount-stop sector/annulus, 3D mesh, pattern sections, and discrete gain map are regenerated from the contract; they are not independent physical data and do not determine AOS/LOS by themselves. Range, footprint, and RF metric values that accompany an export are presentation caches and are recalculated on load.

## Relationship to GeoJSON

[GeoJSON](interchange.md) is an interchange projection of each station, not a
replacement for this document. It exposes a WGS-84 <code>Point</code> geometry
and a subset of identity/configuration; it preserves the authored RF contract
under <code>properties["orbit:rf"]</code> and presentation preferences under
<code>properties["orbit:visual"]</code>.

It does not carry the folder tree, other layers, time mode, selection state,
Cesium handles, derived meshes, ranges, <code>G/T</code>, SNR, or AOS/LOS
analysis. Export Project JSON for a complete, reopenable workspace copy; export
GeoJSON for QGIS or a GIS system.

## Scope

This JSON is an internal workspace format, not an interchange standard. The persisted envelope is reciprocal planning configuration; it does not replace a remote RF profile or certify SNR. Real SNR also requires effective EIRP, remote-terminal polarisation, and an occupied signal satisfying \(|\Delta f|+B_{\mathrm{signal}}/2\le B_{\mathrm{RX}}/2\). See [Ground stations](../../user-guide/ground-stations.md) for model equations, units, and limits.
