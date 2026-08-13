# Cowell: input and forces

[Propagation](../index.md) · [Cowell](../cowell.md) · [Numerical integrators](../numerical-integrators.md)

## Initial state

The constructor receives a `UTC` epoch and a manual Cartesian state in km and
km/s. Canonical keys are:

```text
position_eme2000_km: {x, y, z}
velocity_eme2000_km_s: {x, y, z}
```

`position_eci_km` and `velocity_eci_km_s` remain legacy aliases, interpreted
with the same `EME2000` compatibility. Initial radius must be outside Earth and
all components must be finite.

## Force composition

`central` is always included. The `force_terms` list is explicit and may contain
only supported identifiers. Available identifiers are:

| Term | Identifier | Parameters and contract |
| --- | --- | --- |
| Central | `central` | None; mandatory. |
| Legacy zonals | `j2`, `j3`, `j4` | Internal WGS-84 coefficients; compatibility. |
| Geopotential | `geopotential` | Configured ICGEM field, `degree`, `order`, strict EOP/leaps/ERFA. |
| Sun | `third-body-sun` | Locally computable solar ephemeris and valid epoch. |
| Moon | `third-body-moon` | Locally computable lunar ephemeris and valid epoch. |
| Drag | `drag` | `drag_coefficient`, `area_m2`, `mass_kg`. |
| SRP | `solar-radiation-pressure` | `solar_radiation_coefficient`, `area_m2`, `mass_kg`; declared eclipse. |
| Relativity | `relativity` | No user parameter; Earth Schwarzschild correction. |

`sun`, `moon`, and `srp` are input aliases for canonical identifiers. They must
not be persisted or published as a model identity.

!!! warning "Safety exclusions"

    `geopotential` cannot coexist with `j2`, `j3`, or `j4`. Physical
    parameters must be finite and strictly positive where applicable: area,
    mass, \(C_D\), and \(C_R\). The operation must fail before integration, not
    silently repair invalid values.

## Shared physical parameters

| Parameter | Unit | Use |
| --- | --- | --- |
| `area_m2` | m² | Reference area for drag and/or SRP. |
| `mass_kg` | kg | Mass for drag and/or SRP. |
| `drag_coefficient` | — | \(C_D\), for `drag` only. |
| `solar_radiation_coefficient` | — | \(C_R\), for SRP only. |
| `degree`, `order` | — | ICGEM geopotential limits; with `geopotential`, `degree` must be at least 2. |

The presence of a parameter does not activate a force. For example, supplying
`area_m2` does not enable either drag or SRP unless their identifiers appear in
`force_terms`.

## Legacy presets

`two-body`, `j2`, and `j2-j3-j4` expand to their historical compositions. An
explicit `force_terms` list overrides presets and legacy fields. Existing
presets are not upgraded to full geopotential because that would change their
physical result and provenance.

## Validation before integration

Before a propagator is created, Orbit must check state, parameters,
incompatibilities, auxiliary-data availability, and temporal coverage. In
particular, `geopotential` must be rejected if the strict ITRF path is absent;
Sun/Moon/SRP must be rejected outside their ephemeris' published coverage. See
[Force models](../force-models.md) for per-model validation.
