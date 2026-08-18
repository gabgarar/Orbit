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

The operational summary stays on one line when ready. **Details** expands its
explanation without hiding information; while calculation is in progress, the
progress remains visible. Action acknowledgements are short-lived floating
notices, so they do not consume calendar height. Persistent errors remain
alerts inside the window.

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

This visible interval is the pass-forecast domain; it is not an expiry date and
does not itself alter the scene.

| Mode | Agenda and pass behaviour |
| --- | --- |
| **Simulated** | Computes AOS, maximum, and LOS for the visible UTC interval only when the complete interval lies inside the simulated range and, when present, the Master Time Range (MTR). If it does not fit completely, it fails closed and explains the boundary. |
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
| `*-expiry` | Expiry event | Shown only when a source explicitly declares a valid expiry date. Orbit never derives expiry from coverage. |
| `manual` | User-selected palette colour | A user-authored time block; it is neither a pass nor a confirmed reservation. |

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
agenda, but still exist in the scene. Manual events belong to the project and
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
- active layers expose their available type, visibility, provenance, and
  verifiable state, without turning a visual layer into a scientific guarantee.

Ended coverage is an availability boundary (`validity-end`), not an expiry
date. If a source has no verifiable date, no fictitious event is shown. A source
error, pending validation, or invalid time remains a state/error rather than a
positive availability claim.

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
