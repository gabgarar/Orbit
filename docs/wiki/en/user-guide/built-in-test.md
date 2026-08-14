# Built-In Test

[Home](../index.md) · [User Guide](index.md) · [Validation](../operations/validation.md)

The **Built-In Test** button, to the right of **Help**, opens a read-only
diagnostics panel. It does not start long propagations or alter an orbit: it
shows the last check published by the backend and the current scene state.

## Statuses and refresh

Each card shows **Healthy**, **Warning**, or **Error**, together with the last
validation time published by that component. **Refresh** queries
`/api/system/diagnostics` without blocking the interface; while the panel is
open it also refreshes periodically. Against an older backend the panel tries
`/api/diagnostics` and explicitly reports missing remote data instead of
inventing a healthy status.

## What it checks

| Card | Published information |
| --- | --- |
| ERP / EOP loader | Whether C01/C04 loaded, update date, provenance URL, coverage, and cache state. |
| SP3 and OEM | A real probe of their parsers; SP3 also includes product count and scene-known local EOP overlap. |
| Propagators and forces | Bounded deterministic probes for two-body energy, Cowell/RK4, J2/J3/J4, plus geopotential, drag, and SRP availability under the current time contract. |
| Time manager (MTR) | Master Time Range, clamp state, and active SP3/OEM scene layers. |
| Reference frames | ITRF-to-EME2000 probe, norm residual, and EOP quality of the available route. |
| CI/CD | Latest run that the public GitHub API could observe for `quality.yml`, `docs-pages.yml`, and `release.yml`. |

The GitHub monitor is optional and uses no credentials. If it is disabled, the
CI/CD card displays **Warning/Unknown**; use Actions directly when approving a
release.

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

