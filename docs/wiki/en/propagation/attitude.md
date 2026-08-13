# Attitude

[Home](../index.md) · [Propagation](index.md) · [Resonances](resonances.md)

## Status

Orbit does not propagate attitude. The planned SRP cannonball model uses fixed
effective area; it must not be interpreted as rigid-body dynamics or as a
substitute for quaternions.

## Deferred work

| Capability | Later use |
| --- | --- |
| Quaternion state and kinematics | Orient body without Euler singularities. |
| Euler equations and inertia tensor | Rigid rotation and torque response. |
| Actuators and control laws | Wheels, magnetorquers, propulsion, and maneuvers. |
| Plate geometry | Projected drag/SRP area, self-shadow, and temperature. |
| Translation–attitude coupling | Orientation-dependent forces at every stage. |
| Events and validation | Eclipse entry/exit, saturation, and reference cases. |

Future mathematical basis requires:

$$
\dot{\mathbf q}=\frac{1}{2}\Omega(\mathbf\omega)\mathbf q,
\qquad I\dot{\mathbf\omega}+\mathbf\omega\times(I\mathbf\omega)=\mathbf\tau.
$$

Until then, drag/SRP mass and area are constant parameters, and orientation is
not part of state uncertainty or provenance.
