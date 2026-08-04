# Force models

[Home](../index.md) · [Propagation](index.md) · [Cowell](cowell.md) · [Gravity Models](../engineering/gravity-models.md)

## Composition implemented

Force composition is available only for `cowell-rk4`. gravity
central is mandatory; the other terms are selected explicitly.

| Term | Identifier | State |
| --- | --- | --- |
| Core Gravity | `central` | Available and always active. |
| J2 | `j2` | Available. |
| J3 | `j3` | Available. |
| J4 | `j4` | Available. |
| Atmospheric drag | `drag` | Available with exponential model. |
| Third bodies | — | Not available. |
| Solar radiation pressure | — | Not available. |
| Relativity | — | Not available. |
| Full geopotential | — | Not available. |

The total Cowell force is:

$$
\mathbf a=\mathbf a_{central}+\mathbf a_{J2}+\mathbf a_{J3}+\mathbf a_{J4}+\mathbf a_{drag},
$$

including only the selected terms.

## Model identity

### Variables, units and Orbit use

Each \(\mathbf a_i\) is calculated in km/s² in the Cowell core before forming \(\mathbf a\). The sum never adds absent terms by default: `force_terms` defines the subset, while `central` remains mandatory. Public output is then converted to SI in `StateVector`.

`model_id` remains `cowell-rk4`; `force_model_id` identifies the composition
applied. Exact equivalents of inherited presets retain a name
known (`two-body`, `j2`, `j2-j3-j4`); a different combination is reported
as sum of terms. This separation avoids confusing the technique of
integration with the forces used.

## Presets

| Legacy Entry | Resulting forces |
| --- | --- |
| `two-body` | `central` |
| `j2` | `central`, `j2` |
| `j2-j3-j4` | `central`, `j2`, `j3`, `j4` |

The drag inherited boolean is only used when translating a preset. for one
list `force_terms`, the presence or absence of `drag` is authoritative.

## Not to be confused with SGP4

SGP4 accepts a TLE and has its own model. Cowell terms do not apply
to an SGP4 catalog object nor are they used to correct a TLE.

See [Point mass](point-mass.md), [J2](j2.md), [J3](j3.md), [J4](j4.md) and
[atmospheric drag](atmospheric-drag.md), plus the unsupported capability pages
for [third bodies](third-bodies.md),
[SRP](solar-radiation-pressure.md) and [relativity](relativity.md).
