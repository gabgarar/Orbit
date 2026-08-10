# Formatos no soportados

[Inicio](../index.md) · [Formatos](index.md) · [Visión general](overview.md) · [Propagación](../propagation/overview.md)

## Política

Un formato no se considera admitido por el mero hecho de que Orbit tenga un
árbol de proyectos, un exportador simplificado o un nombre de formato en una
interfaz. La compatibilidad requiere un parser, un contrato de marco/tiempo,
validación y una ruta operativa comprobable.

## Estado actual

| Formato o capacidad | Estado | Alternativa documentada |
| --- | --- | --- |
| [OPM](opm.md) | No disponible. | Estado manual o OEM/SP3 externo. |
| [CPF](cpf.md) | No disponible. | OEM externo, sin carga CPF. |
| [RINEX](rinex.md) de observaciones | No disponible. | Procesamiento externo y efeméride compatible. El producto RINEX CLK asociado a un SP3 se admite en la ruta de productos GNSS precisos. |
| OEM puro como objeto de catálogo, proveedor API o fuente de `OrbitRuntime` | No disponible. | El visor puede mostrar un track OEM local y transitorio; el lector Python interno está documentado en [OEM](oem.md). |
| OMM sin TLE embebido | No disponible como catálogo. | TLE u OMM con ambas líneas. |
| OCM completo | No disponible. | El gateway solo exporta un JSON simplificado. |

## Restricciones transversales

- No hay conversión automática entre realizaciones terrestres de origen.
- No hay propagación de covarianza, OD, filtrado ni tratamiento de medidas.
- No hay extensión de formatos mediante plugins del backend publicados.
- No hay garantía de que un archivo conservado como adjunto de proyecto sea
  restaurado o ejecutado como fuente de efemérides.

## Uso responsable de alternativas

Las fuentes externas deben convertirse antes de entrar en Orbit y conservar
sus metadatos de época, escala temporal, marco, realización, centro, unidades
y procedencia. Consulte [Estados cartesianos](../engineering/cartesian-states.md)
y [Marcos de referencia](../engineering/reference-frames.md) antes de relabelar
un vector.

!!! warning "No sustituir un formato por una etiqueta"

    Marcar una entrada como `OEM` u `OPM` no activa un lector. SP3 se importa
    por una ruta separada de productos GNSS precisos, con contrato de tiempo,
    marco y procedencia propios; no lo convierta en un TLE. Consulte
    [SP3](sp3.md) y [Productos GNSS precisos](precise-products.md).
