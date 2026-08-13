# Time and EOP: local files

[Operation](../index.md) · [Time, EOP and ITRF](../time-eop.md)

| Product | Function | Status and format |
| --- | --- | --- |
| [IERS EOP 20u24 C04](https://datacenter.iers.org/products/eop/long-term/c04_20u24/) | DUT1, polar motion, dX, dY and LOD. | Recommended: ASCII C04-20 with IAU 2000A `dX`/`dY`; retain its revision and SHA-256. C04-14 is accepted only to replay historical files. |
| leap-seconds.list | UTC, TAI, TT and GNSS scales. | ASCII IERS/NTP with identity and expiration. |
| [IERS Bulletin A](https://maia.usno.navy.mil/products/bulletin-a) / IGS ERP | Rapid EOP, predictions, or products paired with SP3. | A local `.ERP`/`.ERP.gz` is explicitly associated with the GNSS product for ITRF-to-ECI together with a valid realization route. Bulletin A still has no direct importer and is never an automatic fallback. |

Do not use a C04 IAU 1980 that declares dPsi/dEps instead of dX/dY. Orbit it
rejects when the header identifies it.

## UTC-TAI snapshot included with Compose

The distribution includes `config/eop/leap-seconds.list`, copied from the
official [IERS EOC source](https://hpiers.obspm.fr/iers/bul/bulc/ntp/leap-seconds.list)
updated by Bulletin C 72 (2026-07-06). The default deployment pins:

| Data | Value |
| --- | --- |
| SHA-256 | `db5a895f16853b03bfc865e8d68f9fc8710ef1740e3400c701cd46a5bbbc3433` |
| Version | `IERS-Bulletin-C-72-2026-07-06` |
| NTP update | `3992312697` |
| IERS `#@` horizon | `2027-06-28T00:00:00Z` (exclusive) |

It was current on 2026-08-12. It is never downloaded at runtime: the hash is
verified at startup and an SP3-to-ECI conversion is rejected at that horizon.
Update the file, SHA and version together from IERS, not from a mirror.
