# Actitud

[Inicio](../index.md) · [Propagación](index.md) · [Resonancias](resonances.md)

## Estado de soporte

Orbit no propaga actitud. No existe estado de cuaternión, dinámica rígida,
modelo de actuadores ni acoplamiento entre actitud, área expuesta y fuerzas.

!!! warning "Ecuación prevista para implementación futura"

    Un modelo de actitud requeriría al menos la cinemática del cuaternión y la
    ecuación de Euler para el cuerpo rígido:

    $$
    \dot{\mathbf q}=\frac{1}{2}\Omega(\mathbf\omega)\mathbf q,
    \qquad I\dot{\mathbf\omega}+\mathbf\omega\times(I\mathbf\omega)=\mathbf\tau.
    $$

## Alcance futuro

La actitud será necesaria antes de habilitar un SRP por superficies, área de
arrastre variable o modelos de sensores y actuadores físicamente consistentes.
