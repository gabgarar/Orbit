# Terceros cuerpos

[Inicio](../index.md) · [Propagación](index.md) · [Modelos de fuerza](force-models.md) · [Cowell](cowell.md)

## Estado de soporte

Orbit no implementa aceleraciones de terceros cuerpos. El Sol y la Luna pueden
formar parte de la visualización, pero su presencia visual no añade fuerza
gravitatoria a los propagadores.

No hay efemérides planetarias para integración, selección de cuerpos,
coeficientes gravitatorios externos, mareas de terceros cuerpos ni corrección
indirecta por un origen baricéntrico.

## Alternativas disponibles

- Use [Dos cuerpos](two-body.md) o [Cowell](cowell.md) dentro del alcance de
  fuerzas documentado.
- Consuma una [efeméride OEM](../formats/oem.md) o [SP3](../formats/sp3.md)
  que haya sido producida externamente, teniendo en cuenta que esos lectores
  Python no están integrados en la UI/API de producto.

No existe un parámetro oculto para activar fuerzas solar o lunar en Cowell.

!!! warning "Ecuación prevista para implementación futura"

    Para un cuerpo perturbador \(b\), la aceleración diferencial prevista es:

    $$
    \mathbf a_{3B}=\mu_b\left(
    \frac{\mathbf r_b-\mathbf r}{\lVert\mathbf r_b-\mathbf r\rVert^3}
    -\frac{\mathbf r_b}{\lVert\mathbf r_b\rVert^3}\right).
    $$

    | Símbolo | Significado | Unidad |
    | --- | --- | --- |
    | \(\mathbf r\), \(\mathbf r_b\) | Posición del satélite y del cuerpo perturbador, respecto al mismo origen. | km. |
    | \(\mu_b\) | Parámetro gravitatorio del cuerpo perturbador. | km³/s². |
    | \(\mathbf a_{3B}\) | Aceleración diferencial de terceros cuerpos. | km/s². |

    La ecuación no se ejecuta hoy en Cowell; exigiría efemérides y un origen
    común para \(\mathbf r\) y \(\mathbf r_b\).
