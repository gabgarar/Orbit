# Built-In Test

[Home](../index.md) · [User Guide](index.md) · [Validation](../operations/validation.md)

The **Built-In Test (BIT)** icon, to the right of **Help**, opens a read-only
diagnostics panel. It does not start long propagations or alter an orbit: it
shows the **IBIT** initial-startup result and Orbit's current continuous state.

## Statuses and refresh

BIT polls `/api/system/diagnostics` continuously from application startup,
including while its panel is closed. The icon dot summarizes visible
components; **Refresh** only requests an immediate non-blocking poll. Each
card shows **Healthy**, **Warning**, or **Error**, together with the last
validation time published by that component. Against an older backend it tries
`/api/diagnostics` and explicitly reports missing remote data instead of
inventing a healthy status.

## What it checks

| Card | Published information |
| --- | --- |
| Runtime monitor | Whether the service's continuous check loop is still running; a failure here is never hidden merely because scene products are absent. |
| ERP / EOP loader | Whether C01/C04 loaded, update date, provenance URL, coverage, and cache state. |
| Initial IBIT | Startup result, explicit `ready`/`projectReady` decision, published steps, warnings, errors, timestamps, and known progress. It is marked **Passed** only after an explicit terminal and ready ledger. |
| SP3, OEM, and MTR | Shown only when the scene contains the respective product or range. SP3 also includes product count and scene-known local EOP overlap. |
| Propagators and forces | Bounded deterministic probes for two-body energy, Cowell/RK4, J2/J3/J4, plus geopotential, drag, and SRP availability under the current time contract. |
| Gravity cache | Per-model EGM96/EGM2008 source, local cache and coefficient-file state, digest, detected `maxDegree`/`maxOrder` and coverage profile, freshness/fallback state, and any validation error. |
| Time manager (MTR) | Master Time Range, clamp state, and active SP3/OEM scene layers. |
| Reference frames | ITRF-to-EME2000 probe, norm residual, and EOP quality of the available route. |
BIT does not show CI/CD: a downloadable delivery must already originate from
an approved CI/CD revision. Runtime operational checks must not be confused
with release approval.

## Reading the initial IBIT

The **initial IBIT** block is the source of truth for whether Orbit may
accept gated project work. `ready: true` / `projectReady: true` are required;
the state is normally `ready`, or `degraded-ready` with its visible caveat. A
container healthcheck, a card marked Healthy, or a terminal warning does not
replace that decision. When it is `pending` or `blocked`, inspect
`requiredSteps` and `blockers` rather than guessing which data are still
missing.

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

## Initial BIT notice when Orbit opens

When the terminal **initial BIT check** ledger (also called PBIT or initial
IBIT) publishes one or more warnings but no blocking error, Orbit shows a
compact, non-modal card when the application opens. It summarizes up to three
actionable reasons and offers
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
keeping the last valid copy. If no valid copy exists, visualization may use
nominal terrestrial rotation. That route does not automatically turn an SP3
into **ITRF (with ERP applied)** or unlock strict ECI.

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
