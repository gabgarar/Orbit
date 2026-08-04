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