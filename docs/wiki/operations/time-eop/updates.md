# Tiempo y EOP: actualización controlada

[Operación](../index.md) · [Tiempo, EOP e ITRF](../time-eop.md) · [Modo estricto](strict-mode.md)

El C01 operativo no usa este procedimiento: el monitor descarga y valida su
copia en `data/erp/` al arrancar o cuando supera siete días. Revise en
**Built-In Test** que procedencia, cobertura y fecha de actualización sean las
esperadas; no edite una descarga activa a mano.

Este procedimiento sí es obligatorio para los snapshots reproducibles C04 y
la tabla de segundos intercalares:

1. Descargue y revise las nuevas fuentes fuera de Orbit.
2. Sustituya los archivos de `config/eop` de manera controlada.
3. Calcule hashes y actualice variables y revisiones.
4. Reinicie el runtime.
5. Compruebe `docker compose ps`, los logs y Built-In Test.

La identidad de los bytes de C04 y leap-seconds.list forma parte de la clave de
caché. Un cambio de cualquiera invalida resultados previos aunque la etiqueta
de versión no cambie.
