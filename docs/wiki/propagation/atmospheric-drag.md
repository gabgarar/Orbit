# Arrastre atmosférico

[Inicio](../index.md) · [Propagación](index.md) · [Cowell](cowell.md) · [Modelo atmosférico](../engineering/atmospheric-models.md)

## Disponibilidad

El arrastre está disponible únicamente como término `drag` de `cowell-rk4`.
No está disponible en dos cuerpos, J2 analítico, el preset fijo J2+J3+J4 ni
SGP4 configurable desde Orbit.

## Modelo aplicado

Con \(B=C_DA/m\), densidad \(\rho\) y velocidad relativa a una atmósfera
corrotante \(\mathbf v_{rel}\), Cowell aplica:

$$
\mathbf a_{drag}=-\frac{1}{2}B\rho\lVert\mathbf v_{rel}\rVert\mathbf v_{rel}.
$$

La implementación calcula la velocidad relativa mediante el término de
rotación terrestre y evalúa una densidad exponencial por capas usando la
altura WGS-84. El cálculo interno conserva km y km/s, con conversiones para
mantener coherencia dimensional con los parámetros de arrastre en SI.

## Parámetros

| Parámetro | Unidad | Restricción |
| --- | --- | --- |
| `drag_coefficient` | — | Finito y mayor que cero; valor predeterminado 2,2. |
| `area_m2` | m² | Finito y mayor que cero; valor predeterminado 1. |
| `mass_kg` | kg | Finito y mayor que cero; valor predeterminado 100. |

El coeficiente balístico usado es \(C_DA/m\). Si se usa `force_terms`, debe
incluirse `drag`; el booleano heredado `atmospheric_drag` no añade el término a
una composición explícita.

## Límites

- La densidad se fija a cero a partir de 1500 km.
- No hay flujo solar, índices geomagnéticos, viento, actitud, área variable ni
  modelo NRLMSISE/JB2008/DTM.
- No se ofrece una precisión de decaimiento ni tiempo de reentrada.

El modelo es útil para explorar el efecto cualitativo del arrastre en órbitas
manuales, no para predicción operacional. Véase
[Modelo atmosférico](../engineering/atmospheric-models.md).
