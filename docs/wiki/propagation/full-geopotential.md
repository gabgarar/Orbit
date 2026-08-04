# Geopotencial completo

[Inicio](../index.md) · [Propagación](index.md) · [Modelos de gravedad](../engineering/gravity-models.md) · [J2](j2.md)

## Estado de soporte

Orbit no implementa un geopotencial completo.

No hay lector de coeficientes armónicos \(C_{nm}\) y \(S_{nm}\), selección de
modelo, grado, orden, normalización, mareas, variación temporal ni evaluación
de términos tesseral y sectorial. Las únicas perturbaciones gravitatorias
numéricas disponibles son los armónicos zonales J2, J3 y J4 del modelo Cowell.

## Consecuencia operativa

No se debe interpretar una composición J2/J3/J4 como un truncamiento
configurable de un campo gravitatorio completo. Los coeficientes disponibles
son constantes internas, no un producto de gravedad versionado ni una API de
modelo de Tierra.

## Alternativas disponibles

- [Dos cuerpos](two-body.md) para una órbita idealizada.
- [J2](j2.md) para la aproximación secular o el término numérico J2.
- [Cowell](cowell.md) con J2/J3/J4 para una sensibilidad de primer orden.
- [OEM](../formats/oem.md) o [SP3](../formats/sp3.md) cuando se necesita
  consumir una trayectoria ya tabulada por un sistema externo.

!!! warning "No sustituye validación externa"

    Los análisis que requieran geopotencial de grado y orden controlado deben
    realizarse en una herramienta o servicio que implemente y documente ese
    modelo. Orbit no ofrece una aproximación silenciosa.
