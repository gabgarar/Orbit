# Rendimiento

[Inicio](../index.md) · [Operación](index.md) · [Configuración](configuration.md) · [Visualización](../user-guide/visualization.md) · [Capas](../user-guide/layers.md)

El coste de Orbit depende del número de capas visibles, de la frecuencia de
actualización, del horizonte de propagación, de la densidad del rango temporal
y de la carga gráfica del navegador. No se publica un benchmark único: el
resultado depende del catálogo, GPU, mapa base, resolución y navegador.

## Controles de mayor impacto

| Control | Efecto operativo | Compromiso |
| --- | --- | --- |
| Capas visibles | Menos entidades y trazas que actualizar y dibujar | Menos contexto simultáneo en el visor. |
| Horizonte de propagación | Reduce o amplía las trayectorias visuales que se solicitan | Un horizonte corto muestra menos futuro. |
| Intervalos de tiempo real | Ajusta la cadencia de estado y órbita | Intervalos más cortos aumentan trabajo de red, cálculo y renderizado. |
| Antialiasing | Off, FXAA o MSAA | MSAA y FXAA priorizan bordes; off permite reducción adaptativa en viewports pequeños. |
| Mapa base | Local o remoto | Un mapa remoto depende de red y de su proveedor. |
| Rango de simulación y paso de exportación | Define cantidad de muestras solicitadas | Rangos extensos o pasos pequeños producen más muestras. |

Los valores se cambian desde el panel documentado en
[Configuración](configuration.md).

## Escala adaptativa

El runtime calcula una escala de interfaz adaptativa a partir del viewport. La
escala de resolución también puede reducirse en viewports pequeños cuando el
antialiasing está desactivado. Si se selecciona FXAA o MSAA, el runtime
mantiene resolución completa para evitar degradar líneas orbitales finas.

La política no sustituye una validación en el hardware objetivo. Pruebe el
catálogo, proyección y resolución reales del puesto de operación.

## Prácticas recomendadas

1. Oculte capas que no intervengan en la inspección actual mediante
   [Capas](../user-guide/layers.md).
2. Use un horizonte de propagación acorde con la ventana visual, no con una
   necesidad de archivo de efemérides.
3. Para capturas o presentaciones, fije la época en Static o pause Real time
   antes de grabar.
4. Prefiera Natural Earth o Earth 2 km local cuando el entorno no garantice
   conectividad a un mapa remoto.
5. Use la exportación de efemérides para datos, no una grabación de pantalla.
6. Reduzca rangos y aumente el paso antes de solicitar una efeméride extensa
   durante una operación interactiva.

## Teselas Earth 2 km

Orbit puede servir teselas locales XYZ generadas a partir del activo Earth 2
km. Desde server:

~~~powershell
npm run tiles:earth2km
~~~

El comando genera teselas de zoom 0 a 6 por defecto bajo
front/assets/earth2km_tiles/. Aumentar el zoom máximo incrementa espacio de
disco y tiempo de generación; no cambia la precisión de los datos orbitales.

## Diagnóstico

- Use ./.scripts/orbit-status.cmd para comprobar el healthcheck del
  contenedor.
- Use ./.scripts/orbit-logs.cmd para seguir errores del gateway o backend.
- Compruebe primero WebGL, el controlador gráfico y la carga de mapas si el
  problema se limita al visor.
- Si el problema afecta a precisión terrestre, valide snapshots, hashes y
  cobertura siguiendo [Tiempo y EOP](time-eop.md).

!!! note "Límite científico"

    Reducir resolución, ocultar capas o cambiar antialiasing sólo cambia la
    presentación y el coste de ejecución. No compensa un TLE caducado, una
    fuente OEM incompleta ni la ausencia de EOP local para un cálculo preciso.

