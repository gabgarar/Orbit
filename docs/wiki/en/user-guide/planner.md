# Event planner

[Home](../index.md) · [User Guide](index.md) · [Timeline](timeline.md) · [Projects](projects.md)

The planner collects time facts from the scene and, when it prepares a pass
forecast, uses the already-defined ground-station access calculation for each
eligible pair. It does not modify the orbit, reserve an antenna, or replace
input-product validation. It is the foundation for future schedule views.

## Working window

On desktop, the agenda is a session-only floating window: drag it from its
header and resize it from any of its four edges or corners. Orbit always keeps
its geometry within the visible area. Closing the agenda discards that size and
position; the next opening returns to the default working rectangle. This
geometry is neither exported nor part of a project.

On a compact screen the agenda fills the window and cannot be dragged or
resized. When an operator narrows a desktop agenda, its internal regions adapt
to the agenda's actual width, rather than only the viewport width, to avoid
incidental horizontal rails.

The header retains only temporal navigation and agenda actions. An operation's
state appears in the global activity panel or, when it applies to a concrete
time, as an agenda event or range; it does not occupy a fixed strip above the
calendar. Action acknowledgements are short-lived floating notices, while
persistent errors remain alerts inside the window.

## Views, UTC interval, and temporal modes

The agenda is available in **Simulated**, **Real time**, and **Static** modes.
It presents the same events in **day**, **week**, and **month** views, always in
UTC. The “Go to month and year (UTC)” selector places the cursor in the chosen
month while retaining the day when it exists; the previous/next controls move
by the active period. The view publishes a half-open UTC interval `[start, end)`:
24 hours for day, Monday--Sunday for week, and the whole month for month. If no
interval has been selected yet, Orbit uses a UTC week anchored to the instant
currently shown by the scene. When opening a historical simulated scene, the
cursor is first anchored to that simulated domain (rather than today's
wall-clock date), so no invalid viewport is requested before scene state arrives.

This visible interval is the requested pass-forecast domain; it is not an
expiry date and does not itself alter the scene. In **Simulated**, when a day,
week, or month view only partly overlaps the simulated/MTR domain, Orbit
calculates only their exact intersection. When there is no overlap it emits no
invalid request: the agenda returns to the start of the active temporal domain.
It never extends an SP3 or fills dates outside published coverage just to
complete a calendar grid.

The detail pager traverses every event already published and visible to the
agenda, not only the current month, week, or day. When the next event lies
outside the current view, the cursor moves to its period without closing the
planner. Passes are calculated on demand for the interval being consulted;
Orbit neither invents nor precomputes passes for an unbounded time window.

| Mode | Agenda and pass behaviour |
| --- | --- |
| **Simulated** | Computes AOS, maximum, and LOS for the safe intersection of the visible UTC interval, simulated range, and, when present, the Master Time Range (MTR). A view with no overlap is rebased to the active domain and does not produce an out-of-coverage request. |
| **Real time** | Calculates the chosen finite UTC interval as an agenda snapshot. It does not shift or recalculate that interval on every realtime tick. Opening or navigating the agenda does not move the scene. |
| **Static** | Calculates the chosen finite UTC interval without changing the scene's static instant. Opening or navigating the agenda does not move the scene. |

When activating an event, Orbit can position the simulation only when the
mode's temporal contract permits it and the instant is valid; at any boundary,
the scene remains unchanged and the state explains why.

## Published events

| Type | Colour/layer | Source and meaning |
| --- | --- | --- |
| `pass-maximum` | Green, above the timeline | Maximum elevation of a pass. It exists only when analysis returned `max_elevation_time`; a midpoint is never fabricated. |
| `pass-aos` | Purple, below the timeline | Refined start of access for one station--satellite pair. |
| `pass-los` | Purple, below the timeline | Refined end of that same access. |
| `erp-validity-end`, `sp3-validity-end`, `oem-validity-end`, `layer-validity-end` | Availability event | Explicitly verified end of coverage for the corresponding resource. It is not a publisher expiry. |
| `iers-c01-coverage`, `finals2000a-coverage`, `erp-linear-extrapolation` | Range in the **IERS ERP Time** layer | A verified interval resolved respectively with C01, `finals2000A.all`, or local linear extrapolation (at most 30 days). Overlap is resolved with C01 → Finals → extrapolation priority, so internal quality changes do not create several “coverage end” markers. C01 is shown in green; Finals `final`/`rapid` in amber; and `predicted` in red. |
| `erp-nominal-fallback` | Open point in the **IERS ERP Time** layer | Nominal Earth-rotation fallback begins (no ERP) after the linear limit or where two compatible samples do not exist. It has `approximate` quality, is neither IERS nor ERP, and is not an expiry. It remains a point because the source does not publish an honest end for that state. |
| `product-erp-coverage` | Cyan range in **SP3-bound ERP** | Verified UTC coverage of an ERP file attached to the SP3 product. It is neither IERS nor a date inferred from a filename. |
| `*-expiry` | Expiry event | Shown only when a source explicitly declares a valid expiry date. Orbit never derives expiry from coverage. |
| `layer-imported` | Cyan, associated with the layer | A locally recorded layer import. It appears only when the service saved both the import instant and source file name; it is not inferred from a generic catalogue update. |
| `tle-epoch` | Blue, associated with the layer | The epoch written in a TLE/OMM containing a TLE. It is a property of the element, not an expiry date or accuracy guarantee. |
| `manual` | User-selected palette colour | A user-authored time block; it is neither a pass nor a confirmed reservation. |

### Reading **IERS ERP Time**

This layer's traffic light communicates provenance and the required operational
attention. It is not a universal numeric error value or a mission
certification. Event details retain the exact source, quality, and interval.

| Agenda colour | Meaning | Operator decision |
| --- | --- | --- |
| Green — **IERS C01 / normal** | The combined/final C01 product covers the epoch. It is Orbit's preferred automatic source while that coverage exists. | Normal route. Check the range when an operation approaches its boundary. |
| Amber — **OK: Finals `final` or `rapid`** | C01 does not cover the epoch and Orbit uses `finals2000A.all`. `final` has a complete Bulletin B tuple (LOD remains Bulletin A or optional); `rapid` has operational Bulletin A determinations with `I` flags. Both are usable published data, but amber does **not** claim that they have precision identical to C01 for every parameter or use. | The operation may continue under its contract, but inspect the precise label and coverage for sensitive work. |
| Red — **Bulletin A `predicted`** | At least one parameter has a `P` flag: it is an official Bulletin A forecast, not an observation. | Plan cautiously, confirm the interval, and update/recompute when observed or final data become available. Do not treat it as product-attached ERP. |

After Finals, a separate red band can mean local linear extrapolation; that is
not an IERS prediction either. The event detail always distinguishes the two.
For parameter-level selection and strict routes, see
[Time, EOP and ITRF](../operations/time-eop.md).

### ERP attached to an SP3

When **every** active SP3 that contributes temporal coverage to the scene has
an attached, validated ERP covering its complete published interval, the agenda
replaces the automatic **IERS ERP Time** layer by default with **SP3-bound
ERP**. Each cyan rail shows exactly the UTC start and end published by that
product; its detail retains the file, snapshot, and provenance when available.
For a combined forecast Orbit declares that ERP as the temporal source only
when participating satellites are SP3 and their attached coverage spans the
whole effective window.

The replacement is intentionally strict: a second SP3 without ERP, a partial
ERP, a file without a verified UTC range, **or an active non-SP3 satellite**
leaves **IERS ERP Time** visible. In a mixed scene the cyan rails still show
the exact SP3 ERP, but are not presented as the source for other satellites.
Orbit never derives coverage from a filename, import time, or `erp_file`, so it
does not hide an automatic source that may still be needed.

Passes enter through the ground-station aggregate: its source `aos`, `max`, and
`los` markers are adapted to `pass-aos`, `pass-maximum`, and `pass-los`. In
all three temporal modes, Orbit builds its own forecast for **every** eligible
visible-station × active-visible-satellite pair inside the agenda's visible UTC
interval. The work is progressive and uses at most two concurrent requests; it
reuses validated pass cache entries without modifying the currently selected
timeline.

Closing the planner, changing project, or changing interval/range/mode cancels
pending work and discards its partial aggregate. Hiding or removing either
endpoint of a pair in the **scene** immediately removes its markers from the
agenda; a new visible layer or station refreshes the pair set. Error details
retain any correct results that have already been calculated.

## Agenda filters and scene visibility

The **Agenda layers** sidebar can hide a layer only inside the planner. This
filter does not change the Layers eye, hide a 3D entity, deactivate the
satellite, or start a new propagation. It is therefore distinct from hiding a
scene layer: the scene eye does change physical visibility and determines
whether a station/satellite may participate in a pass forecast.

Filtered layers disappear from derived events and resource notices in the
agenda, but still exist in the scene. **IERS ERP Time** is a synthetic agenda
layer: it hides only its C01, Finals, extrapolation, and nominal-fallback facts
without changing diagnostics, the scene, or the time provider. When an SP3
scene meets the attached-ERP contract, this layer is replaced by the synthetic
**SP3-bound ERP** layer, which filters only its verified rails. Manual events belong to the project and
remain visible: a layer is not yet their explicit owner. The underlying forecast
and cache remain: when a layer is shown again, its already calculated events
reappear immediately without touching the scene or starting new work solely
because of the filter. The preference is saved per project as
`plannerHiddenLayerIds`; when a station is restored, its identifiers are mapped
before the filter is applied.

## Quality and availability facts

The canonical `orbit:planner-state` reports `loading`, `ready`, or `error`,
the events, `updatedAt`, and known errors. It also retains active-source facts
so a view can explain them:

For integrations, `layers[].visible` describes the scene eye and
`layers[].plannerVisible` the agenda-only filter. `plannerHiddenLayerIds` and
`context.passes` (view, mode, boundaries, and progress) explain why an interval
is calculated, pending, or rejected.

While a global forecast is running, completed pairs can already appear while
other pairs are still loading. A failure for one pair is published as a partial
error and does not erase valid passes from other pairs; if no valid result is
obtained, the state becomes an error. An interval outside the simulated
range/MTR, a cancellation, or an ineligible source never becomes a positive
event.

- a manual ERP is identified by its validated snapshot, provenance, and
  coverage range when the service published those fields;
- SP3 and OEM contribute only their finite ranges validated in the scene;
- `diagnostics.erp.coverageTimeline` publishes, when available, verified C01
  and `finals2000A.all` intervals, `linear-extrapolation` with start, end, and
  a 30-day maximum, and `nominal-fallback` with no finite end. Each fact
  retains `coverageStart`/`coverageEnd` or `start`/`end`, `source`, `quality`,
  and a description; the agenda never invents a boundary that diagnostics did
  not declare;
- active layers expose their available type, visibility, provenance, and
  verifiable state, without turning a visual layer into a scientific guarantee.
  For a locally imported TLE/OMM, Orbit can also publish the recorded source
  file/import instant and the epoch read from the element itself.

A newly imported TLE can therefore appear even before there is a ground station
or a computed pass: when both dates exist, the agenda shows its import and its
epoch. These are read-only provenance details; a TLE layer does not thereby
publish a coverage end. Layers imported before the catalogue recorded an import
instant still expose the TLE epoch when its element is available.

Ended coverage is an availability boundary (`validity-end`), not an expiry
date. If a source has no verifiable date, no fictitious event is shown. A source
error, pending validation, or invalid time remains a state/error rather than a
positive availability claim.

The Earth-orientation layer shows ranges rather than a collection of fixed
alerts: C01 is preferred while it covers the epoch; `finals2000A.all` with
`final`, `rapid`, or `predicted` quality can follow; then the local linear
extrapolation range begins, limited to 30 days. Afterwards no automatic EOP
remains: an `erp-nominal-fallback` point marks the approximate-quality nominal
rotation and a strict route rejects. The dates come from the installed snapshot,
not a fixed IERS calendar. When an operation crosses one of these boundaries,
preflight shows the subintervals and corresponding warning before starting work;
a window only partly inside C01 is not marked precise throughout. Explicit SP3
or manual-orbit ERP is not filled with this automatic chain: it keeps its own
strict coverage contract.

An EOP band is one temporal fact: it is drawn continuously within each week row
rather than cloning a chip into every day. If Finals changes from `final` to
`rapid` without changing its amber operational signal, Orbit groups the
presentation while retaining the exact subranges and qualities in its details.
It never groups a red prediction with red degraded extrapolation, because those
are distinct operational routes.

## Manual events, preferences, and projects

The planner accepts `manual` events with title, start, end, and an allowed
palette colour. Dates are validated before acceptance: they must be UTC or
unambiguous instants, and the end must be after the start. Only these
user-authored events are saved in `plannerEvents` in a v1 project. Alongside
them, only the agenda's hidden-layer preferences (`plannerHiddenLayerIds`) are
saved. Derived events from passes, ERP, SP3, OEM, diagnostics, or layers are
recomputed when a project opens and are **not** serialised as authoritative
data. The current temporal view is not stored as an antenna reservation, and
the planner filter does not replace scene visibility state.

## Current limits

The planner is not yet an operational calendar: it does not export ICS,
synchronise with external calendars, detect antenna conflicts, or create
reservations. Those capabilities need their own availability and authorisation
contract; current events only provide a traceable foundation for them.
