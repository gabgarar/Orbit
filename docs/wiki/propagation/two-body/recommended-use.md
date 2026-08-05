# Dos cuerpos: uso recomendado y límites

[Propagación](../index.md) · [Dos cuerpos](../two-body.md) · [Cowell](../cowell.md)

## Cuándo usarlo

Use dos cuerpos cuando la simplicidad es una ventaja:

- aprendizaje de elementos keplerianos y de la geometría de una elipse;
- visualización rápida de una órbita manual ideal;
- prueba de conversiones entre elementos y estado cartesiano;
- línea base para comparar qué cambia al añadir fuerzas en Cowell;
- pruebas deterministas donde un integrador numérico introduciría una fuente
  adicional de diferencia.

## Cuándo no usarlo

No use este modelo como resultado final para predicción operacional, análisis
de reentrada, órbitas de largo plazo, determinación de órbita, ventanas de
visibilidad precisas o evaluación de riesgo. En un satélite real, incluso en
LEO, J2 rota gradualmente el plano orbital y el arrastre cambia la energía;
ambos efectos están ausentes aquí.

Tampoco representa maniobras, terceros cuerpos, presión de radiación solar,
relatividad, geopotencial de alto orden, covarianza ni eventos. Su rapidez no
compensa una física que no está en el modelo.

## Dos cuerpos frente a Cowell

| Aspecto | Dos cuerpos | Cowell en Orbit |
| --- | --- | --- |
| Entrada | Elementos keplerianos | Estado cartesiano y época |
| Tipo | Analítico | Numérico, integrado con RK4 |
| Dinámica | Solo gravedad central | Gravedad central más términos disponibles |
| Paso temporal | No tiene | Fijo: 60 s actualmente |
| Mejor uso | Referencia y aprendizaje | Estudios físicos y validación de fuerzas |

Cowell no siempre es «más preciso»: solo puede serlo si sus fuerzas y su paso
representan mejor el caso estudiado. Para aislar una diferencia o enseñar la
geometría orbital, dos cuerpos es normalmente la elección más clara.
