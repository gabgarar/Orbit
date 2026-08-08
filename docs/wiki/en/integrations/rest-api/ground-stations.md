# REST API: ground stations

[Integrations](../index.md) · [REST API](../rest-api.md) · [Ground Stations](../../user-guide/ground-stations.md)

| Method and route | Operation | Requirements |
| --- | --- | --- |
| **GET /api/aos-los** | Calculates accesses from query parameters. | Satellite identifier, latitude and longitude; optional height, mask, interval, step, and mechanical limits. |
| **POST /api/aos-los** | Calculates accesses from a JSON body. | Catalogue/TLE **or** manual definition source, station, start/end time, and sampling step. |

## Orbital source

`GET /api/aos-los` retains the lightweight catalogue contract and requires
`sat_id`. `POST /api/aos-los` also accepts an explicit source in `source`:

| `source.kind` | Source fields | Use |
| --- | --- | --- |
| `catalog` | `sat_id` **or** `line1` + `line2` | Loaded catalogue or explicit TLE, propagated through SGP4. |
| `manual` | `manualOrbit` | Authored manual-orbit definition; it cannot include `sat_id` or TLE lines. |

The recommended form for a manual orbit is:

```json
{
  "source": {
    "kind": "manual",
    "manualOrbit": {
      "name": "Test orbit",
      "epoch": "2026-08-08T12:00:00Z",
      "propagator": "two-body",
      "definitionSource": "keplerian",
      "keplerian": {
        "referenceFrame": "EME2000",
        "timeScale": "UTC",
        "semiMajorAxisKm": 7000,
        "eccentricity": 0.001,
        "inclinationDeg": 98,
        "raanDeg": 20,
        "argumentOfPerigeeDeg": 30,
        "trueAnomalyDeg": 0
      }
    }
  },
  "station": { "lat_deg": 40.4168, "lon_deg": -3.7038 },
  "start_time": "2026-08-08T12:00:00Z",
  "end_time": "2026-08-09T12:00:00Z",
  "step_seconds": 20
}
```

`manualOrbit` is the same manual-creation contract: it retains the epoch,
representation, propagator, and force/integrator options. The AOS/LOS window
is not automatically taken from `manualOrbit.start_time` or `end_time`: the
top-level `start_time` and `end_time` fields are the interval analysed. A
client that wants to repeat a design preview must deliberately send the same
dates.

The manual source first propagates in its native `EME2000` dynamics frame, and
each position is transformed to `ITRF` for WGS-84/ENU geometry. The response
therefore retains `reference_frame: "ITRF"` and `time_scale: "UTC"`; it adds
`source.kind: "manual"`, the canonical propagator, and
`source.dynamics_reference_frame: "EME2000"`. The `satellite` field is only the authored
manual-definition name: the request neither registers an object in the
catalogue nor creates a NORAD/COSPAR identifier.

## Station contract

The **station** object contains geometry and operational limits:

| Field | Unit | Rule |
| --- | --- | --- |
| **lat_deg**, **lon_deg** | degrees | Latitude from −90 to 90; longitude from −180 to 180. |
| **height_m** | m | From −1,000 to 100,000. |
| **min_elevation_deg** | degrees | Elevation mask from 0 to 90. |
| **max_range_km** | km, optional | RF-envelope operational range gate supplied by the client; it is not a rendering property. |
| **mechanical_elevation_min_deg**, **mechanical_elevation_max_deg** | degrees | From 0 to 90; minimum cannot exceed maximum. |
| **mechanical_azimuth_min_deg**, **mechanical_azimuth_max_deg** | degrees | From −180 to 180; a range crossing north is valid. |
| **operation_mode** | tracking, scan, or stationary | `tracking` follows the target; `scan` describes potential access within the mount; `stationary` retains a fixed beam. |
| **boresight_azimuth_deg**, **boresight_elevation_deg** | degrees | Fixed beam direction. |
| **beam_half_angle_deg** | degrees, optional | Compatibility value for older clients; if HPBW is absent, it supplies the reference circular half-width. |
| **pattern_type** | gaussian or cosine | Continuous gain-falloff law for `stationary`. |
| **hpbw_azimuth_deg**, **hpbw_elevation_deg** | degrees, optional | Full half-power widths; the API uses the compatibility value when they are absent. |
| **side_lobe_level_db** | dB | Side-lobe loss floor for the simplified pattern. |

The API does not receive the complete RF chain from the designer or a remote RF profile. The client calculates the reciprocal planning envelope from the station RF contract and supplies its boresight operational range gate as **max_range_km**, separately from any scene rendering cap. In `stationary`, the API reduces that gate using continuous pattern gain in every direction; HPBW only reports the −3 dB contour. In `tracking`, pointing gain is applied. In `scan`, the result is potential coverage: no schedule, dwell time, or scan law yet confirms acquisition.

Consequently, this endpoint does not claim satellite SNR: real SNR requires effective EIRP, remote-terminal polarisation, and an entirely contained occupied signal: \(|\Delta f|+B_{\mathrm{signal}}/2\le B_{\mathrm{RX}}/2\). Those checks are performed by the client when a layer publishes a complete remote RF profile.

## Relationship to station interchange

Station import and export in
[GeoJSON, Orbit JSON, and CSV](../../formats/ground-stations/interchange.md)
are local application operations, not REST routes. They start from an authored
layer contract and neither serialise nor inject an <code>/api/aos-los</code>
response.

The files therefore contain no elevation samples, AOS/LOS, range, SNR, or
results dependent on a remote satellite. Those remain calculated API and client
RF-model results, with physical instants in UTC. After importing a station, the
client requests a new analysis when the operator chooses its satellite, instant,
and window.

## Output and visibility criterion

Each sample returns elevation and azimuth, plus `range_km`, `geometric_visible`, `rf_visible`, `operational_visible`, `pattern_loss_db`, and `directional_max_range_km`. A sample is visible when it passes the mask, mechanical limits, and submitted directional range gate. For a stationary station, `within_main_lobe` reports the HPBW −3 dB contour, but it is not a visibility wall: a direction outside that contour can retain pattern/side-lobe gain, although its operational range is smaller.

`include_samples` is optional and defaults to `true`. With `false`, the API evaluates the exact same internal sequence, retains `count` and `passes`, but returns `samples: []`. It is appropriate for next-pass cards that do not draw a curve. `chart_padding_seconds` is optional: `null` retains the historical full series; a non-negative number returns only samples inside each refined pass plus that margin at both ends. `returned_sample_count` and `sample_scope` distinguish the transmitted response from `count`, which always reports the number of evaluated states. AOS/LOS transforms only position to ITRF: it does not calculate velocity, rotation derivatives, or native states that the visibility criterion does not use.

The ephemeris is first computed at the requested step. When two consecutive samples change visibility, the API reevaluates the same propagator and ITRF geometry by bisection to bracket the AOS/LOS crossing to approximately 0.5 s. The step remains important: a complete pass between two samples may not be bracketed and published maximum elevation comes from profile samples. Response times are UTC; a station IANA time zone is a client presentation preference. See [Ground stations](../../user-guide/ground-stations.md) for the RF model, units, and interpretation limits.
