# Solar radiation pressure

[Home](../index.md) · [Propagation](index.md) · [Force models](force-models.md) · [Third bodies](third-bodies.md)

## Support status

Orbit does not implement solar radiation pressure (SRP) in any propagators.

There are no parameters for reflectivity coefficient, illuminated area,
occultation, eclipse, Sun-satellite geometry, solar ephemeris for force nor
associated attitude model. Viewing the Sun is not a source of SRP.

## Alternatives

- For arcs already calculated externally, use Python readers from
  [OEM](../formats/oem.md) or [SP3](../formats/sp3.md), without assuming integration
  Product UI/API.
- For manual studies within Orbit, limit interpretation to the
  forces documented in [Cowell](cowell.md).

`drag` should not be represented as a substitute for SRP: they are terms with origin,
different direction and physical dependence.

!!! warning "Equation planned for future implementation"

    A multi-surface SRP model could sum the illuminated faces:

    $$
    \mathbf a_{\mathrm{SRP}}=-P_\odot\left(\frac{\mathrm{AU}}{d_\odot}\right)^2
    \frac{1}{m}\sum_i A_i\max(0,\hat{\mathbf n}_i\cdot\hat{\mathbf s})
    C_{R,i}\hat{\mathbf s}.
    $$

    | Symbol | Meaning | Unit |
    | --- | --- | --- |
    | \(P_\odot\) | Reference solar pressure. | N/m². |
    | \(\mathrm{AU}\), \(d_\odot\) | Astronomical unit and Sun–satellite distance. | Same length unit. |
    | \(m\), \(A_i\) | Mass and area of face \(i\). | kg, m². |
    | \(\hat{\mathbf n}_i\), \(\hat{\mathbf s}\) | Face normal and solar direction. | Dimensionless. |
    | \(C_{R,i}\) | Reflectivity coefficient. | Dimensionless. |
    | \(\mathbf a_{\mathrm{SRP}}\) | SRP acceleration. | m/s², converted to km/s² in Cowell. |
