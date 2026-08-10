# Operación de tiempo, EOP e ITRF

[Inicio](../index.md) · [Operación](index.md) · [Configuración](configuration.md)

Orbit trata tiempo, orientación terrestre y realización como contratos
explícitos. No descarga productos de tiempo durante una propagación ni una
transformación: el operador monta snapshots locales e identifica cada revisión.

## Cadena temporal y de marcos

~~~mermaid
flowchart LR
    UTC[UTC] -->|DUT1| UT1[UT1]
    UTC -->|segundos intercalares| TAI[TAI]
    TAI -->|+ 32.184 s| TT[TT]
    I[GCRF / ICRF / EME2000] --> C[CIRS] --> T[TIRS] --> R[ITRF]
    M[TEME] --> P[PEF] --> R
~~~

La interfaz muestra UTC. UT1 se obtiene aplicando DUT1 y TT mediante
UTC → TAI → TT. Las etiquetas genéricas ECI y ECEF se rechazan. El acrónimo
correcto es ITRF, no IRTF.

Una etiqueta `ITRF` rigurosa no se infiere del globo ni de una rotación con
UTC≈UT1. Para transformar un estado inercial se necesita una ruta de marcos
explícita, segundos intercalares y EOP versionados —como mínimo DUT1, `xp` e
`yp`, y `dX`/`dY` en la reducción CIO—. Sin ellos la interfaz solo puede
presentar una **vista terrestre aproximada**, nunca relabelarla como ITRF.

## Guías operativas

| Tema | Contenido |
| --- | --- |
| [Archivos locales](time-eop/data-files.md) | C04 y leap-seconds.list requeridos. |
| [Modo estricto](time-eop/strict-mode.md) | Hashes, variables y cobertura comprobable. |
| [Realizaciones y modo visual](time-eop/realizations.md) | IGS20, ITRF2020 y aproximaciones. |
| [Actualización controlada](time-eop/updates.md) | Renovación de snapshots e invalidación de caché. |
