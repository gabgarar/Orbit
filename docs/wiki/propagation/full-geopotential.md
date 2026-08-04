# Geopotencial completo

[Inicio](../index.md) · [Propagación](index.md) · [Modelos de gravedad](../engineering/gravity-models.md) · [J2](j2.md)

## Estado de soporte

Orbit no implementa un geopotencial completo.

No hay lector de coeficientes armónicos \(C_{nm}\) y \(S_{nm}\), selección de
modelo, grado, orden, normalización, mareas, variación temporal ni evaluación
de términos tesseral y sectorial. Las únicas perturbaciones gravitatorias
numéricas disponibles son los armónicos zonales J2, J3 y J4 del modelo Cowell.

## Consecuencia operativa

No se debe interpretar una composición J2/J3/J4 como un truncamiento
configurable de un campo gravitatorio completo. Los coeficientes disponibles
son constantes internas, no un producto de gravedad versionado ni una API de
modelo de Tierra.

## Alternativas disponibles

- [Dos cuerpos](two-body.md) para una órbita idealizada.
- [J2](j2.md) para la aproximación secular o el término numérico J2.
- [Cowell](cowell.md) con J2/J3/J4 para una sensibilidad de primer orden.
- [OEM](../formats/oem.md) o [SP3](../formats/sp3.md) cuando se necesita
  consumir una trayectoria ya tabulada por un sistema externo.

!!! warning "No sustituye validación externa"

    Los análisis que requieran geopotencial de grado y orden controlado deben
    realizarse en una herramienta o servicio que implemente y documente ese
    modelo. Orbit no ofrece una aproximación silenciosa.

!!! warning "Ecuación prevista para implementación futura"

    Un geopotencial hasta grado y orden \(N\) requeriría una expansión de
    armónicos esféricos y su gradiente:

    $$
    U(r,\phi,\lambda)=\frac{\mu}{r}\left[1+\sum_{n=2}^{N}
    \left(\frac{R_\oplus}{r}\right)^n\sum_{m=0}^{n}\bar P_{nm}(\sin\phi)
    \left(\bar C_{nm}\cos m\lambda+\bar S_{nm}\sin m\lambda\right)\right],
    \qquad \mathbf a=-\nabla U.
    $$

    | Símbolo | Significado | Unidad |
    | --- | --- | --- |
    | \(U\) | Potencial gravitatorio. | km²/s². |
    | \(r\) | Distancia geocéntrica del objeto. | km. |
    | \(\phi\), \(\lambda\) | Latitud geocéntrica y longitud. | rad. |
    | \(\mu\) | Parámetro gravitatorio terrestre. | km³/s². |
    | \(R_\oplus\) | Radio ecuatorial de referencia. | km. |
    | \(n\), \(m\), \(N\) | Grado, orden y límite de la expansión. | Adimensionales. |
    | \(\bar P_{nm}\), \(\bar C_{nm}\), \(\bar S_{nm}\) | Polinomio de Legendre normalizado y coeficientes armónicos. | Adimensionales. |
    | \(\mathbf a\) | Aceleración resultante. | km/s². |

    Orbit no evalúa aún esta expresión: `cowell-rk4` solo aplica central,
    J2, J3, J4 y drag. La tabla fija las unidades que deberá respetar una
    implementación futura antes de normalizar el estado de salida a SI.
