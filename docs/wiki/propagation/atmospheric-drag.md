# Arrastre atmosférico

[Inicio](../index.md) · [Propagación](index.md) · [Cowell](cowell.md) · [Modelo atmosférico](../engineering/atmospheric-models.md)

## Disponibilidad

El arrastre está disponible únicamente como término `drag` de `cowell-rk4`.
No está disponible en dos cuerpos, el preset fijo J2+J3+J4 ni
SGP4 configurable desde Orbit.

## Modelo aplicado

Con \(B=C_DA/m\), densidad \(\rho\) y velocidad relativa a una atmósfera
corrotante \(\mathbf v_{rel}\), Cowell aplica:

$$
\mathbf a_{drag}=-\frac{1}{2}B\rho\lVert\mathbf v_{rel}\rVert\mathbf v_{rel}.
$$

| Símbolo | Significado | Unidad |
| --- | --- | --- |
| \(\mathbf a_{drag}\) | Aceleración de arrastre aplicada por Cowell. | km/s² dentro del núcleo; SI al publicar `StateVector`. |
| \(B=C_DA/m\) | Coeficiente balístico por área. | m²/kg. |
| \(C_D\) | Coeficiente de arrastre. | Adimensional. |
| \(A\), \(m\) | Área de referencia y masa. | m², kg. |
| \(\rho\) | Densidad atmosférica. | kg/m³. |
| \(\mathbf v_{rel}\) | Velocidad respecto a la atmósfera corrotante. | m/s durante el cálculo de drag. |

La implementación calcula la velocidad relativa mediante el término de
rotación terrestre y evalúa una densidad exponencial por capas usando la
altura WGS-84. El cálculo interno conserva km y km/s, con conversiones para
mantener coherencia dimensional con los parámetros de arrastre en SI.

$$
\mathbf v_{rel}=\mathbf v-\mathbf\omega_\oplus\times\mathbf r,
\qquad
\rho(h)=\rho_0\exp\left(-\frac{h-h_0}{H}\right).
$$

| Símbolo | Significado | Unidad |
| --- | --- | --- |
| \(\mathbf v\), \(\mathbf r\) | Velocidad y posición del estado Cowell. | km/s, km; convertidas a SI donde corresponde. |
| \(\mathbf\omega_\oplus\) | Velocidad angular terrestre. | rad/s. |
| \(h\), \(h_0\), \(H\) | Altura, base y escala de la capa exponencial. | Misma unidad de longitud. |
| \(\rho_0\) | Densidad en la base de la capa. | kg/m³. |

Orbit evalúa \(\rho\) por capas WGS-84 y calcula el producto vectorial antes
de evaluar la norma de \(\mathbf v_{rel}\); ninguna de estas conversiones se
deja implícita en la interfaz.

## Parámetros

### Variables, unidades y uso en Orbit

El vector interno \(\mathbf r\) y \(\mathbf v\) usa km y km/s; para evaluar \(\mathbf v_{rel}\), \(\rho\) y \(B=C_DA/m\), Orbit convierte las magnitudes necesarias a SI. \(\rho\) es kg/m³, \(C_D\) es adimensional, \(A\) m², \(m\) kg y la aceleración vuelve a km/s² antes de sumarse en Cowell. \(h\), \(h_0\) y \(H\) se comparan en la misma unidad de longitud de la capa exponencial.

| Parámetro | Unidad | Restricción |
| --- | --- | --- |
| `drag_coefficient` | — | Finito y mayor que cero; valor predeterminado 2,2. |
| `area_m2` | m² | Finito y mayor que cero; valor predeterminado 1. |
| `mass_kg` | kg | Finito y mayor que cero; valor predeterminado 100. |

El coeficiente balístico usado es \(C_DA/m\). Si se usa `force_terms`, debe
incluirse `drag`; el booleano heredado `atmospheric_drag` no añade el término a
una composición explícita.

## Límites

- La densidad se fija a cero a partir de 1500 km.
- No hay flujo solar, índices geomagnéticos, viento, actitud, área variable ni
  modelo NRLMSISE/JB2008/DTM.
- No se ofrece una precisión de decaimiento ni tiempo de reentrada.

El modelo es útil para explorar el efecto cualitativo del arrastre en órbitas
manuales, no para predicción operacional. Véase
[Modelo atmosférico](../engineering/atmospheric-models.md).

!!! warning "Ecuación prevista para implementación futura"

    **Arrastre avanzado.** El runtime actual no incorpora MSIS ni forzamientos
    solar-geomagnéticos. Un modelo futuro podría evaluar:

    $$
    \rho=\rho_{\mathrm{MSIS}}(h,\phi,\lambda,t,F_{10.7},\overline{F}_{10.7},A_p).
    $$

    | Símbolo | Significado | Unidad |
    | --- | --- | --- |
    | \(\rho_{\mathrm{MSIS}}\) | Densidad estimada por el modelo MSIS. | kg/m³. |
    | \(h\) | Altura geodésica. | km o m, según el adaptador MSIS. |
    | \(\phi\), \(\lambda\) | Latitud y longitud geodésicas. | rad. |
    | \(t\) | Época de evaluación. | UTC/UT1 explícito. |
    | \(F_{10.7}\), \(\overline{F}_{10.7}\), \(A_p\) | Índices solar y geomagnético. | Unidades del producto MSIS. |

    No se evalúa en el runtime actual; un adaptador futuro deberá convertir su
    salida a kg/m³ antes de aplicar la ecuación de arrastre de Cowell.
