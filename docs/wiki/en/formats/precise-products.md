# Precise GNSS products

[Satellite](../satellite/index.md) · [Space formats](index.md) · [SP3](sp3.md) · [Import](../user-guide/import.md)

## Overview

Orbit imports precise GNSS products **previously downloaded by the operator**.
An import can contain an SP3 ephemeris and, optionally, its associated RINEX
CLK product. The result is a tabulated state source with explicit frame,
terrestrial realization, time scale, and provenance.

This route is for inspecting and visualising published precise orbits; it does
not turn the product into a TLE or run SGP4. Position comes from SP3, and clock
data does not change the orbit geometry.

!!! note "External download, local import"

    Orbit does not sign in, retain credentials, or download products from
    CDDIS, IGS, or ESA on the operator's behalf. Download the file from its
    provider, verify its date, and then load it locally into Orbit.

## Products that can be imported

The reader interprets the product content, not a particular brand. Therefore,
the same local route accepts SP3/CLK profiles published by the following
providers when their headers and records meet the format contract.

| Distributor / series | Orbit | Clock | Use and provenance retained by Orbit |
| --- | --- | --- | --- |
| [NASA CDDIS — IGS](https://cddis.nasa.gov/Data_and_Derived_Products/GNSS/orbit_and_clock_products.html) | IGS Final, Rapid, and Ultra-Rapid SP3. | Associated IGS CLK when supplied. | Provider ID `cddis_igs`, IGS family, and detected or declared product class. |
| [IGS MGEX](https://igs.org/mgex/data-products/) | Multi-GNSS SP3. | Associated multi-GNSS CLK. | ID `igs_mgex`; constellation identifiers from the file are retained. |
| [ESA Navigation Support Office](https://navigation-office.esa.int/GNSS_based_products.html) | Operational and MGEX series, including Final, Rapid, and Ultra-Rapid. | Corresponding CLK products when supplied. | ID `esa_nso`, series, and class indicated by the name or operator. |

Satellite identifiers remain in the product form, such as `G01`, `E11`, `C19`,
or `R05`. A multi-GNSS entry is not reduced to GPS or reassigned to a NORAD
identifier.

The provider and class selector lets the operator retain declared provenance.
In automatic mode, Orbit uses file-name patterns to propose IGS/CDDIS, MGEX,
ESA NSO, and Final/Rapid/Ultra-Rapid; when there is no match, it records
`custom` and/or `unknown` rather than asserting unproven quality. The SP3
header remains authoritative for frame and time scale.

### Quality and latency

Final, Rapid, and Ultra-Rapid labels describe production process and latency;
they do not establish precision that Orbit can guarantee after reading a file.

| Class | Operational meaning | Interpretation in Orbit |
| --- | --- | --- |
| Final | Consolidated product, normally the highest-quality product in the series. | Preferable for retrospective and reproducible analysis together with the exact imported file. |
| Rapid | Available earlier than Final. | Appropriate for recent operations when Final is not yet available. |
| Ultra-Rapid | Very low-latency product; it may combine observed and predicted segments. | Orbit retains product provenance; the operator must treat the predicted segment accordingly. |

CDDIS and IGS publish the description and availability of these classes on
their [orbit and clock products](https://cddis.nasa.gov/Data_and_Derived_Products/GNSS/orbit_and_clock_products.html)
and [IGS products](https://www.igs.org/products/) pages. For Ultra-Rapid,
coverage by the file does not mean that a sample is observed: consult the
marking and documentation of the source product.

## Files and packaging

Local import accepts SP3 orbit files and, optionally, RINEX CLK clock files.
Names may use the current IGS/ESA long-name scheme or the historical weekly
CDDIS scheme. The name helps classification and is retained as provenance, but
it never replaces the header.

| File | Role | Can create an orbital layer |
| --- | --- | --- |
| `*.sp3`, `*.sp3c`, or `*.sp3d` (or a variant recognised by header) | Position, and velocity when the product carries it, by epoch and satellite. | Yes. |
| `*.clk`, `*.clk_30s`, or `*.clk_05s` | Clock bias and, when present, clock rate/precision by epoch and satellite. | No; it is associated with the SP3 product from the same import. |
| `*.erp` | Earth-orientation parameters published alongside some GNSS products. | No; ERP is not currently imported or paired with SP3. |
| Any of those extensions with `.gz` | GNU gzip-compressed variant. | Yes, after local decompression. |
| `*.zip` | Local container for one or more SP3/CLK files. | Yes, when it contains a valid SP3. |
| `*.Z` | Historical UNIX compression used by legacy CDDIS files. | Yes, when its content decompresses and validates correctly. |

A CLK file without SP3 cannot create a trajectory because it contains no
positions. Each product accepts exactly **one** logical SP3 and at most **one**
logical CLK after decompression. A ZIP can carry them together, but a ZIP with
two SP3 or two CLK files does not make an ambiguous pair: Orbit rejects it.

### Upload and safety limits

The route limits uploads to eight files, 32 MiB per file, and 64 MiB in total
before decompression. The decompressed set cannot exceed 256 MiB. A ZIP can
contain up to 16 unencrypted members; nested ZIP files and file paths that
leave the archive are rejected. These limits protect the service from malformed
files and decompression bombs; they do not indicate a product's scientific
quality.

!!! warning "Do not confuse clock with time scale"

    A CLK product describes satellite clock corrections. SP3/CLK
    `TIME_SYSTEM` defines how epochs are interpreted. Clock data does not
    convert GPS to UTC or replace the local leap-second table or EOP.

## What Orbit retains

For each imported product, Orbit retains at least the file name, provider and
product classification, included satellites, and the metadata published by the
format:

- coordinate system, terrestrial realization, and centre declared by SP3;
- time scale and epoch of every sample;
- agency, orbit type, and epoch coverage when available;
- source satellite identifier and the presence of positions, velocities, and
  clock samples;
- name/origin selected by the operator, product class declared or inferred
  from the name, and compressed archive member names where applicable;
- SHA-256 of the uploaded file and of every decompressed logical source.

Provenance follows the layer and import response. Orbit stores verified sources
and a manifest under `config/precise-products/` in a content-addressed
directory; at startup it verifies checksums again before rehydrating a product.
Also keep the original file and its checksum in the mission data repository: a
`Final` or `Rapid` label does not identify a specific product revision on its
own.

Persisted source files are not published through the static `/config/` route:
Orbit explicitly rejects `config/precise-products/`. Visible provenance is
provided through the API contract, not through an accidental download of the
uploaded binaries.

## Time, frames, and realization

SP3 defines its own coordinate system and time scale. Orbit retains those
labels when registering the series and transforms a state only where the frame
service has an explicit route. It does not silently rename `IGS20`, `IGb20`,
or `IGc20` as `ITRF`.

There is a published zero-datum global operation, but it is **optional and
disabled by default**, for satellite-orbit states declared as `IGS20`, `IGb20`,
or `IGc20`. Enable it only by setting both:

```text
ORBIT_TERRESTRIAL_REALIZATION=ITRF2020
ORBIT_ENABLE_IGS20_FAMILY_ITRF2020_ALIGNMENT=true
```

The operation retains the individual source realization in provenance; it is
not a station or antenna-coordinate correction. The legacy exact policy
`ORBIT_ENABLE_IGS20_ITRF2020_ALIGNMENT` must not be enabled at the same time.
Historical IGS realizations, including `IGS14`, remain diagnostic-only until
an explicit published operation is registered. See [Reference
frames](../engineering/reference-frames.md).

Import does not hide this boundary. If no route exists from the SP3 realization
to the active output ITRF, the product card reports terrestrial rendering as
unavailable and exposes the frame diagnostic; operations needing that
terrestrial state, such as an ITRF view or AOS/LOS, must be configured with a
valid route instead of assuming a conversion.

An SP3 state declared in a terrestrial realization remains native to that
realization. The fact that an Earth-fixed scene can draw it does not authorize
renaming, for example, `IGS20` as `ITRF2020`. A registered realization
transformation is a datum operation distinct from Earth orientation. If Orbit
creates a view from an inertial route with UTC≈UT1 and null EOP, the UI must
show **approximate Earth-fixed (without EOP)**; it is not a rigorous ITRF
output or a precision result for AOS/LOS or export.

Queries convert from the requested scale to the native scale before looking up
a sample. A reproducible terrestrial transformation also needs the relevant
time and Earth-orientation data in addition to SP3/CLK; see [Time, EOP, and
ITRF](../operations/time-eop.md).

ERP products and rapid EOP are not inferred from an SP3 name. The current
operational reference is a local [IERS EOP 20u24 C04](time/iers-c04.md)
snapshot with its version and hash. [IERS Bulletin A](time/bulletins.md) and
IGS ERP are future routes: this import has no reader, download, or automatic
pairing for them.

## Import workflow

1. Download an SP3 and, if needed for the analysis, the CLK from the same
   series from CDDIS/IGS/ESA.
2. Check provider, date, class (Final/Rapid/Ultra-Rapid), frame,
   `TIME_SYSTEM`, and whether Ultra-Rapid contains a predicted segment.
3. In **Layers → + → Add layer → Add satellite → Import precise GNSS (SP3 /
   CLK)**, select SP3, SP3c, or SP3d and add the optional CLK in the same operation.
   Supported compressed files can be supplied directly. The dialog can accept
   detection or declare provider and class.
4. Review the provenance summary and layers created by source satellite ID. A
   layer represents a tabulated ephemeris, not a TLE object.
5. Orbit aligns the simulated timeline to the published common coverage. Keep
   any later query within the imported SP3 epochs.

The load is local and is durably registered in Orbit's precise-product store.
The runtime rehydrates it after restart, and a project can reference stable
product identifiers; the source binary is not copied into every project
document. This route is not an automatic remote-catalog synchronisation.

In the object panel, the product input tab shows provider, class, SP3/CLK,
coverage, frame, `TIME_SYSTEM`, sample count, and clock summary. This is the
file's provenance card, not an independent accuracy estimate.

## Explicit limitations

- The import does not authenticate against or download from CDDIS Earthdata,
  IGS, or ESA.
- Authenticated remote download, scheduled refresh, and catalogue
  synchronization are future capabilities; importing a local file does not
  enable them.
- There is no product fusion, orbit fitting, smoothing, or automatic choice
  between Final, Rapid, and Ultra-Rapid.
- CLK samples are retained as clock metadata; they do not change SP3
  position/velocity or become a navigation solution.
- ERP, Bulletin A, and Bulletin B files are not accepted or paired with SP3.
  Those products require a future local, versioned, and auditable EOP route.
- Orbit interpolates each SP3 series through a local Lagrange window of up to
  ten samples (degree 9); with fewer records it explicitly degrades to the
  highest available degree. This bounded policy does not replace the
  provider's interpolation strategy, precision standards, or ancillary
  products.
- Time coverage is finite: a request outside the SP3 epochs is rejected rather
  than extrapolating a precise orbit.
- Precise-product import does not implement observation RINEX, PPP, orbit
  determination, clock steering, or bias estimation.

## API and references

The interface uses `POST /api/precise-products/import`; the endpoint, upload
contract, and responses are documented in [Precise-product API](../integrations/rest-api/orbit-operations.md#precise-gnss-products).
For the SP3 record contract, see [SP3](sp3.md).

Product sources:

- [CDDIS: IGS orbit and clock products](https://cddis.nasa.gov/Data_and_Derived_Products/GNSS/orbit_and_clock_products.html)
- [IGS: Products](https://www.igs.org/products/)
- [IGS: MGEX data products](https://igs.org/mgex/data-products/)
- [ESA Navigation Support Office: GNSS-based products](https://navigation-office.esa.int/GNSS_based_products.html)
- [IERS EOP 20u24 C04](https://datacenter.iers.org/products/eop/long-term/c04_20u24/)
- [IERS Bulletin A](https://maia.usno.navy.mil/products/bulletin-a)
