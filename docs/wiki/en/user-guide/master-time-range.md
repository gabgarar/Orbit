# Master Time Range (MTR)

[Home](../index.md) · [User Guide](index.md) · [Timeline](timeline.md) · [Import](import.md) · [Projects](projects.md)

The **Master Time Range** (MTR) is the single UTC interval that governs a
scene containing finite-coverage data. It is represented by the inclusive
interval `[t_min, t_max]`. The timeline, layers, importers, and generators all
consult the same MTR; none may create a competing range or evaluate outside it.

The MTR is a data-availability policy. It does not alter a product's time scale
or reference frame. See [Time, EOP and ITRF](../operations/time-eop.md) for
UTC, UT1, ERP, and frame handling.

## How it is established

The first object with valid finite coverage establishes the session MTR. It can
be an OEM, an SP3, or an imported/generated orbit with explicit start and end
epochs.

| Operation | MTR rule |
| --- | --- |
| First OEM, SP3, or other finite ephemeris | The MTR takes its exact published start and end. The scene enters range simulation. |
| Object whose coverage is contained | It is accepted without changing the MTR. |
| Object extending beyond the MTR | Orbit asks for confirmation before changing the range. |
| Generating an orbit outside the MTR | Orbit reports the conflict and offers the same explicit expansion. |
| New project | The MTR is cleared; the next valid finite object initializes it again. |

An import expansion never shrinks the interval. If confirmed, the result is:

\[
  [\min(t_\min, r_0),\; \max(t_\max, r_1)]
\]

where `[r_0, r_1]` is the coverage of the object being added.

When a layer is deactivated or removed, Orbit rebuilds the temporal context
only from layers that remain active. Removing an SP3 therefore cannot leave its
historical interval pinned in the scene: remaining finite ephemerides define
the active envelope; TLE/OMM-only scenes use an operational TLE window; and no
remaining satellite clears the MTR and returns the scene to **Real time** with
an operator notice.

## Confirming expansion

When an object does not fully fit, Orbit displays the confirmation dialog:

> This object is outside the simulation range. Expand Master Time Range?

The actions are **Expand** and **Cancel**. **Expand** applies the union of the
two intervals and only then permits the object to load or be generated.
**Cancel** leaves the MTR unchanged and does not add the object. There is no
implicit expansion and no silent coverage trimming.

This prevents accepting a layer with an endpoint that has no data and makes the
decision that changes the scene's temporal context explicit.

## Each object's own coverage

The MTR does not replace an object's intrinsic coverage. An OEM, SP3, or
tabulated orbit retains its own interval `R = [r_0, r_1]`. At current epoch `t`,
it is evaluated only when:

\[
  r_0 \leq t \leq r_1
\]

Outside `R`, Orbit marks the object **Inactive (out of range)** and displays
**“This object has no data for the current epoch.”** Its state is null; it is
not interpolated, propagated, queried for ephemerides, or used to generate
geometry. In particular, Orbit never extrapolates an OEM, SP3, or reference
orbit beyond its published samples.

Every `.oem` file is imported as a native OEM ephemeris, even when a provider
includes `TLE_LINE1` and `TLE_LINE2` comments. Those comments do not turn OEM
samples into a catalogue layer: their finite coverage is retained and the same
MTR decision is applied.

Missing, malformed, or reversed coverage is invalid as well. It is not treated
as permission to extrapolate.

AOS/LOS analysis follows the same rule: its requested window must be wholly
contained in the ephemeris' own coverage. Orbit does not clip the request to
return partial passes; if either endpoint lies outside, it returns
**Inactive (out of range)** with no passes or samples and explains that the
analysis was not generated. A local OEM is not silently replaced with a TLE
for that calculation either: until it has an AOS/LOS provider, its result is
explicitly unavailable.

## Timeline and real time

The [timeline](timeline.md) rail and cursor are clamped to the MTR. An attempt
to move before `t_min` or after `t_max` lands on the respective boundary; play
cannot leave that interval.

When an MTR exists, **Real time** is available only if the current wall-clock
instant belongs to the interval. Otherwise, real-time layers are disabled and
the scene stays in range simulation. A historical SP3 is therefore not
presented as though it had a valid state now.

## Project persistence

The project document preserves serializable temporal configuration: mode, MTR,
current epoch, playback, and speed. On reopening, Orbit revalidates the
interval against layers that can be restored and clamps the cursor to the MTR
again. Saving a project does not itself embed input binaries.

In particular, a local OEM or precise product whose source is no longer
available does not regain samples merely because its former MTR is present in
the JSON. Keep the source files and import them again; until valid coverage is
available, no state is created and no trajectory is extrapolated.

## TLE, OMM, and the coverage limitation

A TLE/OMM propagated with SGP4 does not publish a tabulated coverage interval
equivalent to an OEM or SP3 in this workflow. Consequently, adding a TLE layer
to a clean scene does not initialize or expand the MTR and keeps **Real time**.
Its epoch and use limits still matter when judging SGP4 quality, but they are
not converted into invented finite coverage.

The TLE epoch is nevertheless an operational lower availability bound: before
it, Orbit marks the layer **out of range** and does not retain a marker or
track from a later update. This is an Orbit operating policy; it does not claim
that SGP4 is mathematically unable to evaluate backwards, nor does it certify
accuracy from the epoch onward.

If the last finite OEM/SP3/authored track is removed while TLE/OMM layers stay
active, Orbit retains a short operational simulation window. It starts at
`max(now, TLE epoch)` and ends after the configured propagation horizon. That
keeps the operation usable without inventing tabulated coverage or carrying
days, months, or hours from a previous SP3 simulation. `propagation_hours` is
a TLE display/planning preference; applying a simulation range never rewrites
or persists it as an SP3/OEM duration.

In a scene that already has an MTR because of OEM/SP3 or another finite
ephemeris, the TLE operating window can form part of the scene temporal
envelope, but each source retains its own contract: SP3/OEM is not evaluated
outside published samples, and a TLE is not evaluated before its epoch. This
keeps visualization and temporal comparison coherent, but it does not turn a
TLE into a reference ephemeris or certify its accuracy away from the element
epoch.

An envelope can contain a real gap between the last SP3/OEM sample and the
TLE epoch. To prevent that gap from being drawn as a fictitious orbit, Orbit
asks the propagator only for a local post-cursor segment (between one minute
and 24 hours, according to the configured horizon), never for the whole
envelope. Moving the cursor refreshes that segment; navigation across the full
MTR remains free and the gap remains visible as missing data for that layer.

To avoid a pause at a segment boundary, Orbit may warm only the adjacent TLE
segment in the background. This optional warmup is limited to one global
request, does not change the scene until the cursor enters its interval, and
visible requests always retain priority.

## Technical contract

The runtime centralizes these operations so importers, generators, and the
timeline apply the same policy:

```js
setMasterTimeRange(tMin, tMax)
expandMasterTimeRange(newMin, newMax)
getMasterTimeRange()
isInsideMasterRange(time)
clampToMasterRange(time)
validateObjectRange(range)
validateObjectFitsMTR(range)
isInsideObjectRange(object, time)
```

`validateObjectFitsMTR` distinguishes a valid initialization, a contained
input, and an input that requires expansion confirmation. Validation fails
closed: an invalid range neither changes the MTR nor permits the object to
load.
