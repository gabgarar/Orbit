# Modelos de gravedad

[Inicio](../index.md) · [Ingeniería](index.md) · [Modelos de la Tierra](earth-models.md) · [Modelos de fuerza](../propagation/force-models.md)

## Modelos disponibles

Los modelos de gravedad se aplican en la propagación manual. El catálogo TLE
usa SGP4 y no acepta esta composición como selector operativo.

| Modelo | Implementación | Uso |
| --- | --- | --- |
| Central | \(-\mu\mathbf r/r^3\) | Dos cuerpos y término obligatorio de Cowell. |
| J2, J3, J4 numéricos | Armónicos zonales no normalizados WGS-84 | Términos independientes de Cowell o preset histórico. |
| Geopotencial completo | No disponible | No hay coeficientes \(C_{nm},S_{nm}\) ni grado/orden configurable. |

## Términos zonales de Cowell

Cowell mantiene siempre la gravedad central y puede componer `j2`, `j3` y
`j4`. Los coeficientes incluidos son:

| Coeficiente | Valor |
| --- | ---: |
| \(J_2\) | \(1.08262668355315\times10^{-3}\) |
| \(J_3\) | \(-2.53265648533224\times10^{-6}\) |
| \(J_4\) | \(-1.61962159136700\times10^{-6}\) |

El potencial zonal se implementa a partir de los polinomios de Legendre para
los grados 2 a 4. El eje \(z\) de los términos se trata como eje de giro
terrestre compatible con el marco inercial de primer orden; no se introduce
una transformación dinámica completa de las fuerzas al marco terrestre.

## Selección

| Ruta | Selección disponible |
| --- | --- |
| Dos cuerpos | Solo gravedad central. |
| `cowell-rk4` | `central`, `j2`, `j3`, `j4` y `drag` como términos explícitos. |
| `j2-j3-j4` | Preset histórico fijo J2+J3+J4, sin drag. |

Los nombres heredados `two-body`, `j2` y `j2-j3-j4` se normalizan a su
composición Cowell cuando se utilizan como preset de `cowell-rk4`.

!!! warning "No es un geopotencial de misión"

    La composición J2/J3/J4 no representa un campo completo ni sustituye una
    propagación de alta fidelidad, OD o validación de misión. No hay términos
    tesseral/sectorial, mareas, variación temporal ni grado y orden configurables.
