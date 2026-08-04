# Modelos de fuerza

[Inicio](../index.md) · [Propagación](index.md) · [Cowell](cowell.md) · [Modelos de gravedad](../engineering/gravity-models.md)

## Composición implementada

La composición de fuerzas está disponible solo para `cowell-rk4`. La gravedad
central es obligatoria; los demás términos se seleccionan de forma explícita.

| Término | Identificador | Estado |
| --- | --- | --- |
| Gravedad central | `central` | Disponible y siempre activo. |
| J2 | `j2` | Disponible. |
| J3 | `j3` | Disponible. |
| J4 | `j4` | Disponible. |
| Arrastre atmosférico | `drag` | Disponible con modelo exponencial. |
| Terceros cuerpos | — | No disponible. |
| Presión de radiación solar | — | No disponible. |
| Relatividad | — | No disponible. |
| Geopotencial completo | — | No disponible. |

La fuerza total de Cowell es:

$$
\mathbf a=\mathbf a_{central}+\mathbf a_{J2}+\mathbf a_{J3}+\mathbf a_{J4}+\mathbf a_{drag},
$$

incluyendo únicamente los términos seleccionados.

## Identidad del modelo

`model_id` permanece `cowell-rk4`; `force_model_id` identifica la composición
aplicada. Los equivalentes exactos de presets heredados conservan un nombre
conocido (`two-body`, `j2`, `j2-j3-j4`); una combinación distinta se informa
como suma de términos. Esta separación evita confundir la técnica de
integración con las fuerzas utilizadas.

## Presets

| Entrada heredada | Fuerzas resultantes |
| --- | --- |
| `two-body` | `central` |
| `j2` | `central`, `j2` |
| `j2-j3-j4` | `central`, `j2`, `j3`, `j4` |

El booleano heredado de arrastre solo se usa al traducir un preset. Para una
lista `force_terms`, la presencia o ausencia de `drag` es autoritativa.

## No confundir con SGP4

SGP4 acepta un TLE y tiene su propio modelo. Los términos Cowell no se aplican
a un objeto de catálogo SGP4 ni se usan para corregir un TLE.

Véanse [Masa puntual](point-mass.md), [J2](j2.md), [J3](j3.md), [J4](j4.md)
y [Arrastre atmosférico](atmospheric-drag.md), además de las páginas de
capacidades no disponibles para [terceros cuerpos](third-bodies.md),
[SRP](solar-radiation-pressure.md) y [relatividad](relativity.md).
