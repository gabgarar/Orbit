# Cowell: fallos y límites

[Propagación](../index.md) · [Cowell](../cowell.md) · [Integradores numéricos](../numerical-integrators.md)

## Intersección con la Tierra

Cowell rechaza la integración cuando una etapa RK4 alcanza el interior de la Tierra. El término central de punto masa, \(\mathbf a=-\mu\mathbf r/\lVert\mathbf r\rVert^3\), es singular en \(\lVert\mathbf r\rVert=0\); además, los modelos de gravedad y atmósfera usados por Orbit no son físicamente válidos dentro del cuerpo terrestre.

La implementación comprueba cada estado intermedio de RK4 y falla al llegar a un radio menor o igual que el radio polar WGS-84. Es una barrera de validez, no una detección de colisión: no localiza el instante exacto de impacto, no interpola la trayectoria y no resuelve contacto con la superficie. El rechazo evita publicar un estado físicamente inválido o continuar hacia la singularidad del modelo.

## Por qué el paso fijo es un límite

RK4 usa un paso fijo de 60 s. No ajusta el paso a una tolerancia, no estima el error local ni controla la conservación de energía. Si la dinámica cambia en una escala temporal menor que el paso, las cuatro evaluaciones pueden no resolver suficientemente esa variación.

Esto es especialmente relevante en perigeos bajos, arcos largos, órbitas muy excéntricas y regímenes con variaciones rápidas o resonancias. El límite de pasos del inspector protege la operación del servicio, pero no mejora la precisión numérica. Para ese tipo de casos se necesitaría un integrador adaptativo con estimación de error, como una familia Dormand–Prince o RKF45; ninguno está implementado en Orbit actualmente.

## Límites de fidelidad

- No hay control adaptativo de error, tolerancias locales ni estimador de energía.
- No hay detección de eventos ni localización de raíces.
- No hay terceros cuerpos, SRP, relatividad, geopotencial completo, mareas, atmósfera de alta fidelidad ni propagación de covarianza.

## Referencias relacionadas

- [Dinámica cartesiana de Cowell](../cowell.md)
- [Integradores numéricos](../numerical-integrators.md)
- [Geopotencial completo](../full-geopotential.md)
- [Terceros cuerpos](../third-bodies.md)
