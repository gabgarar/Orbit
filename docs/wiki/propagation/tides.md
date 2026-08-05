# Mareas

[Inicio](../index.md) · [Propagación](index.md) · [Modelos de fuerza](force-models.md) · [Perturbaciones lunisolares](third-bodies.md)

## Estado de soporte

Orbit no implementa aceleraciones de marea sólida terrestre, marea oceánica ni variaciones temporales del campo de gravedad. Esta página pertenece al bloque gravitacional porque esos términos modifican el potencial gravitatorio terrestre.

!!! warning "Ecuación prevista para implementación futura"

    Un modelo de marea sólida requeriría corregir los coeficientes armónicos dependientes de la posición del Sol y de la Luna:

    $$
    \Delta \bar C_{nm}(t),\ \Delta \bar S_{nm}(t)
    = f_{nm}\bigl(\mathbf r_{\odot}(t),\mathbf r_{\mathrm{Moon}}(t),k_n\bigr).
    $$

    | Símbolo | Significado | Unidad |
    | --- | --- | --- |
    | \(\Delta \bar C_{nm},\Delta \bar S_{nm}\) | Correcciones de los coeficientes armónicos normalizados. | Adimensionales. |
    | \(n,m\) | Grado y orden armónicos. | Enteros adimensionales. |
    | \(\mathbf r_{\odot},\mathbf r_{\mathrm{Moon}}\) | Posiciones del Sol y de la Luna en un marco y época coherentes. | km. |
    | \(k_n\) | Número de Love de grado \(n\). | Adimensional. |

    No se evalúa en el runtime actual. Requeriría efemérides, convenciones IERS y un geopotencial de grado y orden superiores a los términos zonales actuales.

## Límites

La presencia de EOP en las transformaciones de marco no habilita mareas dinámicas en Cowell. Los EOP se usan para orientación terrestre; no se convierten en una aceleración de marea.
