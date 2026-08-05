# Propagación de dos cuerpos

[Inicio](../index.md) · [Propagación](index.md) · [Propagadores](overview.md)

## Visión general

`TwoBodyPropagator` es el propagador analítico de Kepler para una órbita
manual alrededor de la Tierra. Parte de elementos keplerianos en una época,
avanza la anomalía media y resuelve la ecuación de Kepler para obtener un
estado cartesiano nativo en `EME2000`.

Es el modelo más sencillo para entender una órbita ligada: solo existe la
gravedad central. No usa RK4, no conserva una caché de pasos y no incorpora
J2, arrastre, maniobras ni otros efectos.

$$
\ddot{\mathbf r}=-\mu\frac{\mathbf r}{\lVert\mathbf r\rVert^3}.
$$

Aquí \(\mathbf r\) es la posición respecto al centro de la Tierra en km,
\(\mu=398600.4418\ \mathrm{km^3\,s^{-2}}\) es el parámetro gravitatorio
terrestre y la aceleración queda en \(\mathrm{km\,s^{-2}}\).

## Por qué usar dos cuerpos

- Es determinista, rápido y fácil de interpretar.
- Ofrece una referencia base para comparar SGP4 y Cowell.
- Es útil para verificar elementos keplerianos, marcos y conversiones de
  estado antes de añadir física adicional.
- Para una misma época y los mismos elementos, no depende de un tamaño de paso
  ni de tolerancias numéricas.

## Guía del módulo

| Tema | Qué aprenderá |
| --- | --- |
| [Elementos y movimiento kepleriano](two-body/keplerian-motion.md) | Cómo Orbit avanza una órbita elíptica y las unidades de cada variable. |
| [Salida y marcos](two-body/frames-output.md) | Qué estado es nativo, cómo se solicita ITRF y qué significa la procedencia. |
| [Uso recomendado y límites](two-body/recommended-use.md) | Cuándo el modelo es una buena aproximación y cuándo debe elegir Cowell u otra fuente. |

## Idea clave

Dos cuerpos describe una elipse ideal que no cambia de orientación ni de forma.
Es excelente como modelo de referencia, pero no debe interpretarse como una
predicción operacional de un satélite real durante arcos largos.

Consulte [Cowell](cowell.md) cuando necesite integrar una dinámica cartesiana
con las fuerzas que Orbit tiene disponibles.
