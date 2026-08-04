# Propagación

## Visión general

Orbit separa propagación nativa y presentación solicitada. Cada motor produce su marco científico; `FrameTransformService` entrega ITRF solo cuando un consumidor lo pide.

## Propagadores

### SGP4

Acepta TLE validado y produce TEME. Es el contrato del modelo TLE, no una afirmación de fuerzas de alta fidelidad.

### Dos cuerpos y J2

Los motores manuales analíticos usan un estado de época EME2000. Dos cuerpos conserva la solución central; J2 aplica el comportamiento secular de primer orden declarado.

### Cowell

Cowell integra un estado cartesiano EME2000 con RK4 y una composición explícita de fuerzas que incluye siempre la gravedad central.

```python
CowellPropagator(epoch, state, force_terms=["central", "j2", "drag"])
```

Una composición explícita prevalece sobre presets heredados. Área, masa y coeficiente de arrastre se validan antes de integrar.

## Fuerzas e integración

Los términos disponibles incluyen J2/J3/J4, geopotencial completo, terceros cuerpos, arrastre, SRP y relatividad según el motor/configuración. La caché de Cowell guarda estados integrados por desplazamiento de época, parte del estado más cercano y no inventa interpolación; hacia el pasado usa pasos RK4 negativos.

## Límites

- La precisión depende de fuerzas, coeficientes, paso y datos de referencia.
- El EOP visual sirve para el visor, no para productos estrictos.
- OEM/SP3 importados son efemérides; no se reproporcionan por una fuerza implícita.
