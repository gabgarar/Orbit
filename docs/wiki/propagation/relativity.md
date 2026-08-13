# Relatividad

[Inicio](../index.md) · [Propagación](index.md) · [Modelos de fuerza](force-models.md) · [Marcos de referencia](../engineering/reference-frames.md)

## Alcance y estado

El término canónico disponible es <code>relativity</code>. Añade la
corrección post-newtoniana de primer orden de Schwarzschild del potencial
terrestre al estado geocéntrico de Cowell. No cambia la escala temporal del
propagador ni convierte una órbita manual en una solución relativista completa.

## Corrección Schwarzschild

Con \(\mu\) terrestre, \(\mathbf r\) y \(\mathbf v\) en <code>EME2000</code>, y
velocidad de la luz \(c\), la corrección aplicada es:

$$
\mathbf a_{\mathrm{Schw}}=
\frac{\mu}{c^2r^3}
\left[
\left(\frac{4\mu}{r}-\mathbf v\cdot\mathbf v\right)\mathbf r
+4(\mathbf r\cdot\mathbf v)\mathbf v
\right].
$$

| Símbolo | Significado | Unidad |
| --- | --- | --- |
| \(\mu\) | Parámetro gravitatorio terrestre. | km³/s². |
| \(\mathbf r\), \(r\) | Posición geocéntrica y su norma. | km. |
| \(\mathbf v\) | Velocidad geocéntrica. | km/s. |
| \(c\) | Velocidad de la luz. | km/s. |
| \(\mathbf a_{\mathrm{Schw}}\) | Corrección post-newtoniana añadida. | km/s². |

La corrección se suma una vez, además de <code>central</code>. Se valida que los
vectores y la aceleración sean finitos; no tiene parámetros de usuario.

## Marco, tiempo y magnitud

La expresión se evalúa directamente en el marco inercial coherente con
<code>EME2000</code>, en la época de cada etapa RK4. No requiere ITRF ni EOP
para su fórmula, pero sí una escala temporal y un marco consistentes con el
resto de la integración. Su magnitud es pequeña frente a la gravedad central:
no debe usarse para ocultar una incoherencia de marcos, datos EOP o integrador.

## Exclusiones explícitas

Este término no incluye:

- Lense–Thirring, cuadrupolo relativista, efectos multipolares ni dinámica de
  un cuerpo central en rotación;
- transformaciones relativistas completas entre TCG, TCB, TDB y TT;
- correcciones relativistas para relojes GNSS, observables, SGP4, OEM o SP3;
- propagación de STM/covarianza relativista.

Las necesidades que requieran esos efectos deben declarar su modelo y escala
temporal específicos; no se deben inferir a partir de activar
<code>relativity</code>.
