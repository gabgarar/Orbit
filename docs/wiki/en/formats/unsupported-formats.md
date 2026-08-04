# Unsupported formats

[Home](../index.md) · [Formats](index.md) · [Overview](overview.md) · [Propagation](../propagation/overview.md)

## Policy

A format is not considered supported simply because Orbit has a
project tree, a simplified exporter, or a format name in a
interface. Compatibility requires a parser, a time/frame contract,
validation and a verifiable operational path.

## Current status

| Format or capacity | State | Documented alternative |
| --- | --- | --- |
| [OPM](opm.md) | Not available. | Manual or external OEM/SP3 status. |
| [CPF](cpf.md) | Not available. | External OEM, no CPF charge. |
| [RINEX](rinex.md) | Not available. | External processing and ephemeris supported. |
| Pure OEM as Catalog Object, API Provider or `OrbitRuntime` Source | Not available. | The display can show a local and transient OEM track; the internal Python reader is documented in [OEM](oem.md). |
| SP3 in UI/API | Not available. | Internal Python reader [SP3](sp3.md). |
| OMM without embedded TLE | Not available as a catalogue. | TLE or OMM with both lines. |
| Complete OCM | Not available. | The gateway only exports a simplified JSON. |

## Cross constraints

- There is no automatic conversion between source terrestrial realizations.
- There is no covariance propagation, OD, filtering or treatment of measures.
- There is no extension of formats through published backend plugins.
- There is no guarantee that a file kept as a project attachment will be
  restored or executed as a source of ephemeris.

## Responsible use of alternatives

External sources must be converted before entering Orbit and retain
its epoch metadata, time scale, frame, realization, center, units
and provenance. See [Cartesian States](../engineering/cartesian-states.md)
and [Reference Frames](../engineering/reference-frames.md) before relabeling
a vector.

!!! warning "Do not replace a format with a label"

    Marking an entry as `OEM`, `SP3`, or `OPM` does not activate a reader. The
    catalog runtime operates with TLE/SGP4; Python tab readers are
    explicitly independent of that product route.