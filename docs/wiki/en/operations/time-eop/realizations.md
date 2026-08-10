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

## Native SP3 frame and Earth-fixed view

An SP3 always retains the frame and realization declared in its header. For
example, `IGS20` remains a native terrestrial `IGS20` state: displaying it on
a globe does not turn it into `ITRF2020`. A registered realization operation
can carry a source realization to the selected ITRF realization; that
operation and the source label remain in provenance.

This differs from an Earth-fixed view created from an inertial state with the
UTC≈UT1 approximation and zero EOP. That output is labelled **approximate
Earth-fixed (without EOP)**. It is useful for visual orientation, but it is not
a rigorous ITRF realization and does not justify precise geometry, AOS/LOS, or
terrestrial-export results.

## Visual mode

Without local C04, Orbit retains a visual UTC≈UT1 approximation and marks it as
approximate. Without a local UTC–TAI table it uses the bundled historical
schedule, whose last record is 2017-01-01 with TAI−UTC = 37 s. This mode is not
suitable for accurate analysis or reproducible terrestrial export. For a
reproducible ITRF output, pin a local [IERS EOP 20u24 C04](../../formats/time/iers-c04.md)
snapshot, the UTC–TAI table, and, where relevant, the source→ITRF realization
operation.
