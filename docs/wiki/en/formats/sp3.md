# SP3

[Home](../index.md) · [Formats](index.md) · [Reference frames](../engineering/reference-frames.md) · [Temporal systems](../engineering/time-systems.md)

## Support status

`Sp3StateProvider` is a Python SP3 tabulated state reader. there is no
import SP3 in the UI, gateway, public API or `OrbitRuntime`; the reader does not
automatically creates catalog objects or viewer layers.

## Supported header

The parser requires a first meaningful header with `#`, different from `##`,
and at least 51 characters. Preserve:

| Field | Source |
| --- | --- |
| Registration version and type | Fixed `#` header positions. The type must be `P` or `V`. |
| Initial period | Header calendar, without assuming UTC. |
| Number of epochs, data, orbital type and agency | Fixed fields when present. |
| Coordinate system | Header field, required. |
| Temporary system | Line `%c`, field `TIME_SYSTEM`, required. |

The `IGS20`, `IGb20` and `IGc20` embodiments are preserved as the `IGS` family
with explicit realization. They are not renamed as ITRF.

## Status records

Epochs are entered using lines `*`. The registers `P` and `V` are
associated by time and satellite identifier.

| Registration | Source units | Conversion to `StateVector` |
| --- | --- | --- |
| `P` | km | m. |
| `V` | dm/s | m/s. |

The missing component sentinel SP3 (`abs(valor) >= 999999`) is omitted; no
it is treated as a valid coordinate. Duplicate records of the same type,
epoch and satellite are rejected.

## Selection and interpolation

An SP3 file can contain multiple satellites. The query method requires
`satellite_id` except when the series contains exactly one. Each satellite
uses `TabularStateProvider` with bounded linear interpolation by default.

Queries are converted from the scale indicated by the requester to the
native scale before searching and interpolating. For example, a GPS series retains
its GPS epochs at the output even if the query was formulated in UTC.

## Framework and realization

`native_state_at` returns the sample in the header frame. Request ITRF
for a SP3 in `IGS20` fails if a realization transformation does not exist
registered. The only optional integrated alignment is IGS20↔ITRF2020 under the
policy described in [Frameworks](../engineering/reference-frames.md);
IGb20 and IGc20 are not converted implicitly.

## Limits

- UI/API input, SP3 export and runtime logging are not implemented.
- There is no high order interpolation declared by SP3, clock precision or
  use of error or correlation fields.
- An unrecognized timeline is preserved when reading metadata, but is
  rejects when constructing the state provider.
- There is no invented transformation between terrestrial realizations.