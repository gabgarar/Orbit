# Cowell: salida y procedencia

[Propagación](../index.md) · [Cowell](../cowell.md) · [Marcos de referencia](../../engineering/reference-frames.md)

## Métodos de salida

| Método | Resultado |
| --- | --- |
| `native_state_at` | `StateVector` EME2000/UTC/SI con `propagator=cowell-rk4`. |
| `state_at` | Transformación explícita al marco pedido. |
| `propagate_datetime` | Adaptador ITRF SI de seis componentes. |

## Procedencia

La procedencia declara que los términos terrestres usan el modelo compatible
de ejes inerciales de primer orden. Esto evita presentar el resultado como una
fuerza terrestre completa transformada en cada paso.

La cadena temporal y de marcos de `EME2000` a `ITRF` se explica por separado
en [Tiempo y marcos](time-and-frames.md).

## Referencias relacionadas

- [Estados cartesianos](../../engineering/cartesian-states.md)
- [Marcos de referencia](../../engineering/reference-frames.md)
