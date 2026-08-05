# Earth albedo

[Home](../index.md) · [Propagation](index.md) · [Force models](force-models.md) · [Solar radiation pressure](solar-radiation-pressure.md)

## Support status

Orbit does not implement radiation pressure reflected by Earth, known as albedo. It is a non-gravitational effect: the acceleration comes from reflected-photon momentum, not from gravitational potential.

!!! warning "Equation planned for future implementation"

    A simplified model could integrate reflected irradiance \(E_{\mathrm{alb}}\) over the visible Earth:

    $$
    \mathbf a_{\mathrm{alb}}=
    -\frac{C_R A}{m c}\,E_{\mathrm{alb}}\,\hat{\mathbf s}_{\mathrm{alb}}.
    $$

    | Symbol | Meaning | Unit |
    | --- | --- | --- |
    | \(\mathbf a_{\mathrm{alb}}\) | Acceleration from reflected terrestrial radiation. | m/s². |
    | \(C_R\) | Effective satellite reflectivity coefficient. | Dimensionless. |
    | \(A\), \(m\) | Exposed area and satellite mass. | m², kg. |
    | \(c\) | Speed of light. | m/s. |
    | \(E_{\mathrm{alb}}\) | Integrated reflected irradiance. | W/m². |
    | \(\hat{\mathbf s}_{\mathrm{alb}}\) | Resultant reflected-radiation direction. | Dimensionless. |

    The equation is not evaluated today. It would require Sun–Earth–satellite geometry, an Earth reflectivity map, occultation, and attitude or an effective area.

## Relation to SRP

Albedo is not a replacement for direct SRP: it uses radiation reflected by Earth and a resultant direction that depends on terrestrial geometry.
