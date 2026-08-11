# Time and EOP: local files

[Operation](../index.md) · [Time, EOP and ITRF](../time-eop.md)

| Product | Function | Status and format |
| --- | --- | --- |
| [IERS EOP 20u24 C04](https://datacenter.iers.org/products/eop/long-term/c04_20u24/) | DUT1, polar motion, dX, dY and LOD. | Recommended: ASCII C04-20 with IAU 2000A `dX`/`dY`; retain its revision and SHA-256. C04-14 is accepted only to replay historical files. |
| leap-seconds.list | UTC, TAI, TT and GNSS scales. | ASCII IERS/NTP with identity and expiration. |
| [IERS Bulletin A](https://maia.usno.navy.mil/products/bulletin-a) / IGS ERP | Rapid EOP, predictions, or products paired with SP3. | A local `.ERP`/`.ERP.gz` is explicitly associated with the GNSS product for ITRF-to-ECI together with a valid realization route. Bulletin A still has no direct importer and is never an automatic fallback. |

Do not use a C04 IAU 1980 that declares dPsi/dEps instead of dX/dY. Orbit it
rejects when the header identifies it.
