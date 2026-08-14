# Time and EOP: strict mode

[Operation](../index.md) · [Time, EOP and ITRF](../time-eop.md) · [Local Files](data-files.md)

## Configuration

Save C04 and leap-seconds.list under config/eop, calculate their hashes and configure
container routes. Activate ORBIT_EOP_STRICT, declare the origin of C04 and
configure a current local UTC–TAI table. Carrying out ground departure
should be explicitly declared where applicable.

## Main variables

| Variable | Effect |
| --- | --- |
| ORBIT_EOP_C04_PATH and ORBIT_EOP_C04_SHA256 | Snapshot C04 and its identity. |
| ORBIT_EOP_SOURCE, ORBIT_EOP_VERSION and ORBIT_EOP_QUALITY | Registered provenance. |
| ORBIT_EOP_STRICT and ORBIT_EOP_ALLOW_EXTRAPOLATION | Rigor and extrapolation policy. |
| ORBIT_EOP_REQUIRED_START and ORBIT_EOP_REQUIRED_END | Checked window on startup. |
| ORBIT_LEAP_SECONDS_* | UTC–TAI route, identity and validity. |

Strict mode prevents extrapolating EOP and limits quality to final or rapid. The
startup fails if the products do not cover the required window; the queries
outside coverage are rejected. With SHA-256 configured for UTC–TAI, each
query also checks the expiration indicated by #@.

The automatic C01 cache is intentionally different: it improves global
operational orientation when no explicit C04 exists, but it does not supply an
operator-selected hash/version contract and cannot by itself satisfy this
strict policy or the ERP bound to an SP3.
