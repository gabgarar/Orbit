# Cowell: entry and forces

[Propagation](../index.md) · [Cowell](../cowell.md) · [Numerical Integrators](../numerical-integrators.md)

## Initial state

The constructor receives a UTC epoch and a manual Cartesian state in km and
km/s. Accept canonical keys:

```text
position_eme2000_km: {x, y, z}
velocity_eme2000_km_s: {x, y, z}
```

`position_eci_km` and `velocity_eci_km_s` are kept as legacy aliases,
interpreted with the same `EME2000` compatibility. The initial radius must
be outside the Earth and all components must be finite.

## Force composition

Central gravity is always included. The accepted terms are:

| Term | Identifier | Parameters |
| --- | --- | --- |
| Center | `central` | None. |
| Oblateness | `j2`, `j3`, `j4` | Internal WGS-84 coefficients. |
| Drag | `drag` | `drag_coefficient`, `area_m2`, `mass_kg`. |

`force_terms` can be a list or string. The inherited presets `two-body`,
`j2` and `j2-j3-j4` expand to the corresponding composition. one
Explicit composition prevails over inherited gravity fields and
drag.

## Related references

- [Force Models](../force-models.md)
- [Atmospheric Drag](../atmospheric-drag.md)
- [Gravity Models](../../engineering/gravity-models.md)