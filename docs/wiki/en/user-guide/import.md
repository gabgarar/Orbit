# Import data

[Home](../index.md) · [User Guide](index.md) · [Projects](projects.md) · [Export](export.md) · [Time and EOP Operation](../operations/time-eop.md)

Orbit separates the import of a project from the incorporation of data into the
catalog or viewer. A project file restores a local composition; a
orbital file incorporates objects or a compatible trajectory.

## Orbit Project

The open or import project command accepts a formatted JSON
orbit-project and version 1. A file with another format or version is rejected.
The currently open project is replaced only after confirmation.

See [Projects](projects.md) for the restored fields and
local OEM limitations.

## Orbital catalog

The catalog service recognizes TLE and OMM when they provide the two TLE lines
necessary to create a propagable object. Detection is based on content
and extension.

| Entry | Common extensions | Result |
| --- | --- | --- |
| TLE | .tle, .txt | One or more TLE catalog objects. |
| OMM JSON | .json | OMM objects containing TLE_LINE1 and TLE_LINE2. |
| WMO XML | .omm, .xml | OMM XML objects that contain the TLE lines. |
| Textual OEM with embedded TLE | .oem | Catalog entry only if it contains the textual fields `TLE_LINE1 = …` and `TLE_LINE2 = …`. |

Imported data is validated before being added to the catalog. An OEM that
does not contain an embedded TLE cannot be converted to a catalog object
native and is rejected on that path.

## Precise GNSS products

**Import GNSS product**, available from **Layers → + → Add layer → Add
satellite**, loads local GNSS ephemerides as tabulated sources. It does not use
the TLE/OMM catalogue importer: SP3 retains its native GNSS identifiers, frame,
and time scale, and is not converted into a TLE.

The **SP3** field is required and accepts `.SP3` or `.SP3.gz`. When it is
empty, Orbit displays exactly **“Debe proporcionar un fichero SP3.”**. The
remaining fields are optional during import:

| Field | Accepted extensions | Use |
| --- | --- | --- |
| CLK | `.CLK`, `.CLK.gz` | Associated precise clocks. |
| ERP | `.ERP`, `.ERP.gz` | Associated Earth-rotation parameters. |
| SUM | `.SUM`, `.SUM.gz` | Product metadata/summary. |
| ATT | `.ATT.OBX`, `.ATT.OBX.gz`; `.OBX`/`.ATT` aliases and `.gz` | Published satellite attitude. |
| OSB | `.OSB.BIA`, `.OSB.BIA.gz`; `.BIA` alias and `.gz` | Observable-specific biases. |

Every field except SP3 is optional during import. Provider, family, and class
are detected from the files; they are not entered manually. CLK, SUM, ATT, and
OSB cannot create an orbit without SP3; they remain associated with the same
product and their provenance is retained. ERP is likewise associated, but
ITRF-to-ECI comparison is future tooling: when implemented, it will require
ERP, a realization route, and valid temporal coverage.

| Locally downloaded product | Example use |
| --- | --- |
| IGS Final/Rapid/Ultra-Rapid from [NASA CDDIS](https://cddis.nasa.gov/Data_and_Derived_Products/GNSS/orbit_and_clock_products.html) | Load the SP3 for the analysis date; add its CLK if clock information must be retained. |
| [IGS MGEX](https://igs.org/mgex/data-products/) SP3 + CLK | Import a multi-GNSS constellation while retaining IDs such as `G01`, `E11`, or `C19`. |
| [ESA NSO](https://navigation-office.esa.int/GNSS_based_products.html) Final/Rapid/Ultra-Rapid | Load files downloaded from the corresponding ESA series. |

Before importing, check the date, frame, and `TIME_SYSTEM`; after loading,
Orbit shows the detected product class. An Ultra-Rapid product can mix observed
and predicted intervals; its coverage must not be read as uniformly observed.
The input is durably registered in the local precise-product store and
rehydrated at startup. A project references the stable product, but does not
include copies of its source binaries.

After import, the displayed frame depends on ERP and the realization route:
with ERP and a datum transformation applied, Orbit shows **ITRF (con ERP
aplicado)** and allows conversion to ECI; without ERP it shows **Marco
terrestre aproximado (sin ERP)**. ERP supplies UT1 and polar motion, but does
not itself turn an IGS realization into ITRF. The SP3 header remains visible as
the native file frame.

!!! warning "This is not a remote download"

    CDDIS may require Earthdata Login, and providers change distribution
    schemes. Orbit does not sign in or download these products: authentication
    and file verification happen outside the application. See [Precise GNSS
    products](../formats/precise-products.md) for quality, provenance, CLK,
    frames, and limitations. After a successful load, the object's input tab
    shows the product card and the simulated timeline aligns to common
    coverage.

## Local OEM trajectories

The viewer can load a local tabulated OEM trajectory as a temporary orbit.
This path is not equivalent to importing a catalog object nor does it guarantee the
transformation of an arbitrary OEM TEME or GCRF by the framework service of the
UI.

When an OEM domain is activated, the [Timeline](timeline.md) remains
limited to its samples. Keep the source file available: your samples
They are not reliably restored from a project document.

## Ground stations

Import independent stations from **Import** in **Ground Stations** or from
**Import stations** in project actions. This action adds valid stations to the
open project; it does not replace its layer tree or import an orbital object.

| Format | Recommended use | Minimum import requirement |
| --- | --- | --- |
| GeoJSON RFC 7946 | GIS and mapping tools. | A `Point` `Feature` with valid WGS-84 coordinates. |
| Orbit JSON | Native copy of Orbit stations. | An `orbit-ground-stations` envelope with a `stations` list. |
| CSV | Tabular editing. | `latitude_deg` and `longitude_deg` columns. |

The UI limit is 5 MiB. Each feature or row is validated independently: Orbit
imports valid stations, skips invalid ones, and reports both counts. See
[Ground-station interchange](../formats/ground-stations/interchange.md) for
the contract, accepted extensions, and data recalculated by Orbit.

## Formats not exposed by the interface

| Format | Current situation |
| --- | --- |
| OPM, CPF and RINEX | Not available. |
| Segmented Precision OEM | There is a Python reader for internal use; there is no operational overhead via UI or public API. |

!!! warning "Time frame and scale"

    The extension of a file does not determine its frame or time scale.
    Check OEM/SP3 metadata and use strict settings
    [time and EOP](../operations/time-eop.md) when the results should be
    reproducible or comparable with terrestrial precision.

There is no import of observations, tracking, measurements or solutions
orbit determination.
