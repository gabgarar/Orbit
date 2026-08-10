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

## Precise GNSS products: SP3 and CLK

**Import precise GNSS (SP3 / CLK)**, available from **Layers → + → Add layer →
Add satellite**, loads local GNSS ephemerides as tabulated sources. It does not
use the TLE/OMM catalogue importer: SP3 retains its native GNSS identifiers,
frame, and time scale, and is not converted into a TLE.

Select at least one SP3 and, optionally, the matching RINEX CLK from the same
series. Uncompressed, `gzip`, ZIP, and legacy `.Z` compression accepted by the
importer can be supplied. Orbit identifies file content and rejects a clock
file alone as a trajectory because CLK contains no positions.
Each product accepts one SP3 and at most one CLK after decompression; do not
mix products from different dates or analysis centres in the same upload.

| Locally downloaded product | Example use |
| --- | --- |
| IGS Final/Rapid/Ultra-Rapid from [NASA CDDIS](https://cddis.nasa.gov/Data_and_Derived_Products/GNSS/orbit_and_clock_products.html) | Load the SP3 for the analysis date; add its CLK if clock information must be retained. |
| [IGS MGEX](https://igs.org/mgex/data-products/) SP3 + CLK | Import a multi-GNSS constellation while retaining IDs such as `G01`, `E11`, or `C19`. |
| [ESA NSO](https://navigation-office.esa.int/GNSS_based_products.html) Final/Rapid/Ultra-Rapid | Load files downloaded from the corresponding ESA series. |

Before importing, check the product class, date, frame, and `TIME_SYSTEM`. An
Ultra-Rapid product can mix observed and predicted intervals; its coverage must
not be read as uniformly observed. The input is durably registered in the local
precise-product store and rehydrated at startup. A project references the
stable product, but does not include a copy of its source binary.

The UI accepts up to eight files, 32 MiB per file, and 64 MiB in total before
decompression. Encrypted or nested ZIP files are rejected, as are files that
exceed the decompressed safety limit.

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
