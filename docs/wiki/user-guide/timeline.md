# Línea temporal y modos de tiempo

[Inicio](../index.md) · [Guía de usuario](index.md) · [Vista 3D](three-d-view.md) · [Proyectos](projects.md) · [Operación de tiempo y EOP](../operations/time-eop.md)

Orbit separa el tiempo de presentación de la configuración científica de
escalas y EOP. El control de interfaz determina la época que alimenta al visor
y a las consultas interactivas; no descarga ni modifica productos de tiempo.

## Modos

| Modo visible | Estado interno | Resultado |
| --- | --- | --- |
| Static | static | Conserva la época actual sin avance automático. |
| Real time | realtime | Actualiza la época con el reloj de pared mientras reproduce. |
| Paused | realtime con reproducción desactivada | Retiene la última época de tiempo real muestreada. |
| Simulated | range | Avanza o se posiciona dentro de un intervalo definido por el operador. |

El selector de modo aparece junto a la fecha y hora UTC del proyecto. En
Static y Real time la barra de simulación se oculta para evitar mostrar
controles que no aplican al modo actual.

## Rango simulado

En Simulated, el control inferior ofrece:

- Reinicio al comienzo del intervalo.
- Reproducción y pausa.
- Velocidades x1, x10, x60 y x600.
- Selección de inicio y fin mediante calendario.
- Cursor de línea temporal para posicionar la época.
- Marcas temporales calculadas sobre el rango activo.
- Un control para contraer o volver a mostrar la barra.

El cursor se limita al intervalo elegido. Si el fin no es posterior al inicio,
la línea temporal no representa un rango válido.

## OEM y dominio temporal

Una trayectoria OEM local puede imponer su propio dominio temporal al espacio
de trabajo. Cuando ese dominio está activo, la edición manual del rango desde
la barra se deshabilita para evitar pedir estados fuera de las muestras
disponibles. Si se mezclan capas OEM con TLE u OMM, revise expresamente el
rango activo antes de interpretar la comparación.

!!! warning "No es un replay de catálogo"

    El modo Simulated controla la época de evaluación de la sesión. No
    reconstruye versiones históricas de TLE, no reproduce telemetría recibida
    ni constituye una simulación física distribuida.

## Persistencia

El modo, inicio, fin, época actual, reproducción y velocidad se incluyen en el
documento de [Proyecto](projects.md). La época guardada puede depender de los
datos de entrada que sigan disponibles al reabrir la sesión.

## Precisión de escalas

La interfaz presenta UTC. Las conversiones UTC, UT1, TAI y TT, junto con los
productos EOP, se configuran en el backend. Para operaciones reproducibles o
exportaciones de precisión, consulte [Operación de tiempo y EOP](../operations/time-eop.md)
y no asuma que el modo visual sin datos locales sea apto para análisis.

