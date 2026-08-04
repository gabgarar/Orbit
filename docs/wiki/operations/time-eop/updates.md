# Tiempo y EOP: actualización controlada

[Operación](../index.md) · [Tiempo, EOP e ITRF](../time-eop.md) · [Modo estricto](strict-mode.md)

1. Descargue y revise las nuevas fuentes fuera de Orbit.
2. Sustituya los archivos de config/eop de manera controlada.
3. Calcule hashes y actualice variables y revisiones.
4. Reinicie el runtime.
5. Compruebe docker compose ps y los logs.

La identidad de los bytes de C04 y leap-seconds.list forma parte de la clave de
caché. Un cambio de cualquiera invalida resultados previos aunque la etiqueta
de versión no cambie.
