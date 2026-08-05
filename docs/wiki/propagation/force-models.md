# Modelos de fuerza

[Inicio](../index.md) · [Propagación](index.md) · [Cowell](cowell.md) · [Modelos de gravedad](../engineering/gravity-models.md)

## Clasificación

La composición de fuerzas está disponible solo para `cowell-rk4`. La gravedad
central es obligatoria; los demás términos se seleccionan de forma explícita.

| Grupo | Término | Identificador | Estado |
| --- | --- | --- | --- |
| Gravitacional | [Kepler / gravedad central](point-mass.md) | `central` | Disponible y siempre activo. |
| Gravitacional | [Geopotencial zonal J2, J3 y J4](j2.md) | `j2`, `j3`, `j4` | Disponible. |
| Gravitacional | [Geopotencial completo](full-geopotential.md) | — | Previsto. |
| Gravitacional | [Perturbaciones lunisolares](third-bodies.md) | — | Previsto. |
| Gravitacional | [Mareas](tides.md) | — | Previsto. |
| No gravitacional | [Arrastre atmosférico](atmospheric-drag.md) | `drag` | Disponible con modelo exponencial. |
| No gravitacional | [Presión de radiación solar](solar-radiation-pressure.md) | — | Previsto. |
| No gravitacional | [Albedo terrestre](albedo.md) | — | Previsto. |
| No gravitacional | [Relatividad y otros efectos](relativity.md) | — | Previsto. |

La fuerza total de Cowell es:

$$
\mathbf a=\mathbf a_{central}+\mathbf a_{J2}+\mathbf a_{J3}+\mathbf a_{J4}+\mathbf a_{drag},
$$

incluyendo únicamente los términos seleccionados.

## Identidad del modelo

### Variables, unidades y uso en Orbit

Cada \(\mathbf a_i\) se calcula en km/s² en el núcleo Cowell antes de formar \(\mathbf a\). La suma no añade por defecto términos ausentes: `force_terms` define el subconjunto, mientras que `central` permanece obligatorio. La salida pública se convierte después a SI en `StateVector`.

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

Consulte las secciones [gravitacionales](point-mass.md) y [no gravitacionales](atmospheric-drag.md) para el detalle de cada modelo.
