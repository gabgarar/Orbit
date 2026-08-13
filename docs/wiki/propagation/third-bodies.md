# Terceros cuerpos: Sol y Luna

[Inicio](../index.md) · [Propagación](index.md) · [Modelos de fuerza](force-models.md) · [Cowell](cowell.md)

## Alcance y estado

Los términos canónicos disponibles son `third-body-sun` y
`third-body-moon`. Modelan la aceleración diferencial de Sol y Luna sobre un
satélite geocéntrico; no aplican su gravedad absoluta de forma que desplace
artificialmente el origen terrestre.

El proveedor local usa ERFA: `eraEpv00` para el Sol (vector heliocéntrico de la
Tierra negado, aproximación geométrica compatible con GCRS) y `eraMoon98` para
la Luna (vector geocéntrico GCRS aproximado). Declara cobertura y procedencia,
no descarga efemérides en segundo plano y no sustituye una efeméride planetaria
de precisión de misión.

## Ecuación diferencial

Para un cuerpo perturbador \(b\), con \(\mathbf r\) posición geocéntrica del
satélite y \(\mathbf r_b\) posición geocéntrica del cuerpo, se suma:

$$
\mathbf a_{3B}=\mu_b\left(
\frac{\mathbf r_b-\mathbf r}{\lVert\mathbf r_b-\mathbf r\rVert^3}
-\frac{\mathbf r_b}{\lVert\mathbf r_b\rVert^3}\right).
$$

| Símbolo | Significado | Unidad |
| --- | --- | --- |
| \(\mathbf r\) | Posición geocéntrica del satélite. | km. |
| \(\mathbf r_b\) | Posición geocéntrica de Sol o Luna, mismo origen y época. | km. |
| \(\mu_b\) | Parámetro gravitatorio del cuerpo. | km³/s². |
| \(\mathbf a_{3B}\) | Aceleración diferencial añadida a Cowell. | km/s². |

El segundo término es indispensable: sustrae la aceleración del centro de la
Tierra por el mismo cuerpo. Sin él se mezclaría una dinámica heliocéntrica o
lunar absoluta con un estado geocéntrico.

## Época, marco y cobertura

La posición del Sol o la Luna se obtiene en cada etapa RK4 y se expresa en un
marco celeste geocéntrico coherente con el estado `EME2000`. La implementación
aplica este contrato:

- rechaza épocas fuera de la cobertura declarada: Sol 1900–2100 con `eraEpv00`
  y Luna 1950–2100 con `eraMoon98`;
- convierte UTC a TT explícitamente con la tabla local versionada de segundos
  intercalares; para estos modelos aproximados ERFA se declara la sustitución
  TT por TDB donde ERFA la permite;
- declarar proveedor, versión de biblioteca, modelo, constantes y cobertura en
  la procedencia;
- rechazar vectores no finitos o una geometría singular antes de formar la
  aceleración.

El modelo local es apropiado para estudios de sensibilidad y composición de
fuerzas. Para OD, navegación precisa, arcos largos o validación de misión se
debe seleccionar una efeméride planetaria externa versionada y comparar contra
una referencia conocida.

## Lo que no hace

- No integra un sistema n-cuerpos baricéntrico completo.
- No incluye planetas, asteroides, efemérides JPL descargadas ni correcciones
  relativistas de las efemérides.
- No incorpora las mareas inducidas por Sol/Luna en el geopotencial; son un
  término distinto y siguen pendientes en [Mareas](tides.md).
- No resuelve eclipses: el eclipse afecta a SRP, no a la gravedad de terceros
  cuerpos.
