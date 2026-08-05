# Gravity models

[Home](../index.md) · [Engineering](index.md) · [Earth Models](earth-models.md) · [Force Models](../propagation/force-models.md)

## Available models

Gravity models are applied in manual propagation. The TLE catalog
uses SGP4 and does not accept this composition as an operational selector.

| Model | Implementation | Usage |
| --- | --- | --- |
| Center | \(-\mu\mathbf r/r^3\) | Two bodies and mandatory term from Cowell. |
| J2, J3, J4 numeric | Non-normalized zonal harmonics WGS-84 | Cowell independent terms or historical preset. |
| Full geopotential | Not available | There are no \(C_{nm},S_{nm}\) coefficients or configurable degree/order. |

## Cowell zonal terms

Cowell always maintains central gravity and can compose `j2`, `j3` and
`j4`. The coefficients included are:

| Coefficient | Value |
| --- | ---: |
| \(J_2\) | \(1.08262668355315\times10^{-3}\) |
| \(J_3\) | \(-2.53265648533224\times10^{-6}\) |
| \(J_4\) | \(-1.61962159136700\times10^{-6}\) |

The zonal potential is implemented from the Legendre polynomials to
degrees 2 to 4. The axis \(z\) of the terms is treated as the axis of rotation
terrestrial compatible with the first order inertial framework; not entered
a complete dynamic transformation of forces to the earth frame.

## Selection

| Route | Selection available |
| --- | --- |
| Two bodies | Central gravity only. |
| `cowell-rk4` | `central`, `j2`, `j3`, `j4` and `drag` as explicit terms. |
| `j2-j3-j4` | Fixed historical preset J2+J3+J4, without drag. |

The legacy names `two-body`, `j2`, and `j2-j3-j4` are normalized to their
Cowell composition when used as an `cowell-rk4` preset.

!!! warning "This is not a mission geopotential"

    The J2/J3/J4 composition does not represent a complete field nor does it replace a
    high fidelity propagation, OD or mission validation. There are no terms
    tesseral/sectoral, tides, temporal variation or degree and order configurable.
