# Relativity

[Home](../index.md) · [Propagation](index.md) · [Force models](force-models.md) · [Reference frames](../engineering/reference-frames.md)

## Scope and status

The available canonical term is <code>relativity</code>. It adds the
first-order Schwarzschild post-Newtonian correction of Earth's potential to
Cowell's geocentric state. It does not change the propagator time scale or turn
a manual orbit into a complete relativistic solution.

## Schwarzschild correction

With Earth \(\mu\), \(\mathbf r\) and \(\mathbf v\) in <code>EME2000</code>, and
speed of light \(c\), the applied correction is:

$$
\mathbf a_{\mathrm{Schw}}=
\frac{\mu}{c^2r^3}
\left[
\left(\frac{4\mu}{r}-\mathbf v\cdot\mathbf v\right)\mathbf r
+4(\mathbf r\cdot\mathbf v)\mathbf v
\right].
$$

| Symbol | Meaning | Unit |
| --- | --- | --- |
| \(\mu\) | Earth gravitational parameter. | km³/s². |
| \(\mathbf r\), \(r\) | Geocentric position and norm. | km. |
| \(\mathbf v\) | Geocentric velocity. | km/s. |
| \(c\) | Speed of light. | km/s. |
| \(\mathbf a_{\mathrm{Schw}}\) | Added post-Newtonian correction. | km/s². |

The correction is added once, in addition to <code>central</code>. It validates
that vectors and acceleration are finite; it has no user parameters.

## Frame, time, and magnitude

The expression is evaluated directly in the inertial frame coherent with
<code>EME2000</code>, at every RK4 stage epoch. Its formula does not require
ITRF or EOP, but it does require a time scale and frame consistent with the
rest of integration. Its magnitude is small compared with central gravity: it
must not be used to hide a frame, EOP-data, or integrator inconsistency.

## Explicit exclusions

This term does not include:

- Lense–Thirring, relativistic quadrupole, multipolar effects, or a rotating-
  central-body dynamics model;
- complete relativistic transformations between TCG, TCB, TDB, and TT;
- relativistic corrections for GNSS clocks, observables, SGP4, OEM, or SP3;
- relativistic STM/covariance propagation.

Requirements needing those effects must declare their specific model and time
scale; they must not be inferred from enabling <code>relativity</code>.
