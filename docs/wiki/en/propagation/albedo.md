# Earth albedo and infrared

[Home](../index.md) · [Propagation](index.md) · [Force models](force-models.md) · [Solar radiation pressure](solar-radiation-pressure.md)

## Status

Earth albedo and Earth infrared (IR) remain deferred. They are not enabled by
direct SRP: they are distinct radiation sources with their own surface geometry
and data.

## What a physical model requires

A useful model needs at least:

| Deferred component | Reason |
| --- | --- |
| Reflectivity map or model | Albedo depends on ocean, land, clouds, season, and solar angle. |
| Earth IR emission | Earth temperature and emissivity, not solar reflection alone. |
| Sun–Earth–satellite geometry | Visibility, occultation, illumination, and resulting direction. |
| Attitude or effective area | Receiving area is usually not constant for a real satellite. |
| Epoch terrestrial frame | Earth map must be evaluated in ITRF, not on a fixed Earth in <code>EME2000</code>. |
| Reference validation | Independent cases and declared tolerances. |

A schematic formulation would be:

$$
\mathbf a_{\mathrm{alb/IR}}=
-\frac{C_R A}{mc}\int_{\mathrm{visible\ Earth}}
E(\mathbf q,t)\,\hat{\mathbf s}(\mathbf q,t)\,d\Omega.
$$

It is not executed currently. Direct-SRP cannonball model does not provide the
integral, maps, or orientation needed.
