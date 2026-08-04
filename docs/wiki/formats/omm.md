# OMM

[Inicio](../index.md) · [Formatos](index.md) · [TLE](tle.md) · [Formatos no soportados](unsupported-formats.md)

## Alcance implementado

Orbit admite OMM JSON y XML exclusivamente como contenedor de un TLE embebido.
Tras importar, el catálogo conserva las dos líneas y las propaga con SGP4; no
existe un lector OMM general de elementos medios como fuente dinámica propia.

## JSON admitido

El parser acepta una lista raíz o una lista en `entries` u `omm`. Para cada
fila busca:

| Dato | Nombres aceptados |
| --- | --- |
| Nombre | `name`, `OBJECT_NAME`, `OBJECT_ID` |
| Línea 1 | `line1`, `line_1`, `TLE_LINE1` |
| Línea 2 | `line2`, `line_2`, `TLE_LINE2` |

Las filas que no contienen nombre y ambas líneas se omiten. Los datos que sí
se extraen pasan por la misma validación de TLE del catálogo.

## XML admitido

El parser busca bloques `segment`; si no existen, busca bloques `omm`. Dentro
de cada bloque extrae `OBJECT_NAME` o `OBJECT_ID`, y `TLE_LINE1`/`TLE_LINE2`
(también admite `line1`/`line2`). Las entidades XML básicas se decodifican para
preservar el contenido textual de las líneas.

## Exportación

El gateway puede emitir JSON u XML con `OBJECT_NAME`, `OBJECT_ID`, las líneas
TLE y el identificador NORAD conservado. El backend Python también dispone de
una salida OMM mínima basada en esas líneas.

!!! warning "No es cobertura OMM completa"

    Orbit no valida ni consume todos los bloques, campos, covarianzas, teorías
    de media, maniobras o perfiles de OMM. Un OMM sin TLE embebido no se
    convierte en una órbita de catálogo.

Para el modelo que finalmente se usa, consulte [TLE](tle.md) y
[SGP4](../propagation/sgp4.md).
