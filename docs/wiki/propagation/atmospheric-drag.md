# Arrastre atmosférico

[Inicio](../index.md) · [Propagación](index.md) · [Cowell](cowell.md) · [Modelo atmosférico](../engineering/atmospheric-models.md)

## Disponibilidad

El arrastre está disponible como término <code>drag</code> de
<code>cowell-rk4</code>. No está disponible en dos cuerpos, el preset fijo
J2+J3+J4 ni SGP4 configurable desde Orbit.

A diferencia de los zonales históricos, el arrastre se evalúa en ITRF
instantáneo **en cada etapa RK4**. En órbitas manuales usa el mismo proveedor
automático IERS C01 que el geopotencial. Si no hay una muestra EOP válida, usa
una rotación terrestre nominal marcada con advertencia; no se degrada a una
atmósfera fija en <code>EME2000</code> ni solicita un ERP manual.

## Modelo aplicado

Con \(B=C_DA/m\), densidad \(\rho\) y velocidad relativa a una atmósfera
corrotante \(\mathbf v_{rel}\), Cowell aplica:

$$
\mathbf a_{drag}=-\frac{1}{2}B\rho\lVert\mathbf v_{rel}\rVert\mathbf v_{rel}.
$$

| Símbolo | Significado | Unidad |
| --- | --- | --- |
| \(\mathbf a_{drag}\) | Aceleración de arrastre añadida a Cowell. | km/s². |
| \(B=C_DA/m\) | Coeficiente balístico por área. | m²/kg. |
| \(C_D\) | Coeficiente de arrastre. | Adimensional. |
| \(A\), \(m\) | Área de referencia y masa. | m², kg. |
| \(\rho\) | Densidad atmosférica. | kg/m³. |
| \(\mathbf v_{rel}\) | Velocidad frente a la atmósfera corrotante. | m/s durante el cálculo. |

## Marco y secuencia por etapa

Para cada evaluación \(f(t,\mathbf y)\) de RK4, Orbit:

1. transforma posición y velocidad de <code>EME2000</code> a ITRF en la época de
   la etapa;
2. calcula altura WGS-84, densidad por capas y
   \(\mathbf v_{rel}=\mathbf v-\boldsymbol\omega_\oplus\times\mathbf r\) en ITRF;
3. calcula \(\mathbf a_{drag,ITRF}\) en SI y la convierte a km/s²;
4. rota la aceleración libre a <code>EME2000</code> antes de sumar la derivada.

La velocidad se transforma como estado —incluye la derivada temporal de la
matriz—; la aceleración de drag vuelve como vector libre. Orbit no integra en
ITRF y por tanto no mezcla implícitamente términos ficticios de Coriolis,
centrífuga o Euler.

Con cobertura IERS, la ruta aplica DUT1, movimiento polar y LOD. Si la cobertura
automática falta, la procedencia de la órbita marca explícitamente la rotación
nominal. La ruta sigue requiriendo tabla local versionada y vigente de segundos
intercalares y ERFA/SOFA IAU 2006/2000A; si faltan, la selección de
<code>drag</code> devuelve un error explícito antes de integrar. Una instantánea
ERP manual es un override opcional que, si se elige, debe cubrir el diseño.

## Parámetros

| Parámetro | Unidad | Restricción |
| --- | --- | --- |
| <code>drag_coefficient</code> | — | Finito y mayor que cero; valor predeterminado 2,2. |
| <code>area_m2</code> | m² | Finito y mayor que cero; valor predeterminado 1. |
| <code>mass_kg</code> | kg | Finito y mayor que cero; valor predeterminado 100. |

El coeficiente usado es \(C_DA/m\). Si se usa <code>force_terms</code>, debe
incluirse <code>drag</code>; el booleano heredado
<code>atmospheric_drag</code> no añade el término a una composición explícita.

## Límites

- La densidad se fija a cero a partir de 1500 km.
- Es una atmósfera exponencial por capas WGS-84; no hay flujo solar, índices
  geomagnéticos, vientos, actitud, área variable, NRLMSISE, JB2008 ni DTM.
- No se publica precisión de decaimiento, reentrada o arrastre operacional.
- El paso RK4 fijo no localiza el instante exacto de reentrada ni resuelve
  cambios rápidos de densidad.

El modelo permite explorar un arrastre con marco terrestre físicamente
coherente, pero su densidad sigue siendo de baja fidelidad. EOP rigurosos no
sustituyen un modelo atmosférico de misión.
