# Integradores numéricos

[Inicio](../index.md) · [Propagación](index.md) · [Cowell](cowell.md) · [Modelos de fuerza](force-models.md)

## Integrador disponible

El único integrador numérico del runtime es Runge–Kutta clásico de cuarto orden
(RK4) de paso fijo. `CowellPropagator.integration_step_seconds` vale 60 s.
El preset histórico J2+J3+J4 delega en el mismo núcleo RK4 y mantiene su propia
identidad de modelo.

Para un sistema \(\dot y=f(t,y)\), el paso aplicado es:

$$
\begin{aligned}
k_1 &= f(t,y),\\
k_2 &= f(t+h/2,y+hk_1/2),\\
k_3 &= f(t+h/2,y+hk_2/2),\\
k_4 &= f(t+h,y+hk_3),\\
y_{n+1} &= y_n+\frac{h}{6}(k_1+2k_2+2k_3+k_4).
\end{aligned}
$$

El último paso de un intervalo se reduce para alcanzar exactamente el instante
solicitado. Los intervalos negativos se integran con signo negativo.

## Aplicación por propagador

| Propagador | Método | Paso | Adaptación |
| --- | --- | ---: | --- |
| Dos cuerpos | Analítico | No aplica | No aplica. |
| J2 de compatibilidad | Analítico secular | No aplica | No aplica. |
| Cowell | RK4 clásico | 60 s | No disponible. |
| J2+J3+J4 | RK4 clásico | 60 s | No disponible. |
| SGP4 | Motor SGP4 de biblioteca | No expone paso Cowell | No aplica. |

## Presupuesto de inspección

La ruta de parámetros orbitales limita las solicitudes numéricas a 7200 pasos
internos estimados de 60 s, incluyendo distancia desde la época manual y el
coste de muestras solicitadas. Las solicitudes que superan ese presupuesto se
rechazan con un error accionable en vez de bloquear el servicio.

Esta restricción es específica del inspector. No convierte el integrador en
una herramienta para arcos arbitrariamente largos.

## Limitaciones de precisión

RK4 de paso fijo no proporciona:

- control de error local o global;
- cambio de paso por perigeo, drag o dinámica rápida;
- integradores simplécticos, multistep, Gauss–Jackson o variacionales;
- propagación de matriz de transición o covarianza;
- localización de eventos por búsqueda de raíces.

No deben publicarse tolerancias de precisión generales para Cowell. La
precisión depende de la órbita, términos activados, arco y paso fijo, y debe
validarse externamente para cada caso de uso.
