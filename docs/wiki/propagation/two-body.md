# Propagación de dos cuerpos

[Inicio](../index.md) · [Propagación](index.md) · [Elementos keplerianos](../engineering/keplerian-elements.md) · [Masa puntual](point-mass.md)

## Modelo

`TwoBodyPropagator` evoluciona una órbita manual elíptica bajo gravedad central
ideal. El modelo resuelve la ecuación de Kepler y genera el estado cartesiano
nativo en `EME2000`.

$$
\ddot{\mathbf r}=-\mu\frac{\mathbf r}{\lVert\mathbf r\rVert^3}.
$$

No integra el movimiento numéricamente. El coste por época es el de avanzar
elementos y resolver la ecuación de Kepler, sin historial de pasos de fuerza.

## Entradas

| Campo | Requisito |
| --- | --- |
| Época | Instante UTC del diseño manual. |
| Elementos | `semi_major_axis_km`, `eccentricity`, `inclination_deg`, `raan_deg`, `argument_of_perigee_deg`, `mean_anomaly_deg`. |
| Excentricidad | Solo \(0\le e<1\). |
| Perigeo | Debe quedar por encima del radio ecuatorial terrestre. |

La especificación completa de los elementos está en
[Elementos keplerianos](../engineering/keplerian-elements.md).

## Salida

| Método | Resultado |
| --- | --- |
| `native_state_at` | Estado SI `EME2000`, UTC, centro `EARTH`. |
| `state_at` | Estado nativo transformado al marco pedido. |
| Adaptadores heredados | Seis componentes ITRF SI para renderer. |

Los nombres históricos de métodos `propagate_eci_datetime` se conservan como
alias de `propagate_eme2000_datetime`; no autorizan el uso de `ECI` como marco
del contrato.

## Hipótesis y límites

- Solo órbitas terrestres, elípticas y ligadas.
- Sin oblaticidad, arrastre, terceros cuerpos, SRP, relatividad ni maniobras.
- Sin propagación de covarianza, detección de eventos ni integración adaptativa.
- La salida ITRF requiere la transformación de marcos y su política EOP.

Use [Cowell](cowell.md) cuando sea necesario componer los términos de fuerza
disponibles; no interprete esa ruta como un modelo de alta fidelidad.
