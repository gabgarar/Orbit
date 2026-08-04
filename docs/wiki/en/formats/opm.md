# OPM

[Home](../index.md) · [Formats](index.md) · [Cartesian states](../engineering/cartesian-states.md) · [Unsupported formats](unsupported-formats.md)

## Support status

Orbit does not implement Orbit Parameter Message (OPM) as an import,
export, status reader or propagation source.

No OPM message parser, metadata validation, conversion
state representations, maneuver treatment, covariance or selection
of OPM's own time frames and scales.

## Alternatives available

- For a manual work state, use the contract
  [keplerian elements](../engineering/keplerian-elements.md) or the state
  cartesian required by [Cowell](../propagation/cowell.md).
- For an externally sourced tabulated path, use Python readers from
  [OEM](oem.md) or [SP3](sp3.md), with its integration limitations of
  product.
- For catalog, use [TLE](tle.md) or [OMM](omm.md) with TLE embedded.

!!! warning "Do not use OPM as free JSON"

    Saving an OPM within a project or metadata does not make it processable by
    Orbit. There is no automatic conversion of those fields to `StateVector`.