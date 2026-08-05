# Cowell: fallos y límites

[Propagación](../index.md) · [Cowell](../cowell.md) · [Integradores numéricos](../numerical-integrators.md)

## En una frase

Cowell permite explorar una trayectoria calculando muchas veces su aceleración, pero no es todavía un motor de alta fidelidad ni una herramienta de seguridad operacional. Su resultado es una trayectoria calculada con los modelos disponibles y un paso numérico fijo; no es una garantía de precisión para cualquier órbita.

## Qué ocurre al cruzar la Tierra

Una órbita no puede continuar físicamente por el interior de la Tierra con los modelos que usa este propagador. La gravedad central se calcula como \(\mathbf a=-\mu\mathbf r/\lVert\mathbf r\rVert^3\). Cuando la distancia al centro \(\lVert\mathbf r\rVert\) se acerca a cero, el denominador se hace muy pequeño y la aceleración del modelo crece sin límite. Esa es la singularidad matemática del modelo de punto masa.

El problema aparece antes de llegar al centro: dentro de la Tierra, la gravedad de punto masa, la altura WGS-84 y la atmósfera exponencial ya no representan una situación física válida. Por eso Orbit revisa también los estados intermedios de RK4. Si uno alcanza un radio menor o igual que el radio polar WGS-84, detiene el cálculo y devuelve un error en vez de inventar una trayectoria bajo tierra.

Esto no es un detector de impactos. Cowell no calcula el segundo exacto en que se toca la superficie, no interpola el punto de contacto y no aplica rebote, fragmentación ni ninguna física de colisión. Solo dice: «esta integración ha salido del dominio donde el modelo tiene sentido».

## Por qué 60 segundos no sirven para todo

RK4 avanza actualmente con saltos de 60 s. Puede imaginarse como dibujar una curva con puntos separados un minuto: si la curva cambia suavemente, la aproximación puede ser útil; si gira o cambia muy deprisa entre dos puntos, se pierde detalle.

El integrador no compara dos soluciones para decidir si el salto fue demasiado grande. Tampoco recibe una tolerancia del tipo «quiero un error menor que X», ni vigila que la energía permanezca constante. Siempre da el siguiente salto de 60 s, aunque la dinámica de ese tramo mereciera pasos más pequeños.

| Situación | Por qué importa el paso fijo |
| --- | --- |
| Arco largo | Un pequeño error de cada salto puede acumularse durante miles de pasos. |
| Órbita muy excéntrica | Cerca del perigeo el objeto se mueve y cambia de dirección mucho más rápido que cerca del apogeo. |
| Perigeo bajo con drag | La densidad atmosférica cambia rápidamente con la altura; un paso grueso puede representar mal ese cambio. |
| Dinámica rápida o resonante | La escala temporal relevante puede ser menor que 60 s y quedar insuficientemente muestreada. |

El límite de pasos del inspector evita que una solicitud muy grande bloquee el servicio. No hace el resultado más preciso. Para abordar estos casos haría falta un integrador adaptativo con estimación de error, como Dormand–Prince o RKF45; ninguno está implementado en Orbit todavía.

## Lo que Cowell no hace todavía

### No localiza eventos

Un evento es algo que sucede entre dos instantes, por ejemplo cruzar una altura, entrar en eclipse o impactar. Cowell no busca la raíz de una condición ni reduce automáticamente el paso para encontrar el instante exacto. Solo evalúa sus etapas RK4 y aplica la barrera de validez terrestre descrita arriba.

### No incluye toda la física orbital

Actualmente solo puede componer gravedad central, J2, J3, J4 y arrastre atmosférico exponencial. No hay terceros cuerpos, presión de radiación solar, relatividad, geopotencial completo, mareas ni atmósfera de alta fidelidad. Si un efecto ausente es importante para el arco estudiado, la trayectoria no lo reflejará; no significa que el efecto sea cero en el mundo real.

### No calcula incertidumbre

Cowell propaga un único estado inicial. No propaga covarianza ni matriz de transición de estado, así que no puede responder «cuánto puede desviarse esta posición» ni producir una elipse de error. Su salida debe leerse como una trayectoria nominal.

## Uso recomendado de Cowell

Cowell es apropiado cuando se quiere comprender el efecto de una composición de fuerzas sobre un arco acotado, no certificar una trayectoria operacional. Resulta especialmente útil para:

- órbitas LEO o MEO de estudio con un arco moderado y requisitos de precisión compatibles con el paso fijo;
- estudios preliminares de dinámica y visualización de trayectorias manuales;
- pruebas de integración y comprobación de que una fuerza individual cambia la trayectoria en la dirección esperada;
- comparar una propagación numérica con dos cuerpos u otro modelo analítico sencillo;
- validar configuraciones de `force_terms`, por ejemplo gravedad central frente a central más J2;
- explorar cualitativamente el arrastre en LEO, sabiendo que el modelo atmosférico actual no sirve para predicción de decaimiento o reentrada.

## Cuándo no usar Cowell

No use la ruta Cowell/RK4 actual como resultado final para:

- órbitas muy excéntricas, donde el perigeo puede requerir pasos mucho menores que 60 s;
- órbitas GEO realistas, porque sin SRP, terceros cuerpos y otros efectos el comportamiento a largo plazo no es representativo;
- órbitas resonantes o dinámicas con escalas temporales rápidas;
- trayectorias con drag fuerte, predicción de reentrada o análisis detallado de la atmósfera;
- propagación de largo periodo, donde el error de paso fijo y los efectos omitidos se acumulan;
- precisión GNSS, OD, covarianza, evaluación de riesgo o ventanas que requieran localización precisa de eventos;
- maniobras complejas, ya que Cowell no incluye un modelo de maniobra ni estimación de parámetros.

En estos casos, use una efeméride externa validada cuando esté disponible o un propagador de mayor fidelidad fuera del alcance actual de Orbit.

## Referencias relacionadas

- [Dinámica cartesiana de Cowell](../cowell.md)
- [Integradores numéricos](../numerical-integrators.md)
- [Geopotencial completo](../full-geopotential.md)
- [Terceros cuerpos](../third-bodies.md)
