# Tiempo y EOP: modo estricto

[Operación](../index.md) · [Tiempo, EOP e ITRF](../time-eop.md) · [Archivos locales](data-files.md)

## Configuración

Guarde C04 y leap-seconds.list bajo config/eop, calcule sus hashes y configure
rutas del contenedor. Active ORBIT_EOP_STRICT, declare la procedencia del C04 y
configure una tabla local UTC–TAI vigente. La realización terrestre de salida
debe declararse explícitamente cuando corresponda.

## Variables principales

| Variable | Efecto |
| --- | --- |
| ORBIT_EOP_C04_PATH y ORBIT_EOP_C04_SHA256 | Snapshot C04 y su identidad. |
| ORBIT_EOP_SOURCE, ORBIT_EOP_VERSION y ORBIT_EOP_QUALITY | Procedencia registrada. |
| ORBIT_EOP_STRICT y ORBIT_EOP_ALLOW_EXTRAPOLATION | Política de rigor y extrapolación. |
| ORBIT_EOP_REQUIRED_START y ORBIT_EOP_REQUIRED_END | Ventana comprobada al iniciar. |
| ORBIT_LEAP_SECONDS_* | Ruta, identidad y vigencia UTC–TAI. |

El modo estricto impide extrapolar EOP y limita la calidad a final o rapid. El
inicio falla si los productos no cubren la ventana requerida; las consultas
fuera de cobertura se rechazan. Con SHA-256 configurado para UTC–TAI, cada
consulta comprueba también la expiración indicada por #@.
