# Presión de radiación solar

[Inicio](../index.md) · [Propagación](index.md) · [Modelos de fuerza](force-models.md) · [Terceros cuerpos](third-bodies.md)

## Estado de soporte

Orbit no implementa presión de radiación solar (SRP) en ningún propagador.

No existen parámetros de coeficiente de reflectividad, área iluminada,
ocultación, eclipse, geometría Sol–satélite, efemérides solares para fuerza ni
modelo de actitud asociado. La visualización del Sol no es una fuente de SRP.

## Alternativas

- Para arcos ya calculados externamente, use los lectores Python de
  [OEM](../formats/oem.md) o [SP3](../formats/sp3.md), sin asumir integración
  de producto UI/API.
- Para estudios manuales dentro de Orbit, limite la interpretación a las
  fuerzas documentadas en [Cowell](cowell.md).

No se debe representar `drag` como sustituto de SRP: son términos con origen,
dirección y dependencia física diferentes.

!!! warning "Ecuación prevista para implementación futura"

    Un modelo SRP por múltiples superficies podría sumar las caras iluminadas:

    $$
    \mathbf a_{\mathrm{SRP}}=-P_\odot\left(\frac{\mathrm{AU}}{d_\odot}\right)^2
    \frac{1}{m}\sum_i A_i\max(0,\hat{\mathbf n}_i\cdot\hat{\mathbf s})
    C_{R,i}\hat{\mathbf s}.
    $$
