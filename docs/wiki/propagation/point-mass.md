# Gravedad de masa puntual

[Inicio](../index.md) · [Propagación](index.md) · [Dos cuerpos](two-body.md) · [Modelos de fuerza](force-models.md)

## Modelo

La gravedad central terrestre es el término base de los modelos manuales:

$$
\mathbf a_{central}=-\mu\frac{\mathbf r}{r^3}.
$$

Orbit usa \(\mu=398600.4418\ \mathrm{km^3/s^2}\) en los módulos clásicos y
Cowell. El término central está siempre activo en Cowell, incluso si la lista
de fuerzas solo menciona perturbaciones.

## Uso

| Ruta | Aplicación |
| --- | --- |
| Dos cuerpos | Es toda la dinámica y se resuelve analíticamente. |
| J2 analítico | Base sobre la que se añaden tasas seculares. |
| Cowell | Aceleración calculada en cada evaluación RK4. |
| J2+J3+J4 | Base del preset numérico. |

El modelo asume un cuerpo puntual y no incluye oblaticidad, densidad,
terceros cuerpos ni fuerza no gravitatoria. Para J2/J3/J4 consulte
[Modelos de gravedad](../engineering/gravity-models.md).
