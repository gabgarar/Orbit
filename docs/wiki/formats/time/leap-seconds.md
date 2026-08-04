# Tabla de segundos intercalares

[Inicio](../../index.md) · [Formatos de tiempo](index.md)

## Formato aceptado

`LeapSecondTable` lee un snapshot ASCII IERS/NTP `leap-seconds.list`, incluida
su identidad y fecha de expiración. La tabla permite convertir UTC↔TAI y las
escalas que dependen de esa relación.

## Integridad

El despliegue puede fijar una ruta local, un SHA-256 esperado y requisitos de
presencia o vigencia. Así una actualización global no altera de forma silenciosa
un resultado científico reproducible.

Véanse los [sistemas temporales](../../engineering/time-systems.md) para las
conversiones y restricciones.
