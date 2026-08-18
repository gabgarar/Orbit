# Event planner

[Home](../index.md) · [User Guide](index.md) · [Timeline](timeline.md) · [Projects](projects.md)

The planner collects time facts already available in the scene. It does not
propagate an orbit again, reserve an antenna, or replace input-product
validation. It is the foundation for future schedule views.

## Views and navigation

The planner surface presents the same events in **day**, **week**, and
**month** views. Changing view only groups the UTC instants published by the
scene; it neither changes nor recalculates data. Activating an event with a
valid time makes Orbit attempt to position the simulation at that exact instant.
If it lies outside the simulation range or the Master Time Range (MTR), the
scene does not move and the state reports why.

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
`los` markers are adapted to `pass-aos`, `pass-maximum`, and `pass-los`. When
the planner opens in **Simulated** mode, Orbit builds its own forecast for
**every** eligible visible-station × active-visible-satellite pair. The work is
progressive and uses at most two concurrent requests; it reuses validated pass
cache entries without modifying the currently selected timeline. Closing the
planner, changing project, or changing range/mode cancels pending work. No
moving schedule is invented in realtime or static mode. Hiding or removing an
endpoint immediately removes its markers from the view; adding a visible layer
or station refreshes the pair set.

## Quality and availability facts

The canonical `orbit:planner-state` reports `loading`, `ready`, or `error`,
the events, `updatedAt`, and known errors. It also retains active-source facts
so a view can explain them:

While a global forecast is running, completed pairs can already appear while
other pairs are still loading. A failure for one pair is published as a partial
error and does not erase valid passes from other pairs; if no valid result is
obtained, the state becomes an error.

- a manual ERP is identified by its validated snapshot, provenance, and
  coverage range when the service published those fields;
- SP3 and OEM contribute only their finite ranges validated in the scene;
- active layers expose their available type, visibility, provenance, and
  verifiable state, without turning a visual layer into a scientific guarantee.

Ended coverage is an availability boundary (`validity-end`), not an expiry
date. If a source has no verifiable date, no fictitious event is shown. A source
error, pending validation, or invalid time remains a state/error rather than a
positive availability claim.

## Manual events and projects

The planner accepts `manual` events with title, start, end, and an allowed
palette colour. Dates are validated before acceptance: they must be UTC or
unambiguous instants, and the end must be after the start. Only these
user-authored events are saved in `plannerEvents` in a v1 project. Derived
events from passes, ERP, SP3, OEM, diagnostics, or layers are recomputed when a
project opens and are **not** serialised as authoritative data.

## Current limits

The planner is not yet an operational calendar: it does not export ICS,
synchronise with external calendars, detect antenna conflicts, or create
reservations. Those capabilities need their own availability and authorisation
contract; current events only provide a traceable foundation for them.
