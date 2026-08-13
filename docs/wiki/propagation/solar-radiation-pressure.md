# Presión de radiación solar

[Inicio](../index.md) · [Propagación](index.md) · [Modelos de fuerza](force-models.md) · [Terceros cuerpos](third-bodies.md)

## Alcance y estado

El término canónico disponible es <code>solar-radiation-pressure</code>.
Es un modelo *cannonball*: representa el satélite por un área efectiva fija,
coeficiente de reflexión \(C_R\) y masa. Incluye una fracción de iluminación de
eclipse cilíndrico; no modela aún actitud ni penumbra.

<code>srp</code> es solo un alias de entrada. La presencia del Sol en la
visualización no activa SRP y <code>drag</code> no es un sustituto físico de la
radiación solar.

## Modelo aplicado

Sea \(\mathbf r_\odot\) el vector geocéntrico Tierra→Sol y \(\mathbf r\) el
vector Tierra→satélite. La dirección de los fotones en el satélite es el vector
Sol→satélite, \(\hat{\mathbf u}=(\mathbf r-\mathbf r_\odot)/d\). La aceleración
aplicada es:

$$
\mathbf a_{SRP}=\nu\,P_0\left(\frac{AU}{d}\right)^2
\frac{C_R A}{m}\,\hat{\mathbf u},
$$

donde \(\nu\in[0,1]\) es la fracción de iluminación. El resultado se calcula
en SI y se convierte a km/s² antes de sumarse en Cowell.

| Símbolo | Significado | Unidad |
| --- | --- | --- |
| \(P_0\) | Presión solar de referencia a 1 AU. | N/m². |
| \(AU\), \(d\) | Unidad astronómica y distancia Sol–satélite. | m. |
| \(C_R\) | Coeficiente de reflexión efectivo. | Adimensional. |
| \(A\), \(m\) | Área de referencia y masa. | m², kg. |
| \(\nu\) | Iluminación por eclipse. | 0 a 1. |
| \(\mathbf a_{SRP}\) | Aceleración de radiación solar. | km/s² en Cowell. |

## Eclipse cilíndrico

El eclipse se determina geométricamente con un cilindro de radio terrestre
alineado con la dirección Sol→Tierra. Si el satélite está detrás de la Tierra y
su distancia perpendicular al eje Sol–Tierra es menor que el radio elegido, se
usa \(\nu=0\); fuera se usa \(\nu=1\). El modelo debe rechazar geometría no
finita o degenerada.

Este método es discontinuo y no representa penumbra, diámetro solar,
achatamiento de la Tierra ni refracción. Es apropiado como modelo declarado de
primer orden, no para transiciones fotométricas o fuerzas de precisión de
misión.

## Validación y procedencia

- <code>area_m2</code>, <code>mass_kg</code> y
  <code>solar_radiation_coefficient</code> deben ser finitos y positivos.
- La posición solar debe proceder del mismo proveedor/época que el término
  solar de terceros cuerpos y respetar su cobertura.
- La aceleración debe apuntar alejándose del Sol cuando \(\nu>0\).
- La procedencia registra \(C_R\), área, masa, presión de referencia, modelo de
  eclipse, radio usado y proveedor solar.

## Lo que sigue pendiente

No hay SRP por placas, cuaternios, área proyectada variable, auto-sombra,
penumbra/antumbra, absorción térmica ni reemisión. Estos incrementos dependen
de un modelo de [Actitud](attitude.md), geometría del vehículo y un integrador
con control de error cerca de las discontinuidades de eclipse.
