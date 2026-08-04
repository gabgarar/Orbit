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

## Local OEM trajectories

The viewer can load a local tabulated OEM trajectory as a temporary orbit.
This path is not equivalent to importing a catalog object nor does it guarantee the
transformation of an arbitrary OEM TEME or GCRF by the framework service of the
UI.

When an OEM domain is activated, the [Timeline](timeline.md) remains
limited to its samples. Keep the source file available: your samples
They are not reliably restored from a project document.

## Formats not exposed by the interface

| Format | Current situation |
| --- | --- |
| SP3 | There is a Python reader with native metadata; there is no SP3 import per UI, public gateway or Orbit runtime. |
| OPM, CPF and RINEX | Not available. |
| Segmented Precision OEM | There is a Python reader for internal use; there is no operational overhead via UI or public API. |

!!! warning "Time frame and scale"

    The extension of a file does not determine its frame or time scale.
    Check OEM/SP3 metadata and use strict settings
    [time and EOP](../operations/time-eop.md) when the results should be
    reproducible or comparable with terrestrial precision.

There is no import of observations, tracking, measurements or solutions
orbit determination.