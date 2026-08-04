# TLE

[Inicio](../index.md) · [Formatos](index.md) · [SGP4](../propagation/sgp4.md) · [OMM](omm.md)

## Propósito

El juego de dos líneas es la representación operativa del catálogo de Orbit.
Cada entrada persistida conserva nombre, `line1`, `line2` y `sourceFormat`.
El runtime crea un `SGP4Propagator` a partir de esas dos líneas.

## Importación de catálogo

El gateway reconoce TLE por extensión `.tle` o `.txt`, y también como formato
por defecto cuando el contenido no corresponde a una detección más específica.
El parser de catálogo:

- ignora líneas vacías, comentarios `#` y `//`;
- acepta una línea de nombre opcional, incluido el prefijo `0 `;
- asocia una línea que empieza por `1 ` con la siguiente línea válida que
  empieza por `2 `;
- usa `NORAD <id>` cuando falta nombre.

Antes de persistir, la importación valida:

| Regla | Comprobación |
| --- | --- |
| Nombre | No vacío. |
| Prefijos | `line1` comienza por `1 ` y `line2` por `2 `. |
| Tamaño | Al menos 69 caracteres en cada línea. |
| Identificador | Cinco dígitos en columnas de catálogo y coincidencia entre líneas. |
| Checksum | Dígito 69 consistente con la suma TLE. |
| Movimiento medio | Positivo en el campo de la línea 2. |

Las entradas inválidas se contabilizan y no entran en el catálogo normalizado.
Los duplicados se resuelven por identificador NORAD: una entrada `CUSTOM`
prevalece sobre una de origen `CATALOG`; para el mismo origen se conserva la
primera persistida.

## Propagación

El TLE se propaga exclusivamente con [SGP4](../propagation/sgp4.md). Su estado
nativo es `TEME`; una salida ITRF es una transformación posterior y no cambia
el marco original del modelo.

## Exportación

El gateway ofrece una exportación textual de nombre, línea 1 y línea 2. La
exportación de efemérides del backend puede generar CSV, JSON u OEM a partir de
muestras SGP4; no representa el TLE como una efeméride de precisión distinta.

## Límites

- No se mantiene un historial de TLE ni se repropaga con el TLE histórico que
  correspondía a cada instante.
- No hay ajuste de TLE, OD, covarianza, maniobras ni validación orbital más
  allá de las reglas de catálogo.
- La precisión y vigencia se limitan a la información de origen del TLE; Orbit
  no la sustituye por un modelo de fuerzas de alta fidelidad.
