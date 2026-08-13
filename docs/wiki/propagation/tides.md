# Mareas y variación temporal del campo

[Inicio](../index.md) · [Propagación](index.md) · [Modelos de fuerza](force-models.md) · [Terceros cuerpos](third-bodies.md)

## Estado

Las mareas no forman parte de esta entrega. El geopotencial estático de
grado/orden configurable y las perturbaciones directas Sol/Luna no deben
interpretarse como soporte de marea sólida, marea oceánica ni variación temporal
del campo de gravedad.

## Qué falta para habilitarlas

Un modelo de mareas requiere actualizar los coeficientes armónicos con
convenciones y datos coherentes:

$$
\Delta \bar C_{nm}(t),\ \Delta \bar S_{nm}(t)
=f_{nm}\bigl(\mathbf r_\odot(t),\mathbf r_{\mathrm{Moon}}(t),k_n,\mathrm{IERS}\bigr).
$$

| Componente pendiente | Razón |
| --- | --- |
| Mareas sólidas terrestres | Números de Love, Sol/Luna y convenciones IERS aplicables. |
| Mareas oceánicas | Conjunto de constituyentes, modelo oceánico y normalización verificables. |
| Carga atmosférica y polar | Productos geofísicos y su convención de referencia. |
| Tendencias y estacionales | Política explícita para \(\dot C_{nm},\dot S_{nm}\) y época de referencia. |
| Validación externa | Casos de referencia y tolerancias frente a una implementación independiente. |

Estos términos se evaluarían en ITRF en cada etapa RK4 y regresarían como
aceleración libre a <code>EME2000</code>. No basta con disponer de EOP: EOP
orienta la Tierra, pero no proporciona por sí mismo los coeficientes de marea.

## Regla operativa

Mientras no estén implementadas, Orbit debe publicar que el campo es estático
respecto a las mareas. No se puede inferir una precisión de misión a partir de
activar Sol, Luna o geopotencial.
