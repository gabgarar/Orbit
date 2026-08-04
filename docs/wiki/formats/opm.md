# OPM

[Inicio](../index.md) · [Formatos](index.md) · [Estados cartesianos](../engineering/cartesian-states.md) · [Formatos no soportados](unsupported-formats.md)

## Estado de soporte

Orbit no implementa Orbit Parameter Message (OPM) como importación,
exportación, lector de estados ni fuente de propagación.

No hay parser de mensajes OPM, validación de metadatos, conversión de
representaciones de estado, tratamiento de maniobras, covarianzas o selección
de marcos y escalas temporales propios de OPM.

## Alternativas disponibles

- Para un estado de trabajo manual, use el contrato de
  [elementos keplerianos](../engineering/keplerian-elements.md) o el estado
  cartesiano requerido por [Cowell](../propagation/cowell.md).
- Para una trayectoria tabulada de origen externo, use los lectores Python de
  [OEM](oem.md) o [SP3](sp3.md), con sus limitaciones de integración de
  producto.
- Para catálogo, use [TLE](tle.md) o [OMM](omm.md) con TLE embebido.

!!! warning "No usar OPM como JSON libre"

    Guardar un OPM dentro de un proyecto o metadato no lo hace procesable por
    Orbit. No existe una conversión automática de esos campos a `StateVector`.
