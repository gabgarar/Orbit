# Cowell: integración y caché

[Propagación](../index.md) · [Cowell](../cowell.md) · [Integradores numéricos](../numerical-integrators.md)

## Integración

El integrador disponible es Runge–Kutta clásico de cuarto orden, de paso fijo
de 60 s. La instancia mantiene estados calculados por desplazamiento respecto
de la época. Para una consulta nueva, integra desde el estado guardado más
próximo.

## Caché

Las consultas repetidas del mismo desplazamiento reutilizan el valor cacheado.
El caché está protegido para acceso concurrente dentro de la instancia.

No hay interpolación entre estados cacheados: el motor integra el intervalo que
queda hasta el desplazamiento solicitado. Las integraciones hacia el pasado
usan pasos RK4 negativos.

## Referencias relacionadas

- [Integradores numéricos](../numerical-integrators.md)
- [Límites de Cowell](limits.md)
