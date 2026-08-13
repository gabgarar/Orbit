# Snapshot UTC–TAI incluido

`leap-seconds.list` es una copia local, inmutable y verificada de la lista
publicada por el Earth Orientation Center de IERS:

- URL de origen: <https://hpiers.obspm.fr/iers/bul/bulc/ntp/leap-seconds.list>
- Autoridad: IERS Bulletin C 72, publicado el 2026-07-06.
- Actualización NTP del fichero: `3992312697`.
- SHA-256 de los bytes incluidos:
  `db5a895f16853b03bfc865e8d68f9fc8710ef1740e3400c701cd46a5bbbc3433`.
- Horizonte de validez IERS (`#@ 4023129600`): 2027-06-28T00:00:00Z
  (límite exclusivo).

La fuente IERS declara el fichero de dominio público. Orbit no realiza ninguna
descarga de tiempo en ejecución: Compose carga exactamente estos bytes y
valida el SHA-256. La política por defecto establece
`ORBIT_LEAP_SECONDS_REQUIRE_UNEXPIRED=true`, por lo que un arranque posterior
al horizonte `#@` falla de forma cerrada. Si un proceso ya estaba iniciado,
una conversión SP3→ECI también rechaza una época en o después de ese horizonte.
Sustituya el snapshot y actualice simultáneamente su SHA-256 y versión en
`compose.yaml` antes de reanudar el servicio.

Para actualizarlo, descargue y revise el nuevo fichero fuera de Orbit desde la
URL de IERS, sustitúyalo de forma controlada, calcule `Get-FileHash -Algorithm
SHA256`, actualice los valores por defecto de Compose y ejecute la suite de
pruebas. No se acepta una copia de un mirror como fuente de autoridad.
