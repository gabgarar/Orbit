# Ephemerides inspector

[Home](../index.md) · [User guide](index.md) · [Timeline](timeline.md) · [Export](export.md)

The ephemerides inspector displays the samples and provenance that Orbit has
received or calculated for an orbital layer. It is an inspection surface: it
does not edit the simulation, silently convert one source format into another,
or reconstruct the original input file.

## Simulation range

The **Simulation range** section is read-only. In **Simulated** mode it shows
the active timeline start, end, and duration. Change the global range in the
[timeline](timeline.md), never in the inspector.

| Temporal state | Inspector behaviour | It does not |
| --- | --- | --- |
| Simulated with valid bounds | Shows the active UTC simulation range. | Expose date inputs or a control that applies the range. |
| Real time or Static | States that no finite simulation range is active; the runtime selects the applicable inspection window. | Reuse residual clock dates as an authored simulation domain. |
| Manual design | Uses design epochs only when no finite simulated range exists. | Change design epochs or the global clock. |

**Refresh** requests ephemerides again for the current context. A temporal
domain change (mode, start, or end) replaces the inspector request; moving the
playhead alone must not create a new series.

## Project propagation history

The **Information** tab retains a project audit table. Each row records the
target, source, propagator, UTC window, requested/effective cadence, declared
frames, summarized sample count, and terminal state: **running**,
**completed**, **cancelled**, or **error**. A request replaced, closed, or
cancelled from the task indicator remains recorded as cancelled; it does not
disappear with the live operation.

The history is intentionally separate from the task glyph: that glyph reads
the live ledger and shows only work that is currently executing. The table is
project metadata, is snapshotted immediately into the encrypted local library,
and travels with the `.orbit` document. It can be reviewed after reopening a
project even if its layer or source product is no longer available. To avoid
turning a project into an ephemerides cache, it stores neither sample series,
source files, nor raw backend responses. The latest **200 executions** are
retained per project.

The table does not delete or repropagate any result. To reproduce numerical
values, use **Refresh** with the currently available layer/resources, or
explicitly export the series from **Values** with its provenance.

## Source profile and availability

Each response publishes `source`, `availability`, `method`, `frame`,
`quality`, `forces`, `precision`, `cartesianColumns`, and `rows`. Missing facts
remain unavailable: the UI never fills them by guessing a format, propagator,
frame, or precision.

| Profile | Facts that can be declared | Important limit |
| --- | --- | --- |
| **TLE** | Available TLE identity/lines, SGP4, TEME state, and derived propagated elements. | It never presents a recalculated TLE as the received file. |
| **OMM** | Retained OMM fields and, when usable TLE elements exist, the method actually executed. | There is no independent analytical OMM propagator: the current compatible route uses SGP4 only when the import exposes usable TLE data. |
| **SP3** | Tabulated coverage, frame, time scale, centre/provider, product class/family, declared CLK summary, and published realization or quality. | It is not extrapolated outside coverage or labelled TLE/SGP4. |
| **OEM** | Tabulated-ephemeris metadata and samples when available. | An OEM without a verified adapter is not repropagated with SGP4 or given invented frame/time facts. |
| **State vector** | Received position, velocity, epoch, and frame; calculated elements are marked derived. | Current manual state-vector input accepts EME2000; `J2000`/`ECI` are migration aliases to EME2000, not distinct input frames. TEME, ITRF, and ECEF are rejected for manual vectors. |
| **Numeric** | Numeric columns actually returned, with their labels or units. | The current numerical engine is declared as Cowell/RK4 when used; values alone do not imply RK45, physical provenance, force model, or precision. |
| **Manual** | Design definition, propagator, forces, epoch, and frame actually used. | It is not attributed catalogue provenance or a fabricated export TLE. |

When `availability.available` is false, the inspector preserves the runtime
reason. An explicit unavailable section is preferable to a series produced
with a different engine or data set.
For tabular SP3 or OEM products, the backend must explicitly declare the
capability; a response with samples but without that declaration is displayed
as unavailable, not as an implicit conversion to TLE/SGP4.

### Native-frame defaults

| Input | Native frame preserved | Calculation/output note |
| --- | --- | --- |
| TLE / SGP4 | TEME | This is the SGP4 native state; derived osculating elements use TEME unless the service declares another verified calculation frame. |
| SP3 | The exact header label and realization, for example `IGS20` | It is not reduced to generic “ITRF”. A different output can only be requested over a declared transform route. |
| OEM | The selected segment's frame | Each segment may declare a different frame, centre, or time scale. |
| Compatible OMM | TEME when executed through SGP4 | OMM mean input is retained; that does not create a new analytical model. |
| Manual vector / numerical | EME2000 | Manual/numerical integration works in EME2000; transformed output is subject to the same frame validation. |

## Frame, method, and sampling

The inspector deliberately separates four concepts that are often conflated:

1. **Native state frame**: the frame in which the provider supplied `r/v`.
2. **Table output frame**: the frame of Cartesian states actually returned for
   this request.
3. **Calculation frame**: the frame in which the runtime declared an
   osculating-element calculation, if one exists.
4. **Display frame**: a scene concern; it does not silently transform the
   table or change sample provenance.

The **Method and source** card reports the engine actually applied, its family,
declared interpolation and degree, published mean cadence, forces, internal
step, and tolerances only when the runtime supplied them. **Output frame**
offers `TEME`, `ITRF`, `EME2000`, `GCRF`, and `ICRF` only after the endpoint
declares a transform route. **Native** omits a transformation request. Every
selection is validated over the *whole* range: a route can fail because EOP/ERP,
leap seconds, coverage, or an applicable realization is missing. In that case
the service returns an actionable error and no relabelled table is published.

The response preserves `frame.native`, `frame.current`, `frame.output`, and
`frame.calculation`; each row also retains its native frame and transformation
provenance when applicable. A TLE can therefore publish Cartesian states in
ITRF while its osculating elements remain TEME; a terrestrial SP3 transformed
verifiably to GCRF can calculate elements in GCRF. Asking generic `ITRF` for
native `IGS20` does not relabel the datum: `frame.current` remains `IGS20`
unless a real transform occurred. Generic `ECI` and `ECEF` are not choices.

The interval is not a local setting. **Refresh** uses the active global range;
presentation and export are fixed to **UTC**, while the source time scale is
retained per row. **Sampling step** controls request cadence (automatic,
1 min … 1 day), not the global range or a product's physical cadence.

When an operator chooses a concrete cadence, Orbit calculates **every** sample
that cadence requires, including both interval endpoints; it does not replace
it with the former 121-point display series. For example, 24 hours at one
minute produces 1,441 samples. Dense requests publish their count as a running
task and explain that they may take a moment; they can be cancelled from
**Tasks** without changing the simulation. **Automatic** mode does choose a
bounded presentation density for very long windows because it is not an
operator-requested cadence. The Method card keeps source-declared cadence and
interpolation method separately.

Fixed-step numerical models such as Cowell/RK4 also retain an independent
internal-step validation. If a dense request cannot be executed safely by that
integrator, Orbit rejects it with its step count and an actionable alternative;
it never silently coarsens the cadence you selected. That protection does not
affect the requested resolution for analytical or tabular sources that can
serve the interval.

## State table, filters, and export

When supplied, the common Cartesian core is UTC epoch; `X`, `Y`, `Z` position;
`VX`, `VY`, `VZ` velocity; and the declared units, frame, time scale, and
provenance. Derived columns appear only when their inputs are finite and the
operation is declared. They never fill missing velocity, covariance, or
precision values.

A complete table begins with `Epoch UTC`, `Frame`, `Time scale`, `X`, `Y`, `Z`, `Vx`, `Vy`,
`Vz`, `|r|`, and `|v|`. `Epoch UTC` is the API-normalized query instant;
**Time scale** retains the source scale when the provider declares it (for
example GPS or TAI in a precise product). Units come from the column contract, so a heading does
not claim `km` or `km/s` when the source declares another unit. `|r|` and
`|v|` are **DERIVED** and require all three relevant components.

Filters are predicates over already returned rows. They do not alter the
ephemeris, global range, or backend request. An export of filtered rows carries
an `exportMetadata` snapshot: source type/origin/format and availability;
method, frame, quality, forces, and precision; `range` and
`simulationRange`; included columns; `scope`, `presentation.timeFilter`,
`presentation.sort`; and exported-row count. A shorter export therefore does
not change an OEM into TLE or a manual design into a catalogue object.

The window has **Information**, **Chart**, and **Values** tabs. In **Values**,
each header sorts ascending or descending, the column picker hides or shows
fields without changing the series, and `From UTC` / `To UTC` only filter the
visible rows. Headers identify **DIRECT** and **DERIVED** fields. The chart
uses the table's real output frame, never the Cesium scene display frame.

### Reading the chart

The **Chart** tab is a compact inspection view: it retains wheel zoom,
drag-to-pan, and PNG export while fitting its height to the inspector window so
that operational controls remain visible. Y-axis ticks use readable series
steps (`1`, `2`, `2.5`, `5`, and powers of ten); decimals appear only when the
physical scale requires them.

The parameter picker uses the **same column normalization as the Values tab**.
It can therefore plot any published numeric column that has at least two finite
samples; it is not limited to a fixed list of orbital elements. Time, frame,
time-scale, text, and flag fields are excluded because they are not a
continuous quantity. Every option retains its **DIRECT** or **DERIVED** mark,
matching the Values heading. The unit shown beside a parameter is the unit
declared for that column; it may vary by source, and the UI does not invent a
common unit when the contract does not publish one.

The **Sampling** label reports the method declared by the source —for example
Lagrange, Hermite, or linear, with its degree when published— rather than a UI
assumption. The cursor distinguishes two readings:

- **Series sample**: a value received or evaluated for a response epoch, with
  its source-interpolation provenance.
- **Trace reading**: the visual cursor position between consecutive samples.
  The UI derives it linearly only to place the pointer; it does not create a
  sample, run propagation, or replace the SP3/OEM declared method.

This keeps a continuous trace readable without presenting a cursor value as a
new ephemeris or as a different physical interpolation.

### Source-specific facts

| Profile | Direct facts that may appear | Derived facts that may appear | Operational interpretation |
| --- | --- | --- | --- |
| TLE / SGP4 | identity, epoch, and available mean TLE elements | `a`, `e`, `i`, RAAN, argument of periapsis, anomalies, period, perigee, apogee | State is SGP4 TEME; row elements are **derived osculating** values, not rewritten mean TLE data. |
| SP3 | published `r/v` when available, clock, provider sigma/RMS, quality, centre, product class | Cartesian norms; osculating elements only if declared by runtime | Direct seconds clock data are normalized to `ns`; explicit linear sigma/RMS data are normalized to `mm`. Separate **SP3 orbit sigma** comes from `++`: it is a file/satellite-wide 1σ declaration (`2^n mm`), not per-epoch/component sigma, RMS, or covariance; blank/`0` means undeclared. A RINEX CLK is associated only on a unique physical SP3 epoch under the scale/leap-second/ERP contract—never by nearest neighbour or interpolation. CLK does not replace SP3 chronology or position; an unprovable association leaves SP3 valid and CLK unassociated. |
| OEM | `r/v`, per-segment frame/time scale, interpolation, acceleration, covariance when published | Osculating elements only for a complete Earth-centred inertial state | Each segment is an independent source. Covariance belongs to its exact epoch and is neither interpolated nor invented. A maneuver row appears only if the provider publishes it; Orbit does not synthesize maneuver flags. |
| OMM | supplied mean elements, mean motion, B*, drag, SRP | an osculating series only when separately returned by the engine | Mean OMM fields always remain distinct from osculating values. To make them filterable/exportable alongside each returned state, supplied input fields repeat on every row with `source-input` provenance; they are not a time-varying osculating series. An importer that runs SGP4 using contained TLE lines reports `OMM input / SGP4 applied`, never a fictional analytical OMM model. |
| State vector | definition epoch, `r/v`, frame | osculating elements, period, perigee, apogee when runtime calculated them | A vector never becomes a synthetic TLE. Manual vector input follows the EME2000 limitation documented above. |
| Numerical / manual | `ax/ay/az`, forces, integrator, tolerances, events when published | runtime-derived elements | Acceleration/event units and provenance remain independent; a requested force, integrator, or maneuver is not presented as applied unless the runtime confirmed it. |

Every table heading is marked **DIRECT** or **DERIVED**. Row-level provenance
and units are preserved in JSON export as an aligned `rowMetadata` array:
units/provenance, interpolation/sampling, covariance details, native frame,
per-row transform, and native provenance
remain associated with `rows[n]`, including duplicate epochs. CSV preserves
the selected cell matrix and its serialized column-level metadata. Textual quality, event, maneuver, and
covariance-summary fields remain text rather than being forced through a
numeric formatter.

### Multi-segment OEM

An OEM may change frame, centre, time scale, or interpolation between blocks.
For safety, a multi-segment request must provide `source.segmentIndex`, and a
range crossing that segment's boundary is rejected. Orbit neither implicitly
chooses the first segment nor interpolates across a discontinuity. A local OEM
without a registered backend provider is explicitly unavailable instead of
being re-propagated through SGP4.

Displayed cells may be rounded for reading. The export retains the numerical
contract value and leaves unavailable fields absent. See [Export](export.md)
for general exchange-format limits.

The menu offers **CSV** and **JSON**. CSV contains visible columns plus a
serialized metadata header; JSON preserves separate `metadata`, `rows`, and
the aligned `rowMetadata` objects. Export can include the whole received interval or only rows visible
after the current time filter and ordering. Hiding a derived column excludes it
from the file but never removes the source, method, or frame provenance. HDF5
is deliberately not advertised until a large-volume writer can preserve this
same provenance contract.

## Practical limits

### Actionable errors

| Situation | Inspector behaviour | Operator action |
| --- | --- | --- |
| Output frame has no transform/EOP/ERP route for the full window | Rejects the request and preserves the service reason; it does not mark the frame as applied. | Select **Native**, change/reduce the global range, or provide the required temporal coverage. |
| SP3/OEM outside coverage | Does not extrapolate or return invented rows. | Use a covered interval or import the appropriate product. |
| Multi-segment OEM without `segmentIndex`, or a range crossing a segment | Fails explicitly before interpolation. | Select a segment and use a range fully contained by it. |
| Vector without velocity or inertial frame | Preserves available components but does not invent osculating elements. | Complete the state or inspect it in a verifiable inertial frame. |
| Dense explicit sampling | Calculates the complete series and publishes a cancellable task with its sample count. | Wait for completion or cancel the task; the simulation does not change. |

- The inspector is not a historic-catalogue replay or orbit-determination
  tool.
- Finite SP3/OEM coverage is respected: it is never extrapolated outside an
  authorized source window, and any interpolation stays within declared
  coverage.
- Generic ECI/ECEF is not a substitute for the time and realization provenance
  required by precision results; see [Time, EOP and ITRF](../operations/time-eop.md).
- Keep the original input file when documentary fidelity matters. Derived
  profiles and sampled exports are not a forensic copy of it.
