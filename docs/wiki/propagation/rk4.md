# RK4

[Inicio](../index.md) · [Propagación](index.md) · [Integradores numéricos](numerical-integrators.md)

## Visión general

Runge–Kutta clásico de cuarto orden (RK4) es el único integrador numérico disponible actualmente en Orbit. Cowell lo utiliza para integrar el estado cartesiano con la composición de fuerzas seleccionada.

## Paso aplicado

Para el sistema \(\dot y=f(t,y)\), con paso \(h\), Orbit aplica:

$$
\begin{aligned}
k_1 &= f(t,y),\\
k_2 &= f(t+h/2,y+hk_1/2),\\
k_3 &= f(t+h/2,y+hk_2/2),\\
k_4 &= f(t+h,y+hk_3),\\
y_{n+1} &= y_n+\frac{h}{6}(k_1+2k_2+2k_3+k_4).
\end{aligned}
$$

| Variable | Uso y unidades en Orbit |
| --- | --- |
| \(y\) | Estado integrado; para Cowell contiene posición en km y velocidad en km/s. |
| \(t\) | Instante de integración, en segundos respecto a la época del estado. |
| \(h\) | Paso de integración, en s; por defecto es 60 s. |
| \(f(t,y)\) | Derivada del estado: velocidad y aceleración, en km/s y km/s². |
| \(k_1\ldots k_4\) | Evaluaciones intermedias de la derivada con las mismas unidades que \(f\). |

El último paso se reduce cuando es necesario para alcanzar exactamente el instante solicitado. En propagación hacia el pasado, \(h\) toma signo negativo.

## Uso actual

`CowellPropagator.integration_step_seconds` tiene un valor de 60 s. El preset histórico J2+J3+J4 usa el mismo núcleo RK4, aunque conserva su identidad de modelo. SGP4 y los propagadores analíticos no usan RK4.

## Límites

RK4 de paso fijo no ofrece control adaptativo de error, localización de eventos, integración simpléctica ni propagación de STM o covarianza. La precisión depende de la órbita, las fuerzas activas, el arco y el paso; debe validarse para cada caso de uso.
