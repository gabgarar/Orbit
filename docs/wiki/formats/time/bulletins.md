# Boletines IERS A y B

[Inicio](../../index.md) · [Formatos de tiempo](index.md)

## Estado de soporte

Orbit no dispone de un lector directo para Bulletin A ni Bulletin B, ni para
archivos ERP de IGS. No interpreta predicciones, revisiones o convenciones de
esas fuentes como sustituto silencioso de un snapshot C04 compatible.

!!! warning "Formato previsto para implementación futura"

    La futura integración debe ser local y versionada. Deberá declarar qué
    campos acepta, cómo distingue dato observado de predicho, su política de
    interpolación, cobertura, fecha de publicación, proveedor y SHA-256 del
    snapshot que acompaña a cada resultado.

## Rutas futuras previstas

- [IERS Bulletin A](https://maia.usno.navy.mil/products/bulletin-a) puede
  aportar EOP rápidos y predicciones. Una futura importación debe conservar que
  un valor es rápido o predicho: una predicción no se promociona a final.
- Los [productos IGS](https://igs.org/products/) publican ficheros ERP junto a
  ciertas series Final, Rapid y Ultra-Rapid. Un ERP futuro deberá quedar
  emparejado de forma explícita con el SP3 de su misma revisión; Orbit no
  importa, descarga ni empareja `*.ERP` actualmente.

## Alternativa actual

Use un snapshot local de [IERS EOP 20u24 C04](iers-c04.md) y una tabla local de
segundos intercalares.
