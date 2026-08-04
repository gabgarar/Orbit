# Attitude

[Home](../index.md) · [Propagation](index.md) · [Resonances](resonances.md)

## Support status

Orbit does not propagate attitude. There is no quaternion state, rigid-body
dynamics, actuator model or coupling between attitude, exposed area and force.

!!! warning "Equation planned for future implementation"

    An attitude model would require at least quaternion kinematics and the
    Euler equation for a rigid body:

    $$
    \dot{\mathbf q}=\frac{1}{2}\Omega(\mathbf\omega)\mathbf q,
    \qquad I\dot{\mathbf\omega}+\mathbf\omega\times(I\mathbf\omega)=\mathbf\tau.
    $$

## Future scope

Attitude is required before enabling multi-surface SRP, variable drag area, or
physically consistent sensor and actuator models.
