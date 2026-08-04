# Equinox elements

[Home](../index.md) · [Engineering](index.md) · [Keplerian elements](keplerian-elements.md) · [Orbital representations](orbit-representations.md)

## Support status

Orbit does not implement equinoctial elements such as entry, exit,
interpolation, conversion or display.

There is no published correspondence between interface fields and the
\((a,h,k,p,q,\lambda)\) set, nor a policy for middle elements versus
to osculators. Therefore, a file or an integration that delivers those
elements you must convert them out of Orbit to a Cartesian state with frame,
explicit time scale and epoch.

!!! warning "Do not use ad hoc fields"

    Do not store equinoctial elements in free metadata expecting the
    runtime propagates them. Orbit would treat them as non-operational information.

## Alternatives implemented

- [Cartesian States](cartesian-states.md) for status inputs and
  tabulated anniversaries.
- [Keplerian Elements](keplerian-elements.md) for manual designs
  two-body ellipticals or J2.
- [OEM](../formats/oem.md) or [SP3](../formats/sp3.md) for a trajectory
  tabulated, using the available Python readers.

The absence of this representation is deliberate: avoid publishing formulas of
conversion without an element type contract, framework and dynamic model.