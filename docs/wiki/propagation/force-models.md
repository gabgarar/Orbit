# Modelos de fuerza

[Inicio](../index.md) · [Propagación](index.md) · [Cowell](cowell.md) · [Modelos de gravedad](../engineering/gravity-models.md)

## Contrato de composición

La composición de fuerzas pertenece a `cowell-rk4`. El estado se integra en
`EME2000` y cada término devuelve una aceleración en km/s² en ese mismo marco.
La gravedad central es obligatoria; `force_terms` describe exclusivamente los
términos adicionales. Un término no solicitado no se añade de forma implícita.

| Grupo | Término | Identificador canónico | Situación |
| --- | --- | --- | --- |
| Gravitacional | [Gravedad central](point-mass.md) | `central` | Disponible y obligatoria. |
| Gravitacional | [Zonales históricos](j2.md) | `j2`, `j3`, `j4` | Disponibles por compatibilidad; no son un campo de gravedad configurable. |
| Gravitacional | [Geopotencial de grado y orden](full-geopotential.md) | `geopotential` | Disponible con campo ICGEM local identificado y ruta terrestre estricta. |
| Gravitacional | [Tercero cuerpo solar](third-bodies.md) | `third-body-sun` | Disponible con `eraEpv00` aproximado, cobertura y procedencia. |
| Gravitacional | [Tercero cuerpo lunar](third-bodies.md) | `third-body-moon` | Disponible con `eraMoon98` aproximado, cobertura y procedencia. |
| Gravitacional | [Mareas](tides.md) | — | Pendiente. |
| No gravitacional | [Arrastre exponencial](atmospheric-drag.md) | `drag` | Disponible; modelo exploratorio de baja fidelidad. |
| No gravitacional | [Presión de radiación solar](solar-radiation-pressure.md) | `solar-radiation-pressure` | Disponible: modelo *cannonball* y umbra cilíndrica. |
| No gravitacional | [Albedo / IR terrestre](albedo.md) | — | Pendiente. |
| Relativista | [Schwarzschild terrestre](relativity.md) | `relativity` | Disponible; no incluye relatividad general completa. |

Los alias `sun`, `moon` y `srp` son únicamente de compatibilidad de entrada.
Los metadatos y la API deben publicar los identificadores canónicos anteriores.

!!! warning "No duplicar la gravedad"

    `geopotential` incluye los armónicos zonales que el campo contenga. No se
    debe combinar con `j2`, `j3` o `j4`, pues se sumaría dos veces el mismo
    efecto. Los zonales históricos se conservan para proyectos y presets
    existentes, no como sustituto de un campo ICGEM.

## Marcos, época y datos auxiliares

No todos los modelos se evalúan en el mismo marco físico. La regla de Orbit es:

1. Integrar el estado cartesiano en `EME2000`.
2. En **cada etapa RK4** y para cada término ligado a la Tierra, transformar el
   estado a `ITRF` en la época de esa etapa.
3. Evaluar allí la aceleración libre del modelo terrestre.
4. Rotar solo esa aceleración de vuelta a `EME2000` y sumarla a la derivada.

El flujo para un término terrestre es:

```text
EME2000 (r, v, t) ──transformación estricta──> ITRF (r, v, t)
       │                                           │
       └── R_ITRF→EME2000(t) · a_ITRF(r, v, t) <───┘
```

La integración **no** se hace en ITRF. Si se integrase allí habría que añadir
fuerzas ficticias de Coriolis, centrífuga y Euler. Rotar la aceleración libre al
marco inercial evita introducir esas fuerzas de forma parcial o incorrecta.

Para habilitar un término terrestre de alta fidelidad, la ruta debe disponer de
todos estos elementos y rechazar la operación si falta alguno:

- EOP con cobertura de la época, incluidos <span class="arithmatex">\(x_p\)</span>, <span class="arithmatex">\(y_p\)</span> y UT1−UTC;
- una instantánea local, versionada, íntegra y no caducada de segundos
  intercalares, con cobertura temporal;
- ERFA/SOFA para la reducción IAU 2006/2000A;
- realización terrestre declarada y, cuando corresponda, la ruta de alineación
  de la realización del producto a ITRF;
- procedencia del archivo y de la configuración de grado/orden aplicada.

No hay *fallback* visual ni aproximado para `geopotential`: si la ruta estricta
no está disponible, la selección debe fallar de forma explícita. Esta exigencia
no convierte por sí sola RK4 de paso fijo en un propagador operacional; evita
prometer una orientación terrestre que no se ha aplicado.

## Identidad y procedencia del resultado

`model_id` permanece `cowell-rk4`. `force_model_id` identifica la composición
efectiva y la procedencia debe registrar, cuando aplique:

- identificadores canónicos de los términos;
- para geopotencial: modelo, fuente, huella del archivo, normalización,
  <span class="arithmatex">\(\mu\)</span>, radio de referencia, grado y orden usados;
- para EOP: proveedor, intervalo y calidad de cobertura;
- para segundos intercalares: versión, huella y fecha de expiración;
- para Sol/Luna: proveedor de efemérides, intervalo de validez y constantes;
- para SRP: <span class="arithmatex">\(C_R\)</span>, área, masa y modelo de eclipse;
- para relatividad: formulación y constantes empleadas.

Un resultado sin esta procedencia es una visualización, no una evidencia de que
se aplicó una configuración física concreta.

## Presets heredados

| Entrada heredada | Fuerzas resultantes |
| --- | --- |
| `two-body` | `central` |
| `j2` | `central`, `j2` |
| `j2-j3-j4` | `central`, `j2`, `j3`, `j4` |

Estos presets no cambian automáticamente a `geopotential`; hacerlo alteraría
su comportamiento histórico. El booleano heredado de arrastre solo se emplea
al traducir un preset. Para `force_terms`, la lista explícita es autoritativa.

## No confundir con SGP4

SGP4 acepta un TLE y tiene un contrato dinámico propio. Los términos Cowell no
se aplican a un objeto de catálogo SGP4 ni corrigen un TLE. Para una comparación
posterior entre propagadores se deberá fijar el mismo instante, marco, unidades,
datos auxiliares y contrato de error antes de interpretar una diferencia.

Consulte las páginas de cada modelo para sus ecuaciones, restricciones y datos
necesarios.
