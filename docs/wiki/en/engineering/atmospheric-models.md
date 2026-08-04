# Atmospheric model

[Home](../index.md) · [Engineering](index.md) · [Atmospheric Drag](../propagation/atmospheric-drag.md) · [Earth Models](earth-models.md)

## Support status

The only atmospheric model implemented is an exponential atmosphere by
layers, used exclusively by the `drag` propagator term
[`cowell-rk4`](../propagation/cowell.md).

The density is evaluated as:

$$
\rho(h)=\rho_0\exp\left(-\frac{h-h_0}{H}\right),
$$

where \(h_0\), \(\rho_0\) and \(H\) come from an internal anchor table of
US Standard Atmosphere style altitude. The table includes layers from 0 km to
1000 km; from 1500 km the density is set to zero.

## Interaction with Cowell

### Variables, units and Orbit use

\(h\), \(h_0\), and \(H\) use one common length unit; \(\rho\) is kg/m³. Cowell converts quantities from its km/km·s⁻¹ internal state to remain consistent with SI drag parameters, and returns acceleration to the core in km/s².

- The height is estimated with the WGS-84 ellipsoid.
- The atmosphere is considered corrotant with the Earth.
- Relative speed uses \(\mathbf v-\mathbf\omega\times\mathbf r\).
- User provides drag coefficient, reference area and mass;
  they must all be finite and greater than zero.
- The term is enabled explicitly within `force_terms` or through
  a preset inherited with `atmospheric_drag`.

## Limits

No models NRLMSISE, JB2008, DTM, space weather, solar flux,
geomagnetic indices, wind, high fidelity density, attitude or area
variable. The model is intended for sensitivity studies and views
limited range interactive predictions, not operational decay prediction.

See [Atmospheric Drag](../propagation/atmospheric-drag.md) for the
equation and the propagator restrictions.
