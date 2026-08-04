# IERS EOP C04

[Inicio](../../index.md) · [Formatos de tiempo](index.md)

## Formato aceptado

Orbit lee ficheros ASCII IERS EOP C04-14 o C04-20 con correcciones IAU 2000A
`dX`/`dY`. El proveedor entrega DUT1, movimiento polar, dX, dY y LOD a la
ruta de transformación de marcos.

## Rechazos

Un C04 IAU 1980 que declara `dPsi`/`dEps` se rechaza cuando el encabezado lo
identifica. El modo estricto también exige cobertura de la época solicitada y
calidad EOP permitida.

La configuración y procedencia se describen en [archivos locales de tiempo y
EOP](../../operations/time-eop/data-files.md).
