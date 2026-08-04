# Medidas

[Análisis](index.md){ .md-button }

Orbit no incorpora un modelo de medidas de navegación ni un almacén de
observaciones. Las estaciones de tierra permiten visualizar geometría,
visibilidad y un presupuesto de enlace simplificado, pero no producen ni
procesan observaciones calibradas de rango, Doppler, ángulos o GNSS.

## Estado

**No disponibles:** simulación de medidas, ruido instrumental, sesgos,
calibración, formato de observaciones, asociación de medidas a objetos y
persistencia de campañas de tracking.

## Consecuencia para la interpretación

Los valores de AOS/LOS, footprint y presupuesto de enlace son resultados de
geometría y modelo de visualización. No deben usarse como entradas de una
solución de navegación ni como sustitutos de telemetría de estación.

## Referencias relacionadas

- [Estaciones de tierra](../user-guide/ground-stations.md)
- [Tracking](tracking.md)
- [Determinación de órbita](orbit-determination.md)
