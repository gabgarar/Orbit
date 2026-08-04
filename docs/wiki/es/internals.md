# Internals

## Visión general

Los internals hacen explícitas las hipótesis de tiempo y coordenadas para que cada resultado sea reproducible junto con sus datos de referencia y ruta de modelo.

## Reducción de marcos

TEME usa la ruta GMST→PEF→ITRF con movimiento polar. Los marcos celestes modernos usan IAU 2006/2000A e IERS cuando `pyerfa` está disponible.

```text
UTC + DUT1 → UT1 → rotación terrestre → PEF/TIRS + xp, yp → ITRF
UTC + (TAI−UTC) + 32.184 s → TT
GCRF/EME2000 → CIRS → TIRS → ITRF
```

Derivadas de la matriz transforman velocidad y aceleración; la covarianza usa la forma de transición de estado correspondiente.

## Datos, realizaciones y modo estricto

Los proveedores EOP son locales y versionados: DUT1, movimiento polar, correcciones CIP, fuente, versión, calidad e identidad de snapshot. Nunca descargan datos durante un cálculo.

Modo estricto admite calidad final/rapid, rechaza extrapolación y exige tabla de segundos intercalares válida. Una realización ITRF no se infiere de EOP; IGS20↔ITRF2020 es opcional, registra su autoridad de datum y excluye correcciones de estación/antena.

## Modelo numérico y pruebas

Cowell integra \(\ddot{\mathbf r}=\mathbf a_{central}+\sum_i\mathbf a_i\) con RK4 de paso fijo y caché de estados exactos. Las pruebas Docker cubren contratos Node/frontend/Python antes de crear la imagen.

## Límites explícitos

- El fallback visual no es una transformación de precisión.
- Solo se cubren marcos geocéntricos Earth.
- No hay alineación de datum implícita para SP3/OEM de alta fidelidad.

## Siguientes destinos

<div class="grid cards" markdown>

- :material-orbit: **Volver a los contratos**

  Estados, elementos, marcos y escalas temporales.

  [Ir a conceptos de ingeniería →](engineering.md)

- :material-chart-timeline-variant: **Aplicar los modelos**

  Propagadores, fuerzas e integración.

  [Ir a propagación →](propagation.md)

</div>
