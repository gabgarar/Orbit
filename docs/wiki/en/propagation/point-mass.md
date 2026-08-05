# Point mass gravity

[Home](../index.md) · [Propagation](index.md) · [Two bodies](two-body.md) · [Force models](force-models.md)

## Model

Earth's central gravity is the base term for manual models:

$$
\mathbf a_{central}=-\mu\frac{\mathbf r}{r^3}.
$$

Orbit uses \(\mu=398600.4418\ \mathrm{km^3/s^2}\) in classic modules and
Cowell. The central term is always active in Cowell, even if the list
of forces only mentions disturbances.

## Usage

### Variables, units and Orbit use

\(\mathbf r\) is evaluated in km and \(\mu=398600.4418\ \mathrm{km^3/s^2}\) inside the classical propagators; \(\mathbf a_{central}\) is therefore km/s². Before constructing a `StateVector`, Orbit converts position and velocity to m and m/s. The term is evaluated at every Cowell RK4 step and is the entire two-body dynamics.

| Route | Application |
| --- | --- |
| Two bodies | It is the entire dynamic and is resolved analytically. |
| Cowell | Acceleration calculated in each RK4 evaluation. |
| J2+J3+J4 | Base of numerical preset. |

The model assumes a punctual body and does not include oblateness, density,
third bodies or non-gravitational force. For J2/J3/J4 consult
[Gravity models](../engineering/gravity-models.md).
