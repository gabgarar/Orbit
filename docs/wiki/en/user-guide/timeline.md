# Timeline and time modes

[Home](../index.md) · [User Guide](index.md) · [3D View](three-d-view.md) · [Projects](projects.md) · [Time and EOP Operation](../operations/time-eop.md)

Orbit separates presentation time from scientific settings
scales and EOP. The interface control determines the epoch that powers the viewer
and interactive consultations; does not download or modify time products.

## Modes

| Visible mode | Internal status | Result |
| --- | --- | --- |
| Static | static | Preserves the current epoch without automatic advance. |
| Real-time | realtime | Update the era with the wall clock while it plays. |
| Paused | realtime with playback disabled | Retains the last sampled real-time epoch. |
| Simulated | range | Advances or positions within a range defined by the operator. |

The mode selector appears next to the project's UTC date and time. In
Static and Real time simulation bar is hidden to avoid showing
controls that do not apply to the current mode.

## Simulated range

In Simulated, the bottom control offers:

- Restart at the beginning of the interval.
- Play and pause.
- Speeds x1, x10, x60 and x600.
- Start and end selection via calendar.
- Timeline cursor to position the era.
- Timestamps calculated over the active range.
- A control to collapse or redisplay the bar.

The cursor is limited to the chosen range. If the end is not after the start,
the timeline does not represent a valid range.

## AOS/LOS pass markers

In **Simulated** mode, selecting a visible ground station or a visible
satellite makes Orbit progressively calculate passes for every station--
satellite pair whose two endpoints are visible in the scene. The calculation
uses the active simulated window and the same AOS/LOS contract that supplies
the pass tables; it does not invent a new ephemeris or extrapolate a finite
source outside its coverage.

Each published pass contributes up to three UTC markers to the timeline:

- **Maximum elevation**, green and above the bar. It is shown only when the
  analysis published `max_elevation_time`; a midpoint is never presented as a
  physical maximum.
- **AOS** and **LOS**, purple and below the bar. They delimit the refined
  beginning and end of the same access window.

Markers retain the station--satellite pair, AOS, LOS, and reported maximum
elevation. They can be inspected and used to position the simulation at the
event's exact UTC instant without quantising it to the visual slider step.
This makes simultaneous contacts from several stations and satellites
comparable in one window.

Scene visibility is part of the contract: hiding or removing either the
station or satellite of a pair immediately removes its three markers. Results
appear pair by pair as they finish. Changing the selection, simulated window,
or scene cancels pending requests and discards their results so they cannot
mix with the new context. The **Activity** panel reports that work and can
cancel it.

!!! note "Long windows and resolution"

    Event-only requests preserve the requested `step_seconds` exactly, even
    when the backend has to split a long window into internal chunks. Shared
    endpoints are joined before AOS/LOS extraction, so a pass spanning a chunk
    remains one pass. The step is never reduced automatically. To protect the
    service, this mode permits at most 250&nbsp;000 estimated samples; a larger
    request fails explicitly and asks the operator to shorten the window or
    increase the step. Requests that also return chart vertices retain the
    20&nbsp;000 materialised-sample limit.

!!! info "Foundation for a calendar"

    The flow retains normalised events (`aos`, `max`, `los`) with station and
    satellite identifiers. A future calendar view can reuse them without
    reinterpreting geometry. This is not yet an antenna schedule, resource
    reservation, or confirmation of operational availability.

## OEM and time domain

A local OEM trajectory can impose its own temporal domain on the space
of work. When that domain is active, manual editing of the range from
the bar is disabled to avoid asking for states outside the samples
available. If OEM layers are mixed with TLE or OMM, expressly check the
active range before interpreting the comparison.

!!! warning "This is not a catalog replay"

    Simulated mode controls the session evaluation time. No
    rebuilds historical versions of TLE, does not reproduce received telemetry
    nor does it constitute a distributed physical simulation.

## Persistence

Mode, start, end, current time, playback and speed are included in the
[Project] document (projects.md). The time saved may depend on the
input data that is still available when the session is reopened.

## Scale precision

The interface features UTC. UTC, UT1, TAI and TT conversions, along with the
EOP products, are configured in the backend. For reproducible operations or
precision exports, see [Time and EOP operation](../operations/time-eop.md)
and don't assume that visual mode without local data is suitable for analysis.
