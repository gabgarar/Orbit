# Elementos keplerianos

[Inicio](../index.md) · [Ingeniería](index.md) · [Representaciones orbitales](orbit-representations.md) · [Dos cuerpos](../propagation/two-body.md)

## Contrato de entrada manual

`ClassicalElements` representa elementos medios elípticos, geocéntricos y
ligados a la época de una órbita manual. La entrada pública se expresa en km y
grados; el propagador produce estados nativos en `EME2000`.

| Campo de entrada | Símbolo | Unidad | Restricción validada |
| --- | --- | --- | --- |
| `semi_major_axis_km` | \(a\) | km | \(a>0\). |
| `eccentricity` | \(e\) | — | \(0\le e<1\). |
| `inclination_deg` | \(i\) | grados | \(0\le i\le180\). |
| `raan_deg` | \(\Omega\) | grados | Se normaliza a \([0,2\pi)\). |
| `argument_of_perigee_deg` | \(\omega\) | grados | Se normaliza a \([0,2\pi)\). |
| `mean_anomaly_deg` | \(M\) | grados | Se normaliza a \([0,2\pi)\). |

El radio de perigeo debe cumplir \(a(1-e)>R_e\), con el radio ecuatorial
terrestre usado por el modelo. La validación evita iniciar una órbita manual
dentro de la Tierra.

## Dinámica de dos cuerpos

Para el modelo idealizado:

$$
n=\sqrt{\frac{\mu}{a^3}}, \qquad M(t)=M_0+n\Delta t,
$$

donde \(\mu=398600.4418\ \mathrm{km^3/s^2}\) es la constante terrestre
usada por el módulo clásico. La ecuación de Kepler elíptica se resuelve por
Newton con un máximo de 64 iteraciones y tolerancia de corrección
\(10^{-13}\).

El estado perifocal se rota con \(R_3(\Omega)R_1(i)R_3(\omega)\) al marco
`EME2000`. Los nombres históricos de funciones que incluyen `eci` se
mantienen solo como adaptadores; no cambian el marco declarado.

## Uso por el modelo J2

### Variables, unidades y uso en Orbit

\(a\) se introduce en km, \(e\) es adimensional y las anomalías, inclinación, RAAN y argumento de periapsis se reciben en grados y se convierten a radianes. \(n\) queda en rad/s y \(M\) en radianes; estos valores alimentan únicamente los propagadores manuales de dos cuerpos y J2.

El propagador J2 de compatibilidad mantiene \(a\), \(e\) e \(i\) constantes y
aplica tasas seculares a \(\Omega\), \(\omega\) y \(M\). No es un integrador
numérico ni incorpora pérdida de energía. Véase [J2](../propagation/j2.md).

## Casos no representados

- Órbitas parabólicas e hiperbólicas.
- Elementos osculadores derivados de una efeméride de forma general.
- Elementos equinocciales, Delaunay, Brouwer-Lyddane y variaciones medias de
  otros modelos.
- Covarianzas en el espacio de elementos.

Para un estado manual con perturbaciones numéricas, use el contrato cartesiano
de [Cowell](../propagation/cowell.md).
