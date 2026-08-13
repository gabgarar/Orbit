# Actitud

[Inicio](../index.md) · [Propagación](index.md) · [Resonancias](resonances.md)

## Estado

Orbit no propaga actitud. El modelo SRP *cannonball* previsto usa un área
efectiva fija; no debe interpretarse como una dinámica de vehículo rígido ni
como una sustitución de cuaternios.

## Trabajo pendiente

| Capacidad | Uso posterior |
| --- | --- |
| Estado de cuaternión y cinemática | Orientar el cuerpo sin singularidades de Euler. |
| Ecuaciones de Euler y tensor de inercia | Rotación rígida y respuesta a pares. |
| Actuadores y leyes de control | Ruedas, magnetorquers, propulsión y maniobras. |
| Geometría de placas | Área de drag/SRP proyectada, auto-sombra y temperatura. |
| Acoplamiento traslación–actitud | Fuerzas dependientes de orientación en cada etapa. |
| Eventos y validación | Entrada/salida de eclipse, saturación y casos de referencia. |

La base matemática futura requiere:

$$
\dot{\mathbf q}=\frac{1}{2}\Omega(\mathbf\omega)\mathbf q,
\qquad I\dot{\mathbf\omega}+\mathbf\omega\times(I\mathbf\omega)=\mathbf\tau.
$$

Hasta entonces, la masa y el área de drag/SRP son parámetros constantes y la
orientación no forma parte de la incertidumbre ni de la procedencia del estado.
