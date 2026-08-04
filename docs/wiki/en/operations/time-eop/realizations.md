# Time and EOP: realizations and visual mode

[Operation](../index.md) · [Time, EOP and ITRF](../time-eop.md) · [Strict mode](strict-mode.md)

## GNSS realizations

By default, an IGS20 state preserves that realization and is not rewritten to ITRF.
The IGS20 ↔ ITRF2020 global alignment requires expressly enabling
ORBIT_ENABLE_IGS20_ITRF2020_ALIGNMENT together with ITRF2020 as a realization of
exit. Does not apply station or antenna corrections. IGb20 and IGc20 do not receive
an implicit conversion.

## Visual mode

Without local C04, Orbit retains a visual approximation UTC≈UT1 and marks it as
approximate. Without local table UTC–TAI uses the included historical programming,
with last record 2017-01-01 and TAI−UTC = 37 s. This mode is not suitable for
accurate analysis or reproducible terrestrial export.