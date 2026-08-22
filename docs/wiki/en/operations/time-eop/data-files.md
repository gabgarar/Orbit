# Time and EOP: local files

[Operation](../index.md) · [Time, EOP and ITRF](../time-eop.md)

| Product | Function | Status and format |
| --- | --- | --- |
| [IERS EOP_C01_IAU2000](https://datacenter.iers.org/data/latestVersion/EOP_C01_IAU2000_1846-now.txt) | Global operational terrestrial-orientation cache. | Downloaded automatically only in the startup/background monitor into `data/erp/EOP_C01_IAU2000_1846-now.txt`; refreshed after 7 days **or** when it does not cover the checked instant, validated before activation, and never replaces explicit C04 or SP3 ERP. C01 declares `UT1-TAI`, not `UT1-UTC`. |
| [IERS finals2000A.all](https://datacenter.iers.org/products/eop/rapid/standard/finals2000A.all) | Rapid IAU 2000A bridge when C01 does not cover an epoch. | A separate automatic HTTPS cache from IERS at `data/erp/finals2000A.all` (override `ORBIT_FINALS2000A_CACHE_PATH`). A complete Bulletin B tuple is `final` (LOD remains Bulletin A/optional); otherwise Bulletin A `I` is `rapid` and any `P` is `predicted`. It never replaces explicit C04 or SP3 ERP; blank LOD is not invented. |
| [IERS EOP 20u24 C04](https://datacenter.iers.org/products/eop/long-term/c04_20u24/) | DUT1, polar motion, dX, dY and LOD. | Recommended: ASCII C04-20 with IAU 2000A `dX`/`dY`; retain its revision and SHA-256. C04-14 is accepted only to replay historical files. |
| leap-seconds.list | UTC, TAI, TT and GNSS scales. | ASCII IERS/NTP with identity and expiration. |
| IGS ERP | Product paired with SP3. | A local `.ERP`/`.ERP.gz` is explicitly associated with the GNSS product for ITRF-to-ECI together with a valid realization route. It is never replaced by C01, finals2000A, or extrapolation. |

Do not use a C04 IAU 1980 that declares dPsi/dEps instead of dX/dY. Orbit
rejects it when the header identifies it.

`finals2000A.all` is the official IERS Rapid Service / Prediction Centre
product, also published through the IERS Data Center. Its polar-motion,
UT1–UTC, and nutation fields each carry their own flag; consequently, a usable
coverage boundary cannot be inferred merely from the final line. Orbit validates
the fields it needs and publishes the most conservative quality for each
interval. After the final usable C01/finals interval, local linear extrapolation
may be available for at most 30 days when two compatible samples exist: it is
shown separately as **extrapolated**, not as an IERS file or valid ERP. Beyond
those 30 days there is no automatic EOP; the view degrades to nominal rotation
and a strict operation rejects.

The three operational boundaries —C01 end, usable `finals2000A.all` end, and
start of extrapolation—are derived from installed snapshots; they are not fixed
dates in this documentation. Consult **Diagnostics** or the planner for the
actual instants, and update the files before an operation that needs precision
outside coverage.

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
