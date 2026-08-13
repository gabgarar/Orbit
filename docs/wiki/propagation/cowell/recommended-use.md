# Cowell: uso recomendado

[Propagación](../index.md) · [Cowell](../cowell.md) · [Fallos y límites](limits.md)

## Cuándo usar Cowell

Cowell es apropiado cuando se quiere comprender cómo una composición de fuerzas cambia una trayectoria en un arco acotado. Es una herramienta de diseño y exploración, no una certificación operacional.

- Órbitas LEO o MEO de estudio con un arco moderado y requisitos compatibles con el paso fijo de 60 s.
- Estudios preliminares de dinámica y visualización de trayectorias manuales.
- Pruebas de integración y comprobación de que una fuerza individual cambia la trayectoria en la dirección esperada.
- Comparación de Cowell con dos cuerpos u otro modelo analítico sencillo.
- Validación de `force_terms`, por ejemplo gravedad central frente a central más J2.
- Exploración cualitativa del arrastre en LEO. El modelo atmosférico actual no debe usarse para predecir decaimiento o reentrada.

## Cuándo elegir otra herramienta

No use la ruta Cowell/RK4 actual como resultado final para:

- órbitas muy excéntricas, donde el perigeo puede requerir pasos mucho menores que 60 s;
- órbitas GEO de misión o arcos largos, porque siguen faltando mareas,
  albedo/IR, actitud, penumbra y control adaptativo de error;
- órbitas resonantes o dinámicas con escalas temporales rápidas;
- trayectorias con drag fuerte, predicción de reentrada o análisis detallado de la atmósfera;
- propagación de largo periodo, donde el error de paso fijo y los efectos omitidos se acumulan;
- precisión GNSS, OD, covarianza, evaluación de riesgo o ventanas que requieran localizar eventos con precisión;
- maniobras complejas, porque Cowell no incluye modelo de maniobra ni estimación de parámetros.

En esos casos, use una efeméride externa validada si está disponible o un propagador de mayor fidelidad fuera del alcance actual de Orbit.
