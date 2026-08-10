# Time and EOP: realizations and visual mode

[Operation](../index.md) · [Time, EOP and ITRF](../time-eop.md) · [Strict mode](strict-mode.md)

## GNSS realizations

By default, an `IGS20`, `IGb20`, or `IGc20` state retains its realization and
is not rewritten as ITRF. The published global alignment of that family with
ITRF2020 requires explicitly enabling:

```text
ORBIT_TERRESTRIAL_REALIZATION=ITRF2020
ORBIT_ENABLE_IGS20_FAMILY_ITRF2020_ALIGNMENT=true
```

The policy applies only to geocentric satellite-orbit states and retains the
source label in provenance. It does not apply station or antenna corrections.
The legacy `ORBIT_ENABLE_IGS20_ITRF2020_ALIGNMENT` variable retains the exact
`IGS20` behaviour, but it cannot be enabled at the same time. `IGS14` and
other historical realizations receive no implicit conversion: they need their
own published operation.

## Visual mode

Without local C04, Orbit retains a visual approximation UTC≈UT1 and marks it as
approximate. Without local table UTC–TAI uses the included historical programming,
with last record 2017-01-01 and TAI−UTC = 37 s. This mode is not suitable for
accurate analysis or reproducible terrestrial export.
