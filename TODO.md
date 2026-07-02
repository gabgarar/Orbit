# Orbit — Tareas futuras / Roadmap

Listado de ideas y mejoras ordenadas por área. Marca con `[x]` cuando se implemente.

---

## 🕐 Simulación y control de tiempo

- [ ] **Modo simulación por rango de fechas**: seleccionar fecha/hora de inicio y fin, ejecutar la simulación y ver la evolución de las órbitas en ese intervalo.
- [ ] **Modo tiempo real**: seguimiento live con actualización continua usando la hora del sistema (sin necesidad de arrcar el propagador manualmente).
- [ ] **Control de velocidad de reproducción**: ×1, ×10, ×100, ×1000, rewind y pausa desde la UI.
- [ ] **Timeline visual** en pantalla: barra scrubable para navegar por la simulación como en un vídeo.
- [ ] **Modo histórico / replay**: reproducir el estado de la constelación en un instante pasado dado un TLE de esa época.
- [ ] **Epoch de TLE vs. hora actual**: indicar en el HUD la diferencia entre la época del TLE y la hora simulada para advertir de inexactitud.

---

## 🔭 Propagadores

- [ ] **SGP4/SDP4** (actual, via python-sgp4): base operativa para órbitas LEO/MEO/GEO/HEO.
- [ ] **Selector de propagador en UI**: dropdown o panel para escoger qué propagador usar por satélite o globalmente.
- [ ] **J2 analítico simple**: propagador analítico de baja fidelidad para comparación rápida.
- [ ] **Integrador numérico RK4/RK45**: propagación de alta fidelidad con fuerza gravitacional completa.
- [ ] **Comparador de propagadores**: mostrar simultáneamente la trayectoria de un mismo satélite con dos propagadores distintos, en colores diferentes, para evaluar desviación.
- [ ] **Exportar efeméredes**: descargar CSV/JSON con posición y velocidad para un rango de tiempo dado.

---

## 🌍 Perturbaciones y física orbital

- [ ] **Achatamiento terrestre (J2, J3, J4)**: corregir precesión del nodo ascendente y del argumento del perigeo.
- [ ] **Resistencia atmosférica (drag)**: modelado con NRLMSISE-00 o exponencial simple; parámetro Cd y área de sección transversal configurables por satélite.
- [ ] **Presión de radiación solar (SRP)**: modelado básico con coeficiente de reflexión y área efectiva.
- [ ] **Gravedad de terceros cuerpos**: perturbaciones lunares y solares para órbitas altas (GEO, HEO, lunar).
- [ ] **Panel de perturbaciones activas**: checklist en la UI para activar/desactivar cada fuente de perturbación.
- [ ] **Estimación de vida útil orbital**: calcular el tiempo aproximado hasta reentrada en función del drag configurado.

---

## 🛰️ Maniobras orbitales

- [ ] **Delta-V impulsivo**: definir maniobra en un instante dado (vector ΔV o cambio de parámetros orbitales) y propagarla.
- [ ] **Transferencia de Hohmann**: asistente visual para calcular la transferencia entre dos órbitas circulares.
- [ ] **Corrección de plano (RAAN / inclinación)**: calcular ΔV necesario y representar la nueva órbita.
- [ ] **Station keeping**: definir ventana de tolerancia y calcular maniobras periódicas de mantenimiento.
- [ ] **Historial de maniobras**: línea de tiempo con todas las maniobras aplicadas a un satélite, exportable.

---

## 📡 Estaciones terrestres y cobertura

- [ ] **Gestor de estaciones terrestres**: añadir, nombrar y posicionar estaciones en el globo con máscara de elevación configurable.
- [ ] **Ventanas de visibilidad (AOS/LOS)**: calcular y mostrar cuándo cada satélite es visible desde cada estación en el rango de simulación.
- [ ] **Cono de cobertura del sensor**: visualizar el footprint/FOV de un satélite sobre la superficie terrestre en tiempo real.
- [ ] **Zona de cobertura acumulada**: mapa de calor de cobertura acumulada de una constelación en un periodo de tiempo.
- [ ] **Link budget básico**: potencia de señal estimada en función de distancia, ganancia de antena y frecuencia.
- [ ] **Tabla de pases**: vista tabular con AOS, LOS, elevación máxima y azimut para cada par satélite–estación.

---

## 🗺️ Visualización avanzada

- [x] **Vista 2D de ground track**: proyección equirectangular con trayectoria del satélite y footprint.
- [ ] **Terminator solar**: línea de separación día/noche animada en tiempo real sobre el mapa 2D.
- [ ] **Zona de sombra orbital**: visualizar cuándo el satélite entra en eclipse de la Tierra.
- [ ] **Cambio de referencial**: toggle entre marco inercial (ECI) y marco rotante (ECEF).
- [ ] **Trayectorias de impacto de debris**: mostrar la zona de reentrada estimada con incertidumbre.
- [ ] **Escala de tiempo logarítmica**: útil para visualizar órbitas muy elípticas (Molniya, GTO).
- [ ] **Panel de estado del sol**: posición del sol, sombra planetaria y ángulo beta de la órbita.

---

## 📊 Análisis orbital

- [ ] **Conjunciones (close approaches)**: detectar y alertar cuando dos objetos se acercan por debajo de un umbral de distancia configurable.
- [ ] **Dispersión de constelación**: mostrar evolución del RAAN drift a lo largo del tiempo para detectar descomposición de la constelación.
- [ ] **Parámetros orbitales en tiempo real**: panel con a, e, i, Ω, ω, ν actualizados en cada tick de simulación.
- [ ] **Histograma de altitud de perigeo/apogeo**: útil para analizar flotas grandes.
- [ ] **Análisis de cobertura temporal**: porcentaje de tiempo que un punto de la superficie está cubierto por al menos N satélites.

---

## 🌐 Fuentes de datos

- [ ] **Actualización automática de TLEs**: obtener TLEs frescos de CelesTrak o Space-Track directamente desde la app, con periodicidad configurable.
- [ ] **Importar TLE desde archivo local**: drag & drop de un fichero `.tle` o `.txt`.
- [ ] **Soporte de OMM (Orbital Mean-Elements Message)**: formato JSON/XML estándar de Space-Track.
- [ ] **Catálogos predefinidos**: ISS, Starlink, OneWeb, GPS, GLONASS, Galileo, debris, etc., seleccionables con un click.
- [ ] **Filtro por operador/propietario**: mostrar solo los satélites de una agencia o empresa concreta.
- [ ] **Alertas de decay**: notificación cuando un TLE en el catálogo tiene perigeo < umbral configurable.

---

## ⚙️ Infraestructura y rendimiento

- [x] **Migrar backend Python a FastAPI + uvicorn**: reemplazar el servidor HTTP casero y el WebSocket manual por FastAPI (Starlette), ganando endpoints REST tipados con Pydantic, documentación OpenAPI automática y mejor integración con asyncio. Base necesaria para la API de propagación, efeméridas y análisis orbital.
  - ✅ `server.py` completamente reescrito con FastAPI/uvicorn
  - ✅ WebSocket endpoint `/ws` nativo (Starlette)
  - ✅ Endpoints REST `/health` y `/catalog`
  - ✅ `requirements.txt` actualizado (fastapi, uvicorn[standard])
  - ✅ `webSockets.py` marcado como deprecated
  - ✅ Carga de 18.970 satélites funcional
- [ ] **Documentación API interactiva**: habilitar Swagger en `/docs` (generado automáticamente por FastAPI)
- [ ] **Endpoints REST adicionales**: `/propagate/{sat_id}`, `/orbits/{sat_id}`, `/aos-los`, `/ephemeris`
- [ ] **Caché de efeméridas pre-calculadas**: precalcular posiciones para el rango de simulación antes de reproducir.
- [ ] **Backend propagation API**: endpoint REST que acepta TLE + rango de tiempo y devuelve la efemérides, para desacoplar cálculo de render.
- [ ] **Modo offline**: funcionalidad completa sin conexión a internet (TLEs almacenados localmente, tiles offline).
- [ ] **Perfiles de configuración guardados**: guardar/restaurar sets completos de configuración (colores, propagador, perturbaciones) como presets con nombre.

---

## 🖥️ UX / Interfaz

- [ ] **Búsqueda rápida de satélite**: cuadro de búsqueda global (NORAD ID, nombre) que centra la cámara en el objeto.
- [x] **Modo presentación**: ocultar toda la UI excepto el globo para capturas y vídeos limpios.
- [ ] **Atajos de teclado**: documentados y configurables (foco, pausa, velocidad, modo cámara…).
- [ ] **Tour guiado**: tutorial interactivo para nuevos usuarios que explique las funciones principales.
- [x] **Soporte multiidioma**: i18n básica (ES/EN).
- [x] **Tema oscuro/claro**: toggle de apariencia para la UI (paneles, sidebar).

---

## 🔬 Simulación avanzada (largo plazo)

- [ ] **Propagación de covariancias (estado + incertidumbre)**: representar elipsoide de incertidumbre en posición.
- [ ] **Determinación de órbita (OD)**: ajustar la órbita a partir de un conjunto de observaciones simuladas o reales.
- [ ] **Monte Carlo de reentrada**: distribución estadística de puntos de impacto para objetos en decay.
- [ ] **Simulación de constelaciones Walker**: generador automático de constelaciones con parámetros T/P/F configurables.
- [ ] **Optimización de constelación**: asistente para encontrar la configuración de N satélites que maximiza la cobertura de una región.

---

*Última actualización: 2026-06-28*
