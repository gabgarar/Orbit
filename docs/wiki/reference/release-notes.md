# Notas de versión

## Alcance

Esta página registra únicamente versiones que pueden identificarse en el
historial Git del repositorio. No sustituye un sistema de releases publicado ni
declara una versión para cambios que permanecen sin commit.

El repositorio no contiene tags Git en el estado inspeccionado ni un artefacto
de release versionado. Los nombres de versión siguientes proceden de mensajes
de commit; deben tratarse como hitos históricos del código fuente, no como
paquetes descargables o contratos de soporte.

## Historial identificable

| Versión indicada | Fecha | Commit | Evidencia en historial |
| --- | --- | --- | --- |
| v0.0.24 | 2026-06-27 | `4dd03b1` | `Added v0.0.24` |
| v0.0.25 | 2026-06-27 | `740b2db` | `New version v0.0.25` |
| v0.1.0 | 2026-06-27 | `01bbb5d` | `New version v0.1.0` |
| v0.1.1 | 2026-07-02 | `cd76609` | `release: v0.1.1 — mejoras de UI (paletas clara/oscura, toolbar, footprint, lista de satélites)` |

La documentación histórica bajo `docs/general/VERSIONADO.md` contiene notas
adicionales de trabajo, pero no reemplaza etiquetas Git ni una política de
publicación automatizada.

## Estado de trabajo no publicado

Las modificaciones no confirmadas no reciben una versión en esta página. Una
lista de cambios de worktree no debe presentarse como release: puede contener
trabajo incompleto, cambios locales de configuración o ajustes no verificados.

## Política actualmente comprobable

| Aspecto | Estado |
| --- | --- |
| Tags Git de release | No presentes en el repositorio inspeccionado. |
| Artefactos de release publicados | No declarados. |
| Changelog generado | No implementado. |
| Versionado formal de REST API / WebSocket | No publicado. |
| CI que cree o publique releases | No declarada. |
| Archivo de historial manual | Existe bajo `docs/general/VERSIONADO.md`. |

## Requisitos para una nota de versión futura

Una release reproducible debería incluir, como mínimo:

1. Tag Git inmutable y versión coherente en los artefactos.
2. Fecha, hash de commit y alcance de los cambios.
3. Compatibilidad y migraciones de configuración, catálogo, API y proyectos.
4. Cambios de precisión, modelos, marcos, escalas de tiempo y productos EOP.
5. Pruebas ejecutadas y restricciones conocidas.
6. Imagen o mecanismo de distribución identificable.
7. Instrucciones de actualización y rollback de `config/`.

Esta lista describe información mínima de trazabilidad; no anuncia que el
mecanismo de publicación esté implementado.

## Referencias relacionadas

- [Roadmap](roadmap.md)
- [Contribuir](../development/contributing.md)
- [Testing](../development/testing.md)
