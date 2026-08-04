# Cowell: entrada y fuerzas

[Propagación](../index.md) · [Cowell](../cowell.md) · [Integradores numéricos](../numerical-integrators.md)

## Estado inicial

El constructor recibe una época UTC y un estado cartesiano manual en km y
km/s. Acepta las claves canónicas:

```text
position_eme2000_km: {x, y, z}
velocity_eme2000_km_s: {x, y, z}
```

Se mantienen `position_eci_km` y `velocity_eci_km_s` como alias heredados,
interpretados con la misma compatibilidad `EME2000`. El radio inicial debe
estar fuera de la Tierra y todos los componentes deben ser finitos.

## Composición de fuerzas

La gravedad central siempre se incluye. Los términos admitidos son:

| Término | Identificador | Parámetros |
| --- | --- | --- |
| Central | `central` | Ninguno. |
| Oblaticidad | `j2`, `j3`, `j4` | Coeficientes WGS-84 internos. |
| Arrastre | `drag` | `drag_coefficient`, `area_m2`, `mass_kg`. |

`force_terms` puede ser una lista o cadena. Los presets heredados `two-body`,
`j2` y `j2-j3-j4` se expanden a la composición correspondiente. Una
composición explícita prevalece sobre los campos heredados de gravedad y
arrastre.

## Referencias relacionadas

- [Modelos de fuerza](../force-models.md)
- [Arrastre atmosférico](../atmospheric-drag.md)
- [Modelos de gravedad](../../engineering/gravity-models.md)
