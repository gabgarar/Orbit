# Cowell: fallos y límites

[Propagación](../index.md) · [Cowell](../cowell.md) · [Integradores numéricos](../numerical-integrators.md)

## Fallos

- La integración falla si una etapa cruza la Tierra, en vez de devolver un
  estado físicamente inválido.

## Límites de fidelidad

- No hay control de error, tamaño de paso adaptativo, tolerancias locales ni
  estimador de energía.
- No hay terceros cuerpos, SRP, relatividad, geopotencial completo, mareas,
  atmósfera de alta fidelidad ni propagación de covarianza.
- El paso fijo puede acumular error en arcos largos, órbitas muy excéntricas o
  dinámicas que exijan escalas menores que 60 s.

## Referencias relacionadas

- [Integradores numéricos](../numerical-integrators.md)
- [Geopotencial completo](../full-geopotential.md)
- [Terceros cuerpos](../third-bodies.md)
