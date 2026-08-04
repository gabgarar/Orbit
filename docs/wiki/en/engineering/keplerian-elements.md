# Keplerian elements

[Home](../index.md) · [Engineering](index.md) · [Orbital representations](orbit-representations.md) · [Two bodies](../propagation/two-body.md)

## Manual entry contract

`ClassicalElements` represents elliptical, geocentric and mean elements.
linked to the era of a manual orbit. The public entrance is expressed in km and
degrees; the propagator produces native states in `EME2000`.

| Input field | Symbol | Unit | Constraint validated |
| --- | --- | --- | --- |
| `semi_major_axis_km` | \(a\) | km | \(a>0\). |
| `eccentricity` | \(e\) | — | \(0\le e<1\). |
| `inclination_deg` | \(i\) | degrees | \(0\le i\le180\). |
| `raan_deg` | \(\Omega\) | degrees | It is normalized to \([0,2\pi)\). |
| `argument_of_perigee_deg` | \(\omega\) | degrees | It is normalized to \([0,2\pi)\). |
| `mean_anomaly_deg` | \(M\) | degrees | It is normalized to \([0,2\pi)\). |

The perigee radius must comply with \(a(1-e)>R_e\), with the equatorial radius
terrestrial used by the model. Validation avoids starting a manual orbit
inside the Earth.

## Two-body dynamics

For the idealized model:

$$
n=\sqrt{\frac{\mu}{a^3}}, \qquad M(t)=M_0+n\Delta t,
$$

where \(\mu=398600.4418\ \mathrm{km^3/s^2}\) is the Earth constant
used by the classic module. The elliptic Kepler equation is solved by
Newton with a maximum of 64 iterations and correction tolerance
\(10^{-13}\).

The perifocal state is rotated with \(R_3(\Omega)R_1(i)R_3(\omega)\) to the frame
`EME2000`. Historical function names that include `eci` are
They remain only as adapters; they do not change the declared framework.

## Use by J2 model

The J2 compatibility propagator keeps \(a\), \(e\) and \(i\) constant and
applies secular rates to \(\Omega\), \(\omega\) and \(M\). Not an integrator
numerical nor does it incorporate energy loss. See [J2](../propagation/j2.md).

## Cases not represented

- Parabolic and hyperbolic orbits.
- Osculating elements derived from an anniversary in general.
- Equinox elements, Delaunay, Brouwer-Lyddane and mean variations of
  other models.
- Covariances in the space of elements.

For a manual state with numerical perturbations, use the Cartesian contract
by [Cowell](../propagation/cowell.md).