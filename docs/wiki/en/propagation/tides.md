# Tides

[Home](../index.md) · [Propagation](index.md) · [Force models](force-models.md) · [Lunisolar perturbations](third-bodies.md)

## Support status

Orbit does not implement solid-Earth tide acceleration, ocean tides, or time-varying gravity-field terms. This page belongs to the gravitational group because those terms modify Earth's gravitational potential.

!!! warning "Equation planned for future implementation"

    A solid-tide model would correct harmonic coefficients as a function of the Sun and Moon positions:

    $$
    \Delta \bar C_{nm}(t),\ \Delta \bar S_{nm}(t)
    = f_{nm}\bigl(\mathbf r_{\odot}(t),\mathbf r_{\mathrm{Moon}}(t),k_n\bigr).
    $$

    | Symbol | Meaning | Unit |
    | --- | --- | --- |
    | \(\Delta \bar C_{nm},\Delta \bar S_{nm}\) | Corrections to normalized harmonic coefficients. | Dimensionless. |
    | \(n,m\) | Harmonic degree and order. | Dimensionless integers. |
    | \(\mathbf r_{\odot},\mathbf r_{\mathrm{Moon}}\) | Sun and Moon positions in a consistent frame and epoch. | km. |
    | \(k_n\) | Love number of degree \(n\). | Dimensionless. |

    It is not evaluated by the current runtime. It would require ephemerides, IERS conventions, and a gravity field beyond the current zonal terms.

## Limits

Using EOP for frame transformations does not enable tidal dynamics in Cowell. EOP support is used for Earth orientation, not as a tidal acceleration.
