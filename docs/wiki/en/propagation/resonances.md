# Resonances

[Home](../index.md) · [Propagation](index.md) · [Attitude](attitude.md)

## Support status

Orbit does not implement an orbital-resonance model. The available routes do
not detect, propagate or correct resonant angles.

!!! warning "Equation planned for future implementation"

    A resonant condition can be expressed with a critical angle and an
    approximately null derivative:

    $$
    \phi=k_1\lambda+k_2\lambda_b+k_3\varpi+k_4\Omega,
    \qquad \dot\phi\approx0.
    $$

## Future scope

Implementation would need a perturbing body, resonance family and reference
dynamical model. It must not be inferred from a visual trajectory.
