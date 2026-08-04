# CPF

[Home](../index.md) · [Formats](index.md) · [Unsupported formats](unsupported-formats.md) · [OEM](oem.md)

## Support status

Orbit does not implement the Consolidated Prediction Format (CPF).

There is no importer, parser, interpolator, exporter, time conversion,
station adapter or integration with visualization/API. No file
with CPF extension is detected as a supported orbital source.

## Alternatives

When an external Cartesian path is available, convert it out of
Orbit to a format that the Python reader can interpret, such as [OEM](oem.md),
and explicitly declare frame, realization, center and time scale. That
external conversion does not enable a product CPF upload nor should it hide the
original provenance.

Existing ground station functions are not compatible
with CPF or with laser range prediction.