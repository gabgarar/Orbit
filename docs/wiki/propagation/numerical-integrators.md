# Integradores numéricos

[Inicio](../index.md) · [Propagación](index.md) · [Propagadores](overview.md) · [RK4](rk4.md)

## Descripción del método

Un integrador numérico aproxima la solución de un problema de valor inicial:

$$
\dot{\mathbf y}=\mathbf f(t,\mathbf y),
\qquad
\mathbf y(t_0)=\mathbf y_0.
$$

El integrador no define la dinámica ni selecciona términos físicos. Recibe la derivada \(\mathbf f\) de un propagador y avanza el estado entre dos instantes. En Orbit, el integrador numérico disponible es Runge–Kutta clásico de cuarto orden (RK4), de paso fijo.

## Ecuaciones de RK4

Para un paso \(h\), RK4 evalúa cuatro pendientes y forma una media ponderada:

$$
\begin{aligned}
\mathbf k_1 &= \mathbf f(t_n,\mathbf y_n),\\
\mathbf k_2 &= \mathbf f\!\left(t_n+\frac{h}{2},\mathbf y_n+\frac{h}{2}\mathbf k_1\right),\\
\mathbf k_3 &= \mathbf f\!\left(t_n+\frac{h}{2},\mathbf y_n+\frac{h}{2}\mathbf k_2\right),\\
\mathbf k_4 &= \mathbf f(t_n+h,\mathbf y_n+h\mathbf k_3),\\
\mathbf y_{n+1} &= \mathbf y_n+\frac{h}{6}\left(\mathbf k_1+2\mathbf k_2+2\mathbf k_3+\mathbf k_4\right).
\end{aligned}
$$

| Símbolo | Significado | Unidades en Orbit |
| --- | --- | --- |
| \(t_n\) | Instante inicial del paso. | s respecto a la época integrada. |
| \(h\) | Tamaño y sentido del paso. | s. |
| \(\mathbf y_n\) | Estado al inicio del paso. | Para el estado cartesiano: km y km/s. |
| \(\mathbf f\) | Derivada entregada por el propagador. | Para el estado cartesiano: km/s y km/s². |
| \(\mathbf k_1\ldots\mathbf k_4\) | Pendientes intermedias. | Las mismas que \(\mathbf f\). |

En un estado cartesiano, la primera parte de \(\mathbf f\) es la velocidad y la segunda es la aceleración. Esa interpretación no altera RK4: el método opera sobre cualquier vector de estado y su derivada compatible.

## Aplicación en Orbit

`CowellPropagator` utiliza el núcleo RK4 con `integration_step_seconds = 60`. El propagador construye su derivada de estado y el integrador la evalúa sin conocer el origen de sus componentes.

El último paso se reduce cuando es necesario para llegar exactamente al instante solicitado. Para una propagación hacia el pasado, \(h\) es negativo. La ruta de inspección limita las solicitudes a 7200 pasos internos estimados de 60 s, contando la distancia desde la época y las muestras pedidas. Es un límite operativo del inspector; no cambia el método RK4 ni es una tolerancia de precisión.

## Limitaciones

RK4 de paso fijo no proporciona:

- control adaptativo de error local o global;
- variación automática de paso ante cambios rápidos del estado;
- integración simpléctica, multistep o Gauss–Jackson;
- localización de eventos mediante búsqueda de raíces;
- propagación de matriz de transición de estado o covarianza.

La precisión depende del intervalo integrado, del paso fijo y de la derivada que reciba el integrador. Debe validarse para cada caso de uso; Orbit no publica una tolerancia general para este camino numérico.

## Notas de implementación

- El paso nominal se expresa en segundos y mantiene el signo del intervalo.
- Las cuatro evaluaciones se calculan de forma secuencial para cada paso RK4.
- No se interpola entre pasos: el integrador ejecuta un último paso reducido cuando el instante de destino no coincide con la malla nominal.
- El integrador no conserva por sí mismo estados, caché ni procedencia; esas responsabilidades pertenecen al propagador que lo utiliza.
