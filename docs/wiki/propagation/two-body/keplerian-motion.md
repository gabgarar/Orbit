# Dos cuerpos: elementos y movimiento kepleriano

[Propagación](../index.md) · [Dos cuerpos](../two-body.md) · [Elementos keplerianos](../../engineering/keplerian-elements.md)

## Entrada

Orbit recibe una época UTC y los seis elementos clásicos de una órbita
elíptica geocéntrica.

| Campo | Unidad en la interfaz | Uso |
| --- | --- | --- |
| `semi_major_axis_km` | km | Tamaño de la elipse. |
| `eccentricity` | adimensional | Forma de la elipse. Solo \(0\le e<1\). |
| `inclination_deg` | grados | Inclinación del plano orbital. |
| `raan_deg` | grados | Orientación del nodo ascendente. |
| `argument_of_perigee_deg` | grados | Orientación del perigeo dentro del plano. |
| `mean_anomaly_deg` | grados | Posición orbital media en la época. |

El semieje mayor debe ser positivo, la inclinación debe estar entre 0° y 180°
y el radio de perigeo \(a(1-e)\) debe quedar por encima del radio ecuatorial
terrestre. Orbit convierte los ángulos a radianes para el cálculo interno.

## Avance analítico

En el problema de dos cuerpos, el movimiento medio solo depende de \(a\):

$$
n=\sqrt{\frac{\mu}{a^3}}, \qquad M(t)=M_0+n\,(t-t_0).
$$

\(n\) se expresa en rad/s, \(a\) en km, \(t-t_0\) en s y \(M\) en rad. Esto
significa que Orbit no simula el recorrido minuto a minuto: calcula la
anomalía media que corresponde directamente a la época solicitada.

Para una elipse, la posición no avanza uniformemente en el espacio. Orbit
resuelve la ecuación de Kepler elíptica mediante Newton acotado:

$$
M=E-e\sin E.
$$

\(E\) es la anomalía excéntrica en rad y \(e\) es la excentricidad sin
unidades. A partir de \(E\), genera posición y velocidad en el plano
perifocal y las rota con \(\Omega\), \(i\) y \(\omega\) al marco `EME2000`.

## Qué permanece constante

Como solo existe gravedad central, \(a\), \(e\), \(i\), el RAAN y el
argumento del perigeo no cambian. Solo avanza la anomalía media. Si observa
precesión nodal, decaimiento, cambios de plano o variaciones seculares, esos
efectos proceden de otro propagador o de una transformación de salida, no de
este modelo.

## Ejemplo conceptual

Dos consultas con los mismos elementos, una en \(t_0\) y otra una hora
después, describen la misma elipse. Lo único que cambia es la posición del
satélite sobre esa elipse. Esta propiedad hace que el modelo sea una buena
referencia para detectar si una diferencia posterior viene de J2, drag o del
propio método numérico.
