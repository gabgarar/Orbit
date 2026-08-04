# Export data

[Home](../index.md) · [User Guide](index.md) · [Projects](projects.md) · [Import](import.md) · [Time and EOP Operation](../operations/time-eop.md)

Orbit allows you to download a copy of project, catalog items according to your
origin and ephemeris calculated over a range. The export does not convert the
runtime in a complete implementation of all CCSDS profiles.

## Export project

The **Export Project** action downloads a separate orbit-project JSON
of the open file. Includes the serializable state described in
[Projects](projects.md). Use this option to move the composition of the
workspace; Don't assume it incorporates tabulated local OEMs.

## Export catalog item

The export dialog displays the actions supported by the export format.
origin of the object.

| Origin | Direct export available |
| --- | --- |
| TLE | TLE. |
| WMO | OMM JSON and OMM XML. |
| OEM | OEM header when the source corresponds to that format. |

The availability of a button does not convert an object from one format to another. The
direct export preserves the source type supported by the runtime.

## Export ephemeris

Ephemeris export supports a start, end, interval in seconds
and one of these formats:

| Format | Content |
| --- | --- |
| CSV | Ephemeris samples in a tabular file. |
| JSON | Serialized ephemeris samples. |
| OEM | Ephemeris with simplified CCSDS OEM 2.0 header. |

The interface initializes the range with the current epoch and a duration of one day,
a ten second step and the SGP4 propagator. The operator can adjust the
range and step within the limits accepted by the backend.

## OEM contract

The OEM outputs use kilometers and kilometers per second. The backend requires that
the points of the same export declare a framework and a time scale
compatible; it does not silently combine points from different frames or scales.

!!! warning "Standard coverage"

    Orbit's OMM, OCM, and OEM outputs should not be interpreted as a
    full implementation of each CCSDS profile. Review fields, comments,
    framework and time scale before delivering an export to another system.

## Reproducibility

For a precision ephemeris, record next to the exported file:

1. The TLE, OEM, or other source that originated the layer.
2. The requested range, step and propagator.
3. The frame and scale declared by the output.
4. The EOP snapshot and leap seconds table used by the backend.

The last point is essential when the output requires reduction
terrestrial. See [Timing and EOP operation](../operations/time-eop.md).