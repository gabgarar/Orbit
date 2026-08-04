# Third bodies

[Home](../index.md) · [Propagation](index.md) · [Force Models](force-models.md) · [Cowell](cowell.md)

## Support status

Orbit does not implement third-body accelerations. The Sun and the Moon can
be part of the visualization, but its visual presence does not add strength
gravity to the propagators.

There are no planetary ephemeris for integration, selection of bodies,
external gravitational coefficients, third body tides or correction
indirectly due to a barycentric origin.

## Alternatives available

- Use [Two Body](two-body.md) or [Cowell](cowell.md) within range of
  documented forces.
- Consume a [OEM ephemeris](../formats/oem.md) or [SP3](../formats/sp3.md)
  that has been produced externally, taking into account that those readers
  Python are not integrated into the product UI/API.

There is no hidden parameter to activate solar or lunar forces in Cowell.