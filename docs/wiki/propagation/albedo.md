# Albedo terrestre

[Inicio](../index.md) · [Propagación](index.md) · [Modelos de fuerza](force-models.md) · [Presión de radiación solar](solar-radiation-pressure.md)

## Estado de soporte

Orbit no implementa la presión de radiación reflejada por la Tierra, conocida como albedo. Es un efecto no gravitacional: la aceleración procede del momento de los fotones reflejados, no del potencial gravitatorio.

!!! warning "Ecuación prevista para implementación futura"

    Un modelo simplificado podría integrar la irradiancia reflejada \(E_{\mathrm{alb}}\) sobre la Tierra visible:

    $$
    \mathbf a_{\mathrm{alb}}=
    -\frac{C_R A}{m c}\,E_{\mathrm{alb}}\,\hat{\mathbf s}_{\mathrm{alb}}.
    $$

    | Símbolo | Significado | Unidad |
    | --- | --- | --- |
    | \(\mathbf a_{\mathrm{alb}}\) | Aceleración por radiación terrestre reflejada. | m/s². |
    | \(C_R\) | Coeficiente efectivo de reflectividad del satélite. | Adimensional. |
    | \(A\), \(m\) | Área expuesta y masa del satélite. | m², kg. |
    | \(c\) | Velocidad de la luz. | m/s. |
    | \(E_{\mathrm{alb}}\) | Irradiancia reflejada integrada. | W/m². |
    | \(\hat{\mathbf s}_{\mathrm{alb}}\) | Dirección resultante de la radiación reflejada. | Adimensional. |

    La ecuación no se evalúa actualmente. Requeriría geometría Sol–Tierra–satélite, un mapa de reflectividad terrestre, ocultación y una actitud o un área efectiva.

## Relación con SRP

El albedo no es un sustituto de la SRP directa: utiliza radiación reflejada por la Tierra y una dirección resultante dependiente de la geometría terrestre.
