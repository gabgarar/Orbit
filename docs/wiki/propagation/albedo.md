# Albedo e infrarrojo terrestre

[Inicio](../index.md) · [Propagación](index.md) · [Modelos de fuerza](force-models.md) · [Presión de radiación solar](solar-radiation-pressure.md)

## Estado

El albedo terrestre y la radiación infrarroja (IR) terrestre siguen pendientes.
No se habilitan al activar SRP directa: son fuentes de radiación distintas, con
geometría y datos de superficie propios.

## Qué requiere un modelo físico

Un modelo útil necesita, como mínimo:

| Componente pendiente | Razón |
| --- | --- |
| Mapa o modelo de reflectividad | El albedo depende de océano, tierra, nubes, estación y ángulo solar. |
| Emisión IR terrestre | Temperatura y emisividad terrestres, no solo reflexión solar. |
| Geometría Sol–Tierra–satélite | Visibilidad, ocultación, iluminación y dirección resultante. |
| Actitud o área efectiva | El área receptora no suele ser constante en un satélite real. |
| Marco terrestre por época | El mapa terrestre debe evaluarse en ITRF, no sobre una Tierra fija en <code>EME2000</code>. |
| Validación de referencia | Casos independientes y tolerancias declaradas. |

Una formulación esquemática sería:

$$
\mathbf a_{\mathrm{alb/IR}}=
-\frac{C_R A}{mc}\int_{\mathrm{Tierra\ visible}}
E(\mathbf q,t)\,\hat{\mathbf s}(\mathbf q,t)\,d\Omega.
$$

No se ejecuta actualmente. El modelo *cannonball* de SRP directa no proporciona
la integral, los mapas ni la orientación necesarios.
