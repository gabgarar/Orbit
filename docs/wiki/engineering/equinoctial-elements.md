# Elementos equinocciales

[Inicio](../index.md) · [Ingeniería](index.md) · [Elementos keplerianos](keplerian-elements.md) · [Representaciones orbitales](orbit-representations.md)

## Estado de soporte

Orbit no implementa elementos equinocciales como contrato de entrada, salida,
interpolación, conversión ni visualización.

No existe una correspondencia publicada entre campos de la interfaz y el
conjunto \((a,h,k,p,q,\lambda)\), ni una política para elementos medios frente
a osculadores. Por tanto, un fichero o una integración que entregue esos
elementos debe convertirlos fuera de Orbit a un estado cartesiano con marco,
escala temporal y época explícitos.

!!! warning "No usar campos ad hoc"

    No almacene elementos equinocciales en metadatos libres esperando que el
    runtime los propague. Orbit los trataría como información no operativa.

## Alternativas implementadas

- [Estados cartesianos](cartesian-states.md) para entradas de estado y
  efemérides tabuladas.
- [Elementos keplerianos](keplerian-elements.md) para diseños manuales
  elípticos de dos cuerpos o J2.
- [OEM](../formats/oem.md) o [SP3](../formats/sp3.md) para una trayectoria
  tabulada, mediante los lectores Python disponibles.

La ausencia de esta representación es deliberada: evita publicar fórmulas de
conversión sin un contrato de tipo de elemento, marco y modelo dinámico.
