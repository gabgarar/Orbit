# Propagación Cowell

[Inicio](../index.md) · [Propagación](index.md) · [Integradores numéricos](numerical-integrators.md) · [Modelos de fuerza](force-models.md)

## Propósito

`CowellPropagator` es la ruta numérica configurable para estados manuales
terrestres. Integra directamente el sistema de primer orden asociado a la
ecuación de movimiento y entrega estados nativos `EME2000`.

$$
\frac{d}{dt}\begin{bmatrix}\mathbf r\\\mathbf v\end{bmatrix}
=\begin{bmatrix}\mathbf v\\\mathbf a_{central}+\sum\mathbf a_{término}\end{bmatrix}.
$$

El integrador disponible es Runge–Kutta clásico de cuarto orden, de paso fijo
de 60 s. Este diseño está orientado a vistas y estudios manuales acotados.

## Entrada

El constructor recibe una época UTC y un estado cartesiano manual en km y
km/s. Acepta las claves canónicas:

```text
position_eme2000_km: {x, y, z}
velocity_eme2000_km_s: {x, y, z}
```

Se mantienen `position_eci_km` y `velocity_eci_km_s` como alias heredados,
interpretados como la misma compatibilidad `EME2000`. El radio inicial debe
estar fuera de la Tierra y todos los componentes deben ser finitos.

## Composición de fuerzas

La gravedad central siempre se incluye. Los términos admitidos son:

| Término | Identificador | Parámetros |
| --- | --- | --- |
| Central | `central` | Ninguno. |
| Oblaticidad | `j2`, `j3`, `j4` | Coeficientes WGS-84 internos. |
| Arrastre | `drag` | `drag_coefficient`, `area_m2`, `mass_kg`. |

`force_terms` puede ser una lista o cadena. Los presets heredados `two-body`,
`j2` y `j2-j3-j4` se expanden a la composición correspondiente. Si se expresa
una composición explícita, esta prevalece sobre los campos heredados de
gravedad/arrastre.

## Integración y caché

La instancia mantiene estados calculados por desplazamiento respecto de la
época. Para una consulta nueva, integra desde el estado guardado más próximo;
las consultas repetidas del mismo desplazamiento reutilizan el valor cacheado.
El caché está protegido para acceso concurrente dentro de la instancia.

No hay interpolación entre estados cacheados: el motor integra el intervalo que
queda hasta el desplazamiento solicitado. Las integraciones hacia el pasado
usan pasos RK4 negativos.

## Salida y procedencia

| Método | Resultado |
| --- | --- |
| `native_state_at` | `StateVector` EME2000/UTC/SI con `propagator=cowell-rk4`. |
| `state_at` | Transformación explícita al marco pedido. |
| `propagate_datetime` | Adaptador ITRF SI de seis componentes. |

La procedencia declara que los términos terrestres usan el modelo compatible
de ejes inerciales de primer orden. Esto evita presentar el resultado como una
fuerza terrestre completa transformada en cada paso.

## Fallos y límites

- La integración falla si una etapa cruza la Tierra, en vez de devolver un
  estado físicamente inválido.
- No hay control de error, tamaño de paso adaptativo, tolerancias locales ni
  estimador de energía.
- No hay terceros cuerpos, SRP, relatividad, geopotencial completo, mareas,
  atmósfera de alta fidelidad ni propagación de covarianza.
- El paso fijo puede acumular error en arcos largos, órbitas muy excéntricas o
  dinámicas que exijan escalas menores que 60 s.

Consulte [Integradores numéricos](numerical-integrators.md),
[Arrastre atmosférico](atmospheric-drag.md) y
[Modelos de gravedad](../engineering/gravity-models.md).
