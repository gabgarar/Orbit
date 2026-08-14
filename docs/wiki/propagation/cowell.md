# Propagación Cowell

[Inicio](../index.md) · [Propagación](index.md) · [Integradores numéricos](numerical-integrators.md)

`CowellPropagator` es la ruta numérica configurable para estados manuales
terrestres. Integra directamente la ecuación de movimiento y entrega estados
nativos `EME2000`. Está pensada para diseño, visualización y estudios acotados;
no certifica una efeméride operacional por sí sola.

## Secciones

| Tema | Contenido |
| --- | --- |
| [Entrada y fuerzas](cowell/input-and-forces.md) | Estado inicial, términos admitidos y presets. |
| [Integración y caché](cowell/integration.md) | RK4 de paso fijo y reutilización de estados. |
| [Tiempo y marcos](cowell/time-and-frames.md) | UTC, TT, UT1, EOP y evaluación terrestre por etapa. |
| [Salida y procedencia](cowell/output.md) | Métodos de consulta y metadatos del estado publicado. |
| [Uso recomendado](cowell/recommended-use.md) | Casos de uso adecuados y situaciones que requieren otra herramienta. |
| [Fallos y límites](cowell/limits.md) | Fronteras de fidelidad y condiciones de rechazo. |

$$
\frac{d}{dt}\begin{bmatrix}\mathbf r\\\mathbf v\end{bmatrix}
=\begin{bmatrix}\mathbf v\\\mathbf a_{\mathrm{central}}+
\sum_{i\in\mathcal T}\mathbf a_i\end{bmatrix}.
$$

## Interpretación de la ecuación

El estado es \(\mathbf y=[\mathbf r,\mathbf v]^T\). Su derivada tiene dos
partes: posición a velocidad y velocidad a aceleración total. Cowell construye
\(\mathbf f(t,\mathbf y)=\dot{\mathbf y}\); [RK4](rk4.md) solo evalúa esa
función para avanzar el estado.

| Símbolo | Significado | Unidades internas |
| --- | --- | --- |
| \(t\) | Instante de integración. | s desde la época inicial. |
| \(\mathbf r\), \(\mathbf v\) | Posición y velocidad del objeto. | km, km/s. |
| \(\mathbf a_{\mathrm{central}}\) | Gravedad central, siempre presente. | km/s². |
| \(\mathcal T\) | Conjunto de `force_terms` adicionales. | No aplica. |
| \(\mathbf a_i\) | Aceleración de cada término opcional. | km/s². |

## Marco de la dinámica y marco de cada fuerza

El estado y la derivada final se mantienen en `EME2000`. Esto no significa que
cada modelo se evalúe físicamente en ese marco:

| Término | Marco de evaluación | Situación |
| --- | --- | --- |
| Central | `EME2000`. | Invariante ante rotación. |
| `j2`, `j3`, `j4` | Compatibilidad en `EME2000`. | Heredado; aproxima el eje terrestre como fijo. |
| `drag` | `ITRF` instantáneo, devuelto a `EME2000`. | Disponible; usa IERS C01 automático o rotación nominal etiquetada, además de leap seconds y ERFA. |
| `geopotential` | `ITRF` instantáneo, devuelto a `EME2000`. | Disponible con campo validado e IERS C01 automático o rotación nominal etiquetada, además de leap seconds y ERFA. |
| Sol, Luna, SRP y relatividad | Marco celeste/inercial coherente con `EME2000`. | Disponibles con contratos propios de época, cobertura y procedencia. |

Para un término terrestre de alta fidelidad, Cowell no integra en un marco
rotante. En cada una de las cuatro etapas RK4 transforma la posición —y la
velocidad cuando el modelo la necesita— a ITRF, evalúa la fuerza, y rota la
aceleración libre al marco inercial. Véase [Tiempo y marcos](cowell/time-and-frames.md).

## Cómo encaja Cowell en Orbit

| Pieza | Responsabilidad |
| --- | --- |
| Estado `EME2000` | Define el estado inercial integrado. |
| Modelo de fuerzas | Construye aceleración total y declara sus datos/procedencia. |
| Cowell | Convierte estado y fuerzas en \(\mathbf f(t,\mathbf y)\). |
| RK4 | Evalúa cuatro veces la derivada para avanzar un paso. |
| Caché de estados | Reutiliza estados cercanos; no altera la física ni la precisión. |
| Servicio de marcos | Proporciona la orientación de época requerida por términos y por salida. |

En una consulta, Orbit parte del estado manual en `EME2000`, compone las
aceleraciones válidas para cada etapa, integra, conserva el estado nativo en
caché y solo entonces publica el marco solicitado por renderer, API o
exportación. Separar esas responsabilidades evita confundir una fuerza, un
integrador y una transformación de coordenadas.

Consulte [Modelos de fuerza](force-models.md),
[Geopotencial configurable](full-geopotential.md) y
[Arrastre atmosférico](atmospheric-drag.md).
