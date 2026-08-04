# Atmospheric drag

[Home](../index.md) · [Propagation](index.md) · [Cowell](cowell.md) · [Atmospheric model](../engineering/atmospheric-models.md)

## Availability

Drag is only available as `drag` term of `cowell-rk4`.
Not available in two bodies, analytical J2, the fixed preset J2+J3+J4 or
SGP4 configurable from Orbit.

## Model applied

With \(B=C_DA/m\), \(\rho\) density and velocity relative to one atmosphere
corrotant \(\mathbf v_{rel}\), Cowell applies:

$$
\mathbf a_{drag}=-\frac{1}{2}B\rho\lVert\mathbf v_{rel}\rVert\mathbf v_{rel}.
$$

The implementation calculates the relative speed using the term
Earth's rotation and evaluates a layered exponential density using the
height WGS-84. The internal calculation preserves km and km/s, with conversions for
maintain dimensional consistency with the drag parameters in SI.

$$
\mathbf v_{rel}=\mathbf v-\mathbf\omega_\oplus\times\mathbf r,
\qquad
\rho(h)=\rho_0\exp\left(-\frac{h-h_0}{H}\right).
$$

## Parameters

### Variables, units and Orbit use

Internal \(\mathbf r\) and \(\mathbf v\) use km and km/s; to evaluate \(\mathbf v_{rel}\), \(\rho\), and \(B=C_DA/m\), Orbit converts the required quantities to SI. \(\rho\) is kg/m³, \(C_D\) is dimensionless, \(A\) is m², \(m\) is kg, and acceleration returns to km/s² before Cowell adds it. \(h\), \(h_0\), and \(H\) use one common layer-length unit.

| Parameter | Unit | Restriction |
| --- | --- | --- |
| `drag_coefficient` | — | Finite and greater than zero; default value 2.2. |
| `area_m2` | m² | Finite and greater than zero; default value 1. |
| `mass_kg` | kg | Finite and greater than zero; default value 100. |

The ballistic coefficient used is \(C_DA/m\). If `force_terms` is used, you must
include `drag`; the inherited boolean `atmospheric_drag` does not add the term to
an explicit composition.

## Limits

- The density is set to zero from 1500 km.
- There is no solar flux, geomagnetic indices, wind, attitude, variable area or
  model NRLMSISE/JB2008/DTM.
- No decay precision or re-entry time is provided.

The model is useful to explore the qualitative effect of drag on orbits
manuals, not for operational prediction. See
[Atmospheric model](../engineering/atmospheric-models.md).

!!! warning "Equation planned for future implementation"

    **Advanced drag.** The current runtime includes neither MSIS nor
    solar-geomagnetic forcing. A future model could evaluate:

    $$
    \rho=\rho_{\mathrm{MSIS}}(h,\phi,\lambda,t,F_{10.7},\overline{F}_{10.7},A_p).
    $$

    Here \(h\) is height, \(\phi\)/\(\lambda\) are radians, \(t\) is epoch, and solar/geomagnetic indices use the MSIS product units. It is not evaluated by the current runtime.
