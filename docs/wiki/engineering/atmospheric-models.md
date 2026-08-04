# Modelo atmosférico

[Inicio](../index.md) · [Ingeniería](index.md) · [Arrastre atmosférico](../propagation/atmospheric-drag.md) · [Modelos de la Tierra](earth-models.md)

## Estado de soporte

El único modelo atmosférico implementado es una atmósfera exponencial por
capas, usada exclusivamente por el término `drag` del propagador
[`cowell-rk4`](../propagation/cowell.md).

La densidad se evalúa como:

$$
\rho(h)=\rho_0\exp\left(-\frac{h-h_0}{H}\right),
$$

donde \(h_0\), \(\rho_0\) y \(H\) proceden de una tabla interna de anclas de
altitud estilo US Standard Atmosphere. La tabla incluye capas desde 0 km hasta
1000 km; a partir de 1500 km la densidad se fija a cero.

## Interacción con Cowell

- La altura se estima con el elipsoide WGS-84.
- La atmósfera se considera corrotante con la Tierra.
- La velocidad relativa usa \(\mathbf v-\mathbf\omega\times\mathbf r\).
- El usuario proporciona coeficiente de arrastre, área de referencia y masa;
  todos deben ser finitos y mayores que cero.
- El término se habilita de manera explícita dentro de `force_terms` o mediante
  un preset heredado con `atmospheric_drag`.

## Límites

No hay modelos NRLMSISE, JB2008, DTM, meteorología espacial, flujo solar,
índices geomagnéticos, viento, densidad de alta fidelidad, actitud ni área
variable. El modelo está destinado a estudios de sensibilidad y vistas
interactivas de alcance limitado, no a predicción operacional de decaimiento.

Consulte [Arrastre atmosférico](../propagation/atmospheric-drag.md) para la
ecuación y las restricciones del propagador.
