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
| [Salida y procedencia](cowell/output.md) | Métodos de consulta, marcos y metadatos. |
| [Fallos y límites](cowell/limits.md) | Fronteras de fidelidad y condiciones de rechazo. |

$$
\frac{d}{dt}\begin{bmatrix}\mathbf r\\\mathbf v\end{bmatrix}
=\begin{bmatrix}\mathbf v\\\mathbf a_{central}+\sum\mathbf a_{término}\end{bmatrix}.
$$

Consulte también [Modelos de fuerza](force-models.md),
[Arrastre atmosférico](atmospheric-drag.md) y
[Modelos de gravedad](../engineering/gravity-models.md).
