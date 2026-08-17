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

## Hitos de pases AOS/LOS

En modo **Simulated**, al seleccionar una estación terrestre visible o un
satélite visible, Orbit calcula progresivamente los pases de todos los pares
estación--satélite que tienen ambos extremos visibles en la escena. El cálculo
usa la ventana simulada activa y el mismo contrato AOS/LOS que alimenta las
tablas de pases; no inventa una nueva efeméride ni extrapola una fuente finita
fuera de su cobertura.

Cada pase publicado aporta hasta tres hitos UTC en la barra temporal:

- **Máxima elevación**, en verde y por encima de la barra. Solo se muestra si
  el análisis publicó el instante `max_elevation_time`; no se presenta un
  punto medio como si fuera un máximo físico.
- **AOS** y **LOS**, en morado y por debajo de la barra. Delimitan el comienzo
  y el final refinados del mismo acceso.

Los hitos conservan el par estación--satélite, AOS, LOS y la elevación máxima
reportada. Se pueden inspeccionar y llevar la simulación al instante UTC del
evento sin cuantizarlo al paso visual del deslizador. Esto permite comparar
contactos simultáneos de varias estaciones y satélites dentro de una misma
ventana.

La visibilidad de la escena es parte del contrato: si se oculta o elimina la
estación o el satélite de un par, sus tres hitos desaparecen inmediatamente.
Los resultados se muestran por pares a medida que terminan. Cambiar la
selección, la ventana simulada o la escena cancela las solicitudes pendientes
y descarta sus resultados para que no se mezclen con el nuevo contexto. El
panel de **Actividad** muestra ese trabajo y permite cancelarlo.

!!! note "Ventanas extensas y resolución"

    Las consultas de hitos sin muestras de gráfica conservan exactamente el
    `step_seconds` solicitado, incluso cuando el backend debe dividir una
    ventana larga en segmentos internos. Los extremos compartidos se unen antes
    de extraer AOS/LOS, por lo que un pase que cruza un segmento sigue siendo
    un único pase. No se reduce el paso automáticamente. Para proteger el
    servicio, esa modalidad admite como máximo 250&nbsp;000 muestras estimadas;
    una petición mayor falla de forma explícita y pide acortar la ventana o
    aumentar el paso. Las consultas que además devuelven vértices para una
    gráfica conservan el límite materializado de 20&nbsp;000 muestras.

!!! info "Base para el calendario"

    El flujo conserva eventos normalizados (`aos`, `max`, `los`) con sus
    identificadores de estación y satélite. Una futura vista de calendario
    podrá reutilizarlos sin reinterpretar la geometría. No constituye todavía
    una agenda de antena, reserva de recurso ni confirmación de disponibilidad
    operativa.

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
