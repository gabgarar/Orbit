# Full geopotential

[Home](../index.md) · [Propagation](index.md) · [Gravity Models](../engineering/gravity-models.md) · [J2](j2.md)

## Support status

Orbit does not implement a full geopotential.

There is no harmonic coefficient reader \(C_{nm}\) and \(S_{nm}\), selection of
model, degree, order, normalization, tides, temporal variation or evaluation
of tesseral and sectoral terms. The only gravitational disturbances
Available numerical codes are the zonal harmonics J2, J3 and J4 of the Cowell model.

## Operational consequence

A J2/J3/J4 composition should not be interpreted as a truncation
configurable of a complete gravitational field. The available coefficients
are internal constants, not a versioned gravity product or API.
Earth model.

## Alternatives available

- [Two bodies](two-body.md) for an idealized orbit.
- [J2](j2.md) for the secular approximation or the numerical term J2.
- [Cowell](cowell.md) with J2/J3/J4 for first order sensitivity.
- [OEM](../formats/oem.md) or [SP3](../formats/sp3.md) when needed
  consume a trajectory already tabulated by an external system.

!!! warning "Does not replace external validation"

    Analyzes requiring geopotential of controlled degree and order should
    be done in a tool or service that implements and documents that
    model. Orbit does not offer a silent approach.

!!! warning "Equation planned for future implementation"

    A degree-and-order \(N\) geopotential would require a spherical-harmonic
    expansion and its gradient:

    $$
    U(r,\phi,\lambda)=\frac{\mu}{r}\left[1+\sum_{n=2}^{N}
    \left(\frac{R_\oplus}{r}\right)^n\sum_{m=0}^{n}\bar P_{nm}(\sin\phi)
    \left(\bar C_{nm}\cos m\lambda+\bar S_{nm}\sin m\lambda\right)\right],
    \qquad \mathbf a=-\nabla U.
    $$

    | Symbol | Meaning | Unit |
    | --- | --- | --- |
    | \(U\) | Gravitational potential. | km²/s². |
    | \(r\) | Object geocentric distance. | km. |
    | \(\phi\), \(\lambda\) | Geocentric latitude and longitude. | rad. |
    | \(\mu\) | Earth gravitational parameter. | km³/s². |
    | \(R_\oplus\) | Reference equatorial radius. | km. |
    | \(n\), \(m\), \(N\) | Expansion degree, order, and upper limit. | Dimensionless. |
    | \(\bar P_{nm}\), \(\bar C_{nm}\), \(\bar S_{nm}\) | Normalized Legendre polynomial and harmonic coefficients. | Dimensionless. |
    | \(\mathbf a\) | Resulting acceleration. | km/s². |

    Orbit does not yet evaluate this expression: `cowell-rk4` only applies
    central gravity, J2, J3, J4, and drag. The table fixes the units a future
    implementation must respect before normalising output state to SI.
