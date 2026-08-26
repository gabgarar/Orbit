# Built-In Test

[Home](../index.md) · [User Guide](index.md) · [Validation](../operations/validation.md)

The **Built-In Test (BIT)** icon, to the right of **Help**, opens the
continuous, read-only diagnostics panel. It does not start long propagations or
alter an orbit. Its tabs separate service availability, the startup **PBIT**,
time data, operational validation, and audit evidence so a data-quality
warning is not mistaken for a service failure.

## Statuses and refresh

BIT polls `/api/system/diagnostics` continuously from application startup,
including while its panel is closed, and uses `/api/diagnostics` for older
backends. In parallel it reads `GET /health`, the liveness check for the **web
gateway** and its **Python backend**. A `200` means the gateway can reach the
backend; a `503` can mean the gateway responded but the backend is not yet
available. Neither result decides project readiness.

The icon dot summarizes visible components; **Refresh** only requests an
immediate non-blocking poll. Each row shows **Healthy**, **Warning**, or
**Error**, together with its last published validation time. If the diagnostics
channel is unavailable, the panel says so instead of inventing a healthy state.

## Panel tabs

| Tab | Meaning |
| --- | --- |
| **Overview** | Overall state, project readiness, and issues requiring attention. Each issue opens its corresponding tab. |
| **Services** | Web gateway, Python backend, diagnostics channel, and continuous monitor. This is availability, not authorization to create projects. |
| **Validation** | The startup **PBIT** ledger, its steps, warnings, errors, and progress, plus time/reference, gravity, propagator, force, and scene-data checks. They are runtime probes, not CI/CD or release/mission certification. |
| **Audit** | Current PBIT result and steps, plus project propagations. It can export local CSV or JSON. |

MTR is contextual as well: it is shown only when the scene has an active
master time range. Its local range and clamp facts are not fabricated from a
remote card.

## Exportable audit

The **Audit** tab retains the latest PBIT execution published by the service
and the propagation history owned by the open project. A propagation records
only its target, source, propagator, UTC range, cadence, summarized sample
count, frames, and status; it does not store samples, source files, or raw
responses. The history travels in the encrypted local library and the `.orbit`
document, with a maximum of **200 executions** per project.

The **CSV** and **JSON** buttons download a local snapshot of that audit. It
includes the queried system state, PBIT, and propagation rows; it does not
replace the task glyph, which continues to show only currently running work.
Exporting neither deletes the audit nor repropagates an orbit.

## Startup PBIT and readiness

The **startup PBIT** block (the `startup` ledger, also called initial IBIT) is
the source of truth for whether Orbit may accept gated project work.
`ready: true` / `projectReady: true` are required; the state is normally
`ready`, or `degraded-ready` with its visible caveat. A healthy `/health`, a
card marked Healthy, or a terminal warning does not replace that decision.
When it is `pending` or `blocked`, inspect `requiredSteps` and `blockers`
rather than guessing which data are still missing.

The startup progress details show the current gravity model, completed and
total models, and one entry per model. Download percentage is deliberately
optional: if the server cannot establish a reliable total, `percent` is `null`
and the interface displays indeterminate activity. **Refresh** reads the
published snapshot; it neither restarts the service nor fabricates progress.

During pending readiness, the scene and this panel remain available. Orbit
gates New/Open/Import project in the interface and rejects forced manual-orbit
preview/create and orbit-parameter work with the published HTTP 503 readiness
reason. A first download can take longer; a later valid cached start normally
only validates local files and finishes faster.

## Startup PBIT notice when Orbit opens

When the terminal **startup PBIT** ledger (also called initial IBIT) publishes
one or more warnings but no blocking error, Orbit shows a compact, non-modal
card when the application opens. It summarizes up to three actionable reasons
and offers
**Review BIT** to open the complete diagnostic. It does not change `ready`,
`projectReady`, or the project-creation decision: a degradable warning can
still permit work under the contract published by the service.

The card can be dismissed with **Understood** or its close button. Once
acknowledged it does not reopen on every BIT refresh during that application
session; reloading Orbit may present the current startup result again.
Readiness failures and blocks are not disguised as this card: they remain on
the startup surface and in BIT as conditions requiring correction.

!!! warning "Not mission certification"

    The panel uses small bounded probes. Healthy means the checked route and
    its published data are coherent; it does not replace mission validation,
    a product-attached ERP, or the strict ECI policy described in
    [Time, EOP and ITRF](../operations/time-eop.md).

## Reading an EOP warning

An EOP warning can mean that the C01 copy is older than seven days, its
coverage does not reach the current date, or IERS did not respond and Orbit is
keeping the last valid copy. It is a time-and-reference warning, not an
automatic service-availability failure. If no valid copy exists, visualization
may use nominal terrestrial rotation. That route does not automatically turn an
SP3 into **ITRF (with ERP applied)** or unlock strict ECI.

## Reading a gravity-cache card

The **Gravity cache** card reports exactly what the runtime has validated; it
does not infer a gravity model from the selected degree. `Healthy` means the
published EGM96 or EGM2008 archive, its expected coefficient member, and its
local provenance have passed the bounded validation. It then displays the
`maxDegree`, `maxOrder`, `coverage`, `completeThroughDegree`, and
`tailMaxOrder` detected from the unpacked source. Those values—not the model
name—bound the selector. Before validation they are `null`, and the selector
fails closed instead of offering an invented numeric limit.

The EGM2008 parser uses a protective/advisory 2190 × 2190 input envelope. That
does not state that the archive contains a complete 2190 × 2190 field: the
validated coefficient profile is authoritative.

`Warning` can mean that a previously valid local archive is being retained
while the scheduled NGA refresh is unavailable. `Error` or an unavailable
model means there is no usable validated cache; **Full geopotential** then
stays unavailable and is never silently replaced by J2/J3/J4. An explicit
checksum-controlled ICGEM field has priority over the automatic cache.

The service may become healthy before the background gravity check completes.
Use **Refresh** or wait for the next monitor cycle instead of restarting solely
to wait for a download. A healthy gravity card proves cache integrity and a
small bounded force probe, not that the Python RK4 can execute a complete
mission-scale dense propagation or that strict ERP/ECI requirements are met.
