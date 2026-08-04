# WMO

[Home](../index.md) · [Formats](index.md) · [TLE](tle.md) · [Unsupported formats](unsupported-formats.md)

## Scope implemented

Orbit supports OMM JSON and XML exclusively as a container for an embedded TLE.
After importing, the catalog preserves the two lines and propagates them with SGP4; no
There is a general OMM reader of medium elements as its own dynamic source.

## JSON supported

The parser accepts a root list or a list in `entries` or `omm`. For each
row search:

| Data | Accepted names |
| --- | --- |
| Name | `name`, `OBJECT_NAME`, `OBJECT_ID` |
| Line 1 | `line1`, `line_1`, `TLE_LINE1` |
| Line 2 | `line2`, `line_2`, `TLE_LINE2` |

Rows that contain no name and both lines are ignored. The data that does
are extracted go through the same TLE validation of the catalog.

## XML supported

The parser looks for `segment` blocks; if they do not exist, it looks for `omm` blocks. inside
from each block extract `OBJECT_NAME` or `OBJECT_ID`, and `TLE_LINE1`/`TLE_LINE2`
(also supports `line1`/`line2`). Basic XML entities are decoded to
preserve the textual content of the lines.

## Export

The gateway can output JSON or XML with `OBJECT_NAME`, `OBJECT_ID`, the lines
TLE and the preserved NORAD identifier. The Python backend also has
a minimum OMM output based on those lines.

!!! warning "This is not complete OMM coverage"

    Orbit does not validate or consume all blocks, fields, covariances, theories
    on average, maneuvers or OMM profiles. An OMM without embedded TLE will not
    becomes a catalog orbit.

For the model that is finally used, see [TLE](tle.md) and
[SGP4](../propagation/sgp4.md).