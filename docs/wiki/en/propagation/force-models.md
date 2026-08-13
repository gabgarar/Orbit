# Force models

[Home](../index.md) · [Propagation](index.md) · [Cowell](cowell.md) · [Gravity models](../engineering/gravity-models.md)

## Composition contract

Force composition belongs to `cowell-rk4`. The state is integrated in
`EME2000`, and every term returns an acceleration in km/s² in that same frame.
Central gravity is mandatory; `force_terms` describes additional terms only. An
unrequested term is never added implicitly.

| Group | Term | Canonical identifier | Status |
| --- | --- | --- | --- |
| Gravitational | [Central gravity](point-mass.md) | `central` | Available and mandatory. |
| Gravitational | [Historical zonals](j2.md) | `j2`, `j3`, `j4` | Available for compatibility; not a configurable gravity field. |
| Gravitational | [Degree-and-order geopotential](full-geopotential.md) | `geopotential` | Available with identified local ICGEM field and strict terrestrial path. |
| Gravitational | [Solar third body](third-bodies.md) | `third-body-sun` | Available with approximate `eraEpv00`, coverage, and provenance. |
| Gravitational | [Lunar third body](third-bodies.md) | `third-body-moon` | Available with approximate `eraMoon98`, coverage, and provenance. |
| Gravitational | [Tides](tides.md) | — | Deferred. |
| Non-gravitational | [Exponential drag](atmospheric-drag.md) | `drag` | Available; low-fidelity exploratory model. |
| Non-gravitational | [Solar radiation pressure](solar-radiation-pressure.md) | `solar-radiation-pressure` | Available: cannonball model and cylindrical umbra. |
| Non-gravitational | [Earth albedo / IR](albedo.md) | — | Deferred. |
| Relativistic | [Earth Schwarzschild term](relativity.md) | `relativity` | Available; not full general relativity. |

`sun`, `moon`, and `srp` are input-compatibility aliases only. Metadata and the
API must publish the canonical identifiers above.

!!! warning "Do not double-count gravity"

    `geopotential` includes the zonal harmonics carried by its field. It must
    not be combined with `j2`, `j3`, or `j4`, because the same effect would be
    applied twice. Historical zonals remain for existing projects and presets,
    not as a replacement for an ICGEM field.

## Frames, epoch, and auxiliary data

Not every model is evaluated in the same physical frame. Orbit's rule is:

1. Integrate the Cartesian state in `EME2000`.
2. At **every RK4 stage**, transform the state to `ITRF` at that stage epoch
   for every Earth-bound term.
3. Evaluate the terrestrial model's free acceleration there.
4. Rotate only that acceleration back to `EME2000` and add it to the derivative.

The Earth-bound-term flow is:

```text
EME2000 (r, v, t) ──strict transformation──> ITRF (r, v, t)
       │                                        │
       └── R_ITRF→EME2000(t) · a_ITRF(r, v, t) ─┘
```

Integration is **not** performed in ITRF. Integrating there would require
Coriolis, centrifugal, and Euler fictitious forces. Rotating the free
acceleration to the inertial frame avoids introducing those terms partially or
incorrectly.

Enabling a high-fidelity terrestrial term requires all of the following, with a
hard failure if any is missing:

- EOP covering the epoch, including <span class="arithmatex">\(x_p\)</span>, <span class="arithmatex">\(y_p\)</span>, and UT1−UTC;
- a local, versioned, integrity-checked, unexpired leap-second snapshot with
  temporal coverage;
- ERFA/SOFA for IAU 2006/2000A reduction;
- declared terrestrial realization and, where applicable, a realization
  alignment route from product realization to ITRF;
- provenance for the source file and the applied degree/order configuration.

There is no visual or approximate fallback for `geopotential`: if the strict
path is unavailable, selection must fail explicitly. This does not itself turn
fixed-step RK4 into an operational propagator; it prevents claiming that an
Earth orientation was applied when it was not.

## Result identity and provenance

`model_id` remains `cowell-rk4`. `force_model_id` identifies the effective
composition. When applicable, provenance must record:

- canonical term identifiers;
- for geopotential: model, source, file digest, normalization,
  <span class="arithmatex">\(\mu\)</span>, reference radius, and applied degree/order;
- for EOP: provider, interval, and coverage quality;
- for leap seconds: version, digest, and expiry date;
- for Sun/Moon: ephemeris provider, validity interval, and constants;
- for SRP: <span class="arithmatex">\(C_R\)</span>, area, mass, and eclipse model;
- for relativity: formulation and constants.

A result without that provenance is a visualization, not evidence that a
specific physical configuration was applied.

## Legacy presets

| Legacy input | Resulting forces |
| --- | --- |
| `two-body` | `central` |
| `j2` | `central`, `j2` |
| `j2-j3-j4` | `central`, `j2`, `j3`, `j4` |

These presets do not automatically become `geopotential`; doing so would change
their historical behavior. The legacy drag boolean is only used while
translating a preset. For `force_terms`, the explicit list is authoritative.

## Do not confuse this with SGP4

SGP4 accepts a TLE and has its own dynamics contract. Cowell terms neither
apply to an SGP4 catalog object nor correct a TLE. A future propagator
comparison must fix epoch, frame, units, auxiliary data, and error contract
before interpreting a difference.

See each model page for its equations, restrictions, and required data.
