# Resonancias

[Inicio](../index.md) · [Propagación](index.md) · [Actitud](attitude.md)

## Estado de soporte

Orbit no implementa un modelo de resonancias orbitales. Las rutas disponibles
no detectan, propagan ni corrigen ángulos resonantes.

!!! warning "Ecuación prevista para implementación futura"

    Una condición resonante puede expresarse mediante un ángulo crítico y su
    derivada aproximadamente nula:

    $$
    \phi=k_1\lambda+k_2\lambda_b+k_3\varpi+k_4\Omega,
    \qquad \dot\phi\approx0.
    $$

    | Símbolo | Significado | Unidad |
    | --- | --- | --- |
    | \(\phi\) | Ángulo crítico resonante. | rad. |
    | \(\lambda\), \(\lambda_b\), \(\varpi\), \(\Omega\) | Longitudes orbitales, del cuerpo perturbador, periapsis y nodo. | rad. |
    | \(k_1\ldots k_4\) | Enteros que definen la familia resonante. | Adimensionales. |
    | \(\dot\phi\) | Tasa del ángulo crítico. | rad/s. |

    Orbit no calcula este ángulo ni sus tasas; las unidades se indican para un
    futuro modelo dinámico, no para el visor.

## Alcance futuro

La implementación exigiría definir el cuerpo perturbador, la familia de
resonancia y el modelo dinámico de referencia; no debe inferirse a partir de
una trayectoria visual.
