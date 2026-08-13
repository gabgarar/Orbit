# Solar radiation pressure

[Home](../index.md) · [Propagation](index.md) · [Force models](force-models.md) · [Third bodies](third-bodies.md)

## Scope and status

The available canonical term is <code>solar-radiation-pressure</code>.
It is a *cannonball* model: the satellite is represented by fixed effective
area, reflection coefficient \(C_R\), and mass. It includes a cylindrical-
eclipse illumination factor; it does not yet model attitude or penumbra.

<code>srp</code> is an input alias only. The Sun appearing in visualization
does not enable SRP, and <code>drag</code> is not a physical substitute for
solar radiation.

## Applied model

Let \(\mathbf r_\odot\) be the Earth→Sun geocentric vector and \(\mathbf r\)
the Earth→satellite vector. Photon direction at the satellite is the
Sun→satellite vector, \(\hat{\mathbf u}=(\mathbf r-\mathbf r_\odot)/d\). The
applied acceleration is:

$$
\mathbf a_{SRP}=\nu\,P_0\left(\frac{AU}{d}\right)^2
\frac{C_R A}{m}\,\hat{\mathbf u},
$$

where \(\nu\in[0,1]\) is illumination fraction. The result is computed in SI
and converted to km/s² before it is added to Cowell.

| Symbol | Meaning | Unit |
| --- | --- | --- |
| \(P_0\) | Reference solar pressure at 1 AU. | N/m². |
| \(AU\), \(d\) | Astronomical unit and Sun–satellite distance. | m. |
| \(C_R\) | Effective reflection coefficient. | Dimensionless. |
| \(A\), \(m\) | Reference area and mass. | m², kg. |
| \(\nu\) | Eclipse illumination. | 0 to 1. |
| \(\mathbf a_{SRP}\) | Solar-radiation acceleration. | km/s² in Cowell. |

## Cylindrical eclipse

Eclipse is determined geometrically with an Earth-radius cylinder aligned with
the Sun→Earth direction. If the satellite is behind Earth and its perpendicular
distance to the Sun–Earth axis is below the selected radius, \(\nu=0\); outside
it, \(\nu=1\). The model must reject non-finite or degenerate geometry.

This method is discontinuous and does not represent penumbra, solar diameter,
Earth oblateness, or refraction. It is suitable as a declared first-order model,
not for photometric transitions or mission-precision forces.

## Validation and provenance

- <code>area_m2</code>, <code>mass_kg</code>, and
  <code>solar_radiation_coefficient</code> must be finite and positive.
- Solar position must come from the same provider/epoch as the solar third-body
  term and honor its coverage.
- Acceleration must point away from the Sun when \(\nu>0\).
- Provenance records \(C_R\), area, mass, reference pressure, eclipse model,
  radius used, and solar provider.

## What remains deferred

There is no plate SRP, quaternions, variable projected area, self-shadow,
penumbra/antumbra, thermal absorption, or re-emission. These increments depend
on an [Attitude](attitude.md) model, spacecraft geometry, and an error-
controlled integrator near eclipse discontinuities.
