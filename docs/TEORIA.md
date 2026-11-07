# Teoría del módem acústico

Este documento explica, fase a fase, los conceptos de comunicaciones digitales que
implementa el proyecto. Se completa al terminar cada fase.

## Fase 1 — FSK binario

_La explicación completa se redactará al cerrar la fase 1._

### Cómo se mide la SNR y su relación con Eb/N0

- **SNR (relación señal/ruido)** en el simulador: potencia media de la señal recibida
  (mientras dura) dividida entre la potencia σ² del ruido blanco gaussiano, medida en
  **toda la banda** del receptor, de 0 a fs/2.
- Como el ruido es blanco, su densidad espectral unilateral es **N0 = 2σ²/fs**, y la
  energía por bit es **Eb = S/Rb**. Por tanto:

  **Eb/N0 = SNR · fs / (2·Rb)**, es decir, Eb/N0 (dB) = SNR (dB) + 10·log10(fs / 2Rb).

  Con fs = 48 kHz: +26,8 dB a 50 Bd, +23,8 dB a 100 Bd y +20,8 dB a 200 Bd. Un módem más
  lento acumula más energía por bit, así que la misma SNR "vale" más.

- La BER teórica del FSK binario con tonos ortogonales y detección no coherente, con
  sincronización perfecta, es **Pb = ½·e^(−Eb/2N0)**.

### Cómo se cuenta la BER

Si se pierde o se inventa un byte, comparar posición a posición marcaría como erróneos
todos los bytes siguientes. Por eso antes de contar se **alinean** las secuencias:

- En simulación se usa el instante real de cada byte (se conoce), lo que además permite
  atribuir cada fallo a su causa.
- Sin esa información (pruebas por el aire) se usa la **distancia de edición**
  (Levenshtein): sustituciones = bytes con bits erróneos, borrados = bytes perdidos,
  inserciones = bytes inventados.
- Un byte perdido cuenta como 8 bits erróneos; los inventados se informan aparte porque no
  son bits enviados. La «BER de decisión» solo mira los bytes recibidos en su sitio.

### Limitación conocida: la detección de portadora

El receptor de la fase 1 decide que «hay señal» con la **pureza**: la fracción de la
potencia de la banda 1,4–3,9 kHz que corresponde a los dos tonos, exigiendo 3 símbolos
seguidos por encima de un umbral. Ese cociente depende de la SNR **dentro de la banda**,
no de la energía por símbolo, así que **no mejora con símbolos más largos**: a 50 Bd la
decisión de bit podría funcionar con mucho menos señal de la que el detector necesita
para enterarse de que hay transmisión.

Evidencia del banco de medidas (`npm run bench`, 20 transmisiones de 100 bytes por punto,
semillas de ajuste), a SNR = −10 dB:

| Velocidad | Eb/N0   | Bytes perdidos sin portadora | Bit de inicio perdido | Inventados | Errores de decisión de bit |
| --------- | ------- | ---------------------------- | --------------------- | ---------- | -------------------------- |
| 50 Bd     | 16,8 dB | 13                           | 0                     | 0          | 0                          |
| 100 Bd    | 13,8 dB | 0                            | 8                     | 6          | 1                          |

Y a −11 dB, a 50 Bd, la portadora no se detecta en 10 de las 20 transmisiones, aunque la
BER teórica a ese Eb/N0 (15,8 dB) es del orden de 10⁻⁹. Es decir: **a 50 Bd las
decisiones de bit son perfectas y todo lo que se pierde es por detección**, y por eso
50 Bd llega a dar más BER total que 100 Bd, al revés de lo que predice la teoría.

En general, en la fase 1 la sincronización y la detección, no la decisión de bit, son el
cuello de botella: a 200 Bd y Eb/N0 = 10,8 dB la BER de decisión es 2,7·10⁻³ (unas dos
veces la teórica, ≈ 0,6 dB de pérdida por la imprecisión al colocar la ventana de cada
símbolo), pero la BER total es 4,8·10⁻² por bits de inicio perdidos y bytes inventados.

**Solución prevista (fase 2):** sustituir este detector por un **preámbulo conocido
detectado por correlación**. La correlación con una secuencia conocida de muchos símbolos
integra toda su energía, de modo que la detección mejora con Eb/N0 igual que la
decisión de bit, y además da la temporización exacta de la trama.

Resultados completos: [docs/results/phase1-ber.md](results/phase1-ber.md).
