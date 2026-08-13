# Integradores numéricos

[Inicio](../index.md) · [Propagación](index.md) · [Propagadores](overview.md) · [RK4](rk4.md)

## Qué hace un integrador

Un integrador numérico aproxima la solución de:

$$
\dot{\mathbf y}=\mathbf f(t,\mathbf y),
\qquad
\mathbf y(t_0)=\mathbf y_0.
$$

No define la física: recibe la derivada de Cowell y avanza el estado. Los nuevos
modelos de fuerzas deben evaluarse con la época de cada etapa, pero no cambian
por sí mismos el método ni convierten un paso fijo en uno adaptativo.

## Integrador disponible

Orbit usa Runge–Kutta clásico de cuarto orden (RK4) de paso fijo para
<code>CowellPropagator</code>. Para un paso \(h\):

$$
\begin{aligned}
\mathbf k_1 &= \mathbf f(t_n,\mathbf y_n),\\
\mathbf k_2 &= \mathbf f\!\left(t_n+\frac{h}{2},\mathbf y_n+\frac{h}{2}\mathbf k_1\right),\\
\mathbf k_3 &= \mathbf f\!\left(t_n+\frac{h}{2},\mathbf y_n+\frac{h}{2}\mathbf k_2\right),\\
\mathbf k_4 &= \mathbf f(t_n+h,\mathbf y_n+h\mathbf k_3),\\
\mathbf y_{n+1} &= \mathbf y_n+\frac{h}{6}(\mathbf k_1+2\mathbf k_2+2\mathbf k_3+\mathbf k_4).
\end{aligned}
$$

| Símbolo | Uso y unidades en Orbit |
| --- | --- |
| \(t_n\) | Instante de etapa, s desde la época integrada. |
| \(h\) | Paso de integración, s; nominalmente 60 s. |
| \(\mathbf y_n\) | Estado cartesiano, km y km/s. |
| \(\mathbf f\) | Derivada, km/s y km/s². |
| \(\mathbf k_1\ldots\mathbf k_4\) | Evaluaciones de la derivada en sus épocas propias. |

El último paso se reduce para alcanzar exactamente el instante solicitado. La
propagación hacia atrás usa \(h<0\).

## Qué queda pendiente

| Capacidad | Motivo para no prometerla aún |
| --- | --- |
| Dormand–Prince / RKF45 adaptativo | Necesita tolerancias, estimador de error, rechazos de paso y contrato de rendimiento. |
| Localización de eventos | Requiere búsqueda de raíces para eclipse, impacto, AOS/LOS o maniobra. |
| Integradores simplécticos / multistep | Requieren estudio de estabilidad y de interacción con fuerzas dependientes del tiempo. |
| STM y covarianza | Requieren ecuaciones variacionales y contrato de incertidumbre. |
| Maniobras | Requieren eventos, marcos y masa/impulso explícitos. |

En particular, el eclipse cilíndrico de SRP es discontinuo. Con RK4 fijo, su
transición solo se resuelve a la granularidad del paso; una herramienta de
misión deberá añadir detección de eventos y control adaptativo antes de declarar
precisión en el instante de entrada o salida de sombra.

## Validación

La precisión debe validarse para cada arco, paso y composición de fuerzas. Las
pruebas deben comprobar reproducción de puntos, convergencia al reducir paso,
conservación esperada para modelos conservativos y comparación contra una
efeméride de referencia cuando el caso lo requiera. Orbit no publica una
tolerancia general de precisión para la ruta Cowell/RK4.
