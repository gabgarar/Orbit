# Atmospheric drag

[Home](../index.md) · [Propagation](index.md) · [Cowell](cowell.md) · [Atmospheric model](../engineering/atmospheric-models.md)

## Availability

Drag is available as the <code>drag</code> term of <code>cowell-rk4</code>. It
is not available in two body, the fixed J2+J3+J4 preset, or configurable SGP4
from Orbit.

Unlike historical zonals, drag is evaluated in instantaneous ITRF **at every
RK4 stage**. It therefore fails closed if a strict EOP, leap-second, and
ERFA/SOFA route is absent. It does not fall back to a fixed <code>EME2000</code>
atmosphere.

## Applied model

With \(B=C_DA/m\), density \(\rho\), and velocity relative to a co-rotating
atmosphere \(\mathbf v_{rel}\), Cowell applies:

$$
\mathbf a_{drag}=-\frac{1}{2}B\rho\lVert\mathbf v_{rel}\rVert\mathbf v_{rel}.
$$

| Symbol | Meaning | Unit |
| --- | --- | --- |
| \(\mathbf a_{drag}\) | Drag acceleration added to Cowell. | km/s². |
| \(B=C_DA/m\) | Area-normalized ballistic coefficient. | m²/kg. |
| \(C_D\) | Drag coefficient. | Dimensionless. |
| \(A\), \(m\) | Reference area and mass. | m², kg. |
| \(\rho\) | Atmospheric density. | kg/m³. |
| \(\mathbf v_{rel}\) | Velocity against co-rotating atmosphere. | m/s during calculation. |

## Frame and stage sequence

For every RK4 evaluation \(f(t,\mathbf y)\), Orbit:

1. transforms position and velocity from <code>EME2000</code> to ITRF at the
   stage epoch;
2. computes WGS-84 height, layer density, and
   \(\mathbf v_{rel}=\mathbf v-\boldsymbol\omega_\oplus\times\mathbf r\) in ITRF;
3. computes \(\mathbf a_{drag,ITRF}\) in SI and converts it to km/s²;
4. rotates free acceleration to <code>EME2000</code> before adding the
   derivative.

Velocity is transformed as a state — including time derivative of the matrix —
whereas drag acceleration returns as a free vector. Orbit does not integrate in
ITRF and therefore does not implicitly mix Coriolis, centrifugal, or Euler
fictitious terms.

The route requires EOP coverage, DUT1 and polar motion, a local versioned valid
leap-second table, and ERFA/SOFA IAU 2006/2000A. If any is absent, selecting
<code>drag</code> must return an explicit error before integration.

## Parameters

| Parameter | Unit | Constraint |
| --- | --- | --- |
| <code>drag_coefficient</code> | — | Finite and greater than zero; default 2.2. |
| <code>area_m2</code> | m² | Finite and greater than zero; default 1. |
| <code>mass_kg</code> | kg | Finite and greater than zero; default 100. |

The coefficient used is \(C_DA/m\). If <code>force_terms</code> is used, it
must include <code>drag</code>; legacy boolean <code>atmospheric_drag</code>
does not add the term to explicit composition.

## Limits

- Density is zero above 1500 km.
- It is a WGS-84 layered exponential atmosphere; there is no solar flux,
  geomagnetic indices, winds, attitude, variable area, NRLMSISE, JB2008, or DTM.
- It publishes no decay, re-entry, or operational-drag accuracy.
- Fixed-step RK4 does not locate exact re-entry time or resolve rapid density
  changes.

The model allows drag exploration in a physically coherent terrestrial frame,
but its density remains low fidelity. Rigorous EOP do not replace a mission
atmospheric model.
