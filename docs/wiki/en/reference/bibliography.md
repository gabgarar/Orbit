# Bibliography

## Use of references

External sources place the standards, conventions and algorithms that
appear in Orbit. Citing a source does not imply that Orbit implements all of its
coverage, its optional profiles or its precision levels. Availability
concrete is defined by the contracts and limits of the application.

## Frames, Earth Orientation and Time

| Reference | Application in Orbit |
| --- | --- |
| Petit, G.; Luzum, B. (eds.). [IERS Conventions (2010), IERS Technical Note 36](https://www.iers.org/SharedDocs/Publikationen/EN/IERS/Publications/tn/TechnNote36/tn36.pdf?__blob=publicationFile&v=1). | Terminology and conventions for celestial/terrestrial frames, orientation and time scales. |
| IERS. [Conventions Centre](https://www.iers.org/iers/en/dataproducts/conventions/conventions). | Editorial status of conventions and associated updates. |
| IERS. [EOP 20u24 C04, product and metadata](https://datacenter.iers.org/products/eop/long-term/c04_20u24/). | Recommended source for local C04 snapshots with DUT1, polar motion, and `dX`/`dY`; the exact revision and hash must be pinned. |
| IERS/USNO. [Bulletin A](https://maia.usno.navy.mil/products/bulletin-a). | Future route for rapid EOP and predictions; Orbit does not import it directly. |
| IERS. [ITRS and ITRF](https://www.iers.org/iers/en/dataproducts/itrs/itrs). | Distinction between conceptual earth system and its realizations. |
| IAU SOFA. [Standards of Fundamental Astronomy](https://www.iausofa.org/). | Basis of astronomical reference routines. |
| ERFA. [Essential Routines for Fundamental Astronomy](https://github.com/liberfa/erfa). | Free implementation of SOFA routines used through `pyerfa`. |
| IETF. [RFC 5905 — Network Time Protocol](https://www.rfc-editor.org/rfc/rfc5905). | Context for the `leap-seconds.list` NTP/IERS format that Orbit can read. |

## Orbital propagation

| Reference | Application in Orbit |
| --- | --- |
| Vallado, D. A.; Crawford, P.; Hujsak, R.; Kelso, T. S. [Revisiting Spacetrack Report #3](https://celestrak.org/publications/AIAA/2006-6753/), AIAA 2006-6753. | Reference SGP4 theory and test cases used for TLE. |
| CelesTrak. [SGP4 Theory and Software Documentation](https://celestrak.org/software/tskelso-sw.php). | Supplementary SGP4 implementation and compatibility material. |

Orbit's two-body and Cowell/RK4 propagators are implementations with
limited scope. It should not be deduced from the above references that Orbit
include mission validation, orbit determination, estimation of
uncertainty or all force models in an astrodynamics library
general.

## Exchange formats

| Reference | Application in Orbit |
| --- | --- |
| CCSDS. [Active Publications — Orbit Data Messages, CCSDS 502.0-B-3](https://ccsds.org/publications/allpubs/). | Regulatory context of OMM, OEM and OCM. Orbit implements only the profiles and routes described in its documentation. |
| CCSDS. [Orbit Data Messages, 502.0-B-3](https://public.ccsds.org/Pubs/502x0b3e1.pdf). | Reference document for the ODM family. |
| International GNSS Service. [IGS20 and product transition](https://igs.org/news/igs20/). | Context of IGS20, igs20.atx and its relationship with ITRF2020. |
| International GNSS Service. [Reference Frame Working Group](https://igs.org/wg/reference-frame/). | Information on IGS achievements, stations and reference products. |
| International GNSS Service. [ITRF2020→IGS20 parameters](https://files.igs.org/pub/station/coord/IGS20/ITRF2020_to_IGS20.txt). | Source of published parameters for Orbit's optional global alignment. |
| International GNSS Service. [IGS products](https://igs.org/products/). | Reference for ERP products associated with GNSS series; Orbit retains the ERP explicitly selected with SP3 and never downloads or pairs it automatically. |
| ISO. [ISO 8601 — date and time formats](https://www.iso.org/iso-8601-date-and-time-format.html). | Sharing convention for moments sent to the API. |

## Repository implementation sources

| Resource | Content |
| --- | --- |
| `server/python/orbit_api/frames/` | `StateVector` contract, terrestrial transformations and realizations. |
| `server/python/orbit_api/timekeeping/` | Scales, leap seconds, EOP and local settings. |
| `server/python/orbit_api/formats/` | OEM and SP3 readers with source metadata. |
| `server/python/orbit_api/orbits/propagators/` | SGP4 propagators, two bodies, Cowell/RK4 and legacy routes. |
| `server/python/tests/` | Tests that fix the contracts of Python modules. |
| `server/tests/node/` | Gateway, catalog, proxy and deployment testing. |
| `docs/general/TIME_EOP_OPERATIONS.md` | Local operating procedure of EOP and leap seconds. |

## Orbit Results Quote

A result that depends on terrestrial propagation or transformation must
register, at a minimum:

1. Orbit version or commit used.
2. TLE definition, initial state or origin of the tabular product.
3. Propagator, strength, step and sampling range options.
4. Framework, terrestrial realization, time scale and input/output units.
5. Identity of the EOP snapshot and the leap seconds table when
   intervene.
6. Settings that alter the result or catalog selection.

## Related references

- [Glossary](glossary.md)
- [Appendix](appendix.md)
- [Architecture](../development/architecture.md)
