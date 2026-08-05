# Propagación Cowell

[Inicio](../index.md) · [Propagación](index.md) · [Integradores numéricos](numerical-integrators.md)

`CowellPropagator` es la ruta numérica configurable para estados manuales
terrestres. Integra directamente la ecuación de movimiento y entrega estados
nativos `EME2000`. Está pensada para vistas y estudios manuales acotados.

## Secciones

| Tema | Contenido |
| --- | --- |
| [Entrada y fuerzas](cowell/input-and-forces.md) | Estado inicial, términos admitidos y presets. |
| [Integración y caché](cowell/integration.md) | RK4 de paso fijo y reutilización de estados. |
| [Tiempo y marcos](cowell/time-and-frames.md) | UTC, TT, UT1, EOP y transformación de EME2000 a ITRF. |
| [Salida y procedencia](cowell/output.md) | Métodos de consulta y metadatos del estado publicado. |
| [Uso recomendado](cowell/recommended-use.md) | Casos de uso adecuados y situaciones que requieren otra herramienta. |
| [Fallos y límites](cowell/limits.md) | Fronteras de fidelidad y condiciones de rechazo. |

$$
\frac{d}{dt}\begin{bmatrix}\mathbf r\\\mathbf v\end{bmatrix}
=\begin{bmatrix}\mathbf v\\\mathbf a_{\mathrm{central}}+\sum_{i\in\mathcal T}\mathbf a_i\end{bmatrix}.
$$

## Interpretación de la ecuación

El estado que recibe Cowell es \(\mathbf y=[\mathbf r,\mathbf v]^T\). Su derivada tiene dos partes: la derivada de la posición es la velocidad, y la derivada de la velocidad es la aceleración total. Cowell construye esa función \(\mathbf f(t,\mathbf y)=\dot{\mathbf y}\); [RK4](rk4.md) únicamente la evalúa para avanzar el estado.

| Símbolo | Significado | Unidades internas de Cowell |
| --- | --- | --- |
| \(t\) | Instante de integración. | s respecto a la época inicial. |
| \(\mathbf r\) | Vector de posición del objeto. | km. |
| \(\mathbf v\) | Vector de velocidad del objeto. | km/s. |
| \(\mathbf a_{\mathrm{central}}\) | Aceleración por gravedad central, siempre presente. | km/s². |
| \(\mathcal T\) | Conjunto de términos opcionales solicitados en `force_terms`. | No aplica. |
| \(\mathbf a_i\) | Aceleración aportada por cada término \(i\) de \(\mathcal T\). | km/s². |

La suma contiene solo términos seleccionados. La ecuación expresa la física del propagador; no describe el algoritmo RK4 ni impone por sí sola un paso de integración.

## Formulación cartesiana y modelos analíticos

Cowell es un propagador de dinámica cartesiana: integra directamente \(\mathbf r\) y \(\mathbf v\) mediante \(\ddot{\mathbf r}=\mathbf a(\mathbf r,\mathbf v,t)\) en `EME2000`. Puede recibir una órbita manual que se haya descrito originalmente con elementos, pero durante la integración no usa esos elementos como variables de estado.

Por tanto, este camino no integra ecuaciones de Gauss ni de Lagrange, no resuelve Kepler perturbado y no mantiene un plano orbital o un sistema nodal como parte del estado numérico. Esas formulaciones pertenecen a propagadores analíticos o variacionales; Cowell solo necesita la aceleración cartesiana total en cada evaluación.

## Marco de evaluación de las fuerzas

Durante la integración, Cowell mantiene el estado y suma las aceleraciones en `EME2000`, usando km, km/s y km/s². El paso posterior a `ITRF` pertenece al servicio de transformación de marcos y ocurre después de obtener el estado nativo integrado.

| Término | Marco usado hoy | Interpretación |
| --- | --- | --- |
| Gravedad central | `EME2000`. | Es invariante ante una rotación del sistema de coordenadas. |
| J2, J3 y J4 | `EME2000`. | Son términos zonales \(m=0\); la implementación de compatibilidad trata el eje \(Z\) de `EME2000` como eje de giro terrestre. |
| Arrastre atmosférico | `EME2000`. | Calcula \(\mathbf v_{rel}=\mathbf v-\omega_\oplus\times\mathbf r\) para una atmósfera corrotante y estima la altura WGS-84 con esas mismas coordenadas. |

Esta elección mantiene una única derivada en el marco nativo y es suficiente para el alcance de diseño interactivo actual. No equivale a evaluar cada término terrestre en una realización ITRF instantánea: no aplica precesión, nutación, rotación terrestre ni movimiento polar dentro de cada evaluación de fuerza.

!!! warning "Arquitectura de marcos prevista para implementación futura"

    Para una propagación de mayor fidelidad, el estado seguirá integrándose en un marco celeste o inercial, pero los términos ligados a la Tierra se evaluarán temporalmente en un marco terrestre:

    $$
    \mathbf a_{\mathrm{inercial}}=R_{\mathrm{ITRF}\rightarrow\mathrm{inercial}}(t)\;\mathbf a_{\mathrm{ITRF}}.
    $$

    | Elemento | Uso previsto |
    | --- | --- |
    | \(R_{\mathrm{ITRF}\rightarrow\mathrm{inercial}}(t)\) | Rotación terrestre dependiente de época, basada en EOP y escalas temporales adecuadas. |
    | \(\mathbf a_{\mathrm{ITRF}}\) | Aceleración evaluada en el marco terrestre; aplicable a drag, geopotencial de grado y orden alto, mareas y albedo. |
    | \(\mathbf a_{\mathrm{inercial}}\) | Aceleración rotada al marco en el que se integra el estado. |

    Este flujo todavía no se ejecuta en Cowell. Tampoco están implementados geopotencial completo, mareas ni albedo; su presencia en la documentación no habilita esos términos.

## Cómo encaja Cowell en Orbit

Cowell no es una única fórmula ni RK4 es un modelo de órbita. Cada componente tiene una responsabilidad separada:

| Pieza | Responsabilidad |
| --- | --- |
| Estado en `EME2000` | Define dónde está el objeto y cómo se mueve en el marco inercial de integración. |
| Modelo de fuerzas | Define la aceleración total: gravedad central obligatoria y los términos seleccionados. |
| Cowell | Convierte el estado y las fuerzas en la derivada cartesiana \(\mathbf f(t,\mathbf y)\). Es el propagador físico. |
| RK4 | Evalúa cuatro veces esa derivada para avanzar un paso. Es el integrador numérico. |
| Caché de estados | Reutiliza el estado integrado más cercano para no repetir todo el arco en consultas sucesivas. No modifica la física ni mejora la precisión. |
| Transformación de marcos | Convierte el estado nativo integrado a `ITRF` u otro marco solicitado para su consumo. |

En una consulta, Orbit parte del estado manual en `EME2000`, Cowell construye la aceleración con el modelo de fuerzas, RK4 avanza el estado y el resultado nativo se guarda en caché. Solo después se transforma el estado al marco que pide el renderer, la API o una exportación. Separar estas responsabilidades evita confundir una fuerza con un integrador o una transformación de coordenadas con propagación física.

Consulte también [Modelos de fuerza](force-models.md),
[Arrastre atmosférico](atmospheric-drag.md) y
[Modelos de gravedad](../engineering/gravity-models.md).
