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

## Alcance futuro

La implementación exigiría definir el cuerpo perturbador, la familia de
resonancia y el modelo dinámico de referencia; no debe inferirse a partir de
una trayectoria visual.
