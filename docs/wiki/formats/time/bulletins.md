# Boletines IERS A y B

[Inicio](../../index.md) · [Formatos de tiempo](index.md)

## Estado de soporte

La ventana **Importar producto GNSS** acepta un ERP local del mismo producto
que el SP3 mediante `.ERP` o `.ERP.gz`. El archivo se conserva con su hash,
cobertura y procedencia y se usa cuando se solicita una conversión ITRF → ECI.
No se descarga, infiere ni empareja desde el nombre del SP3.

Sin ERP, Orbit etiqueta la salida como **Marco terrestre aproximado (sin ERP)**
y bloquea la conversión a ECI. Con ERP y la ruta de realización aplicada, la
etiqueta operacional es **ITRF (con ERP aplicado)**. ERP aporta orientación
terrestre, no una transformación de datum IGS→ITRF. Consulte [Productos GNSS
precisos](../precise-products.md) para los campos de la ventana y las
validaciones exactas.

## Rutas aún no integradas

- [IERS Bulletin A](https://maia.usno.navy.mil/products/bulletin-a) puede
  aportar EOP rápidos y predicciones. Una futura importación debe conservar que
  un valor es rápido o predicho: una predicción no se promociona a final.
- Los [productos IGS](https://igs.org/products/) publican ficheros ERP junto a
  ciertas series Final, Rapid y Ultra-Rapid. Orbit admite el ERP que el
  operador selecciona explícitamente en la misma carga; no descarga ni elige
  automáticamente una revisión remota.

## Alternativa actual

Use un snapshot local de [IERS EOP 20u24 C04](iers-c04.md) y una tabla local de
segundos intercalares.
