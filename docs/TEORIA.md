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

### Limitación conocida: a 1 m el enlace no es fiable (twist y cola del tono fuerte)

**Qué es el twist.** Ningún altavoz, micrófono ni habitación reproduce igual de fuerte
todas las frecuencias. Si uno de los dos tonos del FSK llega más débil que el otro, se
dice que hay _twist_ (el término viene de la telefonía, donde se medía entre los dos
tonos de cada tecla). Con un altavoz de portátil y un micrófono de móvil, y con
reflexiones en la mesa que cancelan parcialmente una frecuencia concreta (filtro peine),
diferencias de 10 dB son normales.

**Los datos.** Prueba del 8 de noviembre de 2026: el portátil (Chrome, Windows) emite y
el iPhone (Safari) recibe, a 50 Bd, el mensaje «¡Hola, mundo! 👋» (19 bytes).

| Prueba                    | Resultado                                                               |
| ------------------------- | ----------------------------------------------------------------------- |
| Primera prueba, a ≈ 30 cm | BER 0, confianza media 0,92                                             |
| A ≈ 1 m, cuatro intentos  | 1 correcto, 3 con errores                                               |
| Grabación analizada (1 m) | 17 bits erróneos de 152 (BER 0,112); confianza media 0,22 y mínima 0,04 |

En la grabación analizada la señal llega a −35,6 dBFS y el ruido está en −75,2 dBFS:
**SNR ≈ 39,6 dB**, es decir, Eb/N0 ≈ 66 dB. El pico es de −25,7 dBFS, sin saturación.
**El ruido no es el problema:** con ese Eb/N0 la BER teórica es cero a efectos
prácticos. Lo que falla es la forma de la señal:

| Tramo del mensaje   | Tono 0 (2000 Hz) | Tono 1 (3000 Hz) | Twist   |
| ------------------- | ---------------- | ---------------- | ------- |
| 3 primeros bytes    | −29,7 dB         | −43,0 dB         | 13,3 dB |
| Centro (bytes 3–14) | −31,3 dB         | −40,8 dB         | 9,5 dB  |
| 2 últimos bytes     | −31,8 dB         | −41,7 dB         | 9,9 dB  |

(Potencia de cada tono, medida con Goertzel, en los símbolos en los que le toca sonar.
En una grabación del mismo día que se decodificó sin errores el twist era de 4,4 dB.)

**El twist solo no explica el fallo: hace falta además la cola.** Cuando el emisor
cambia de tono, el anterior no desaparece al instante: la habitación lo sigue devolviendo
(reverberación) durante uno o dos símbolos de 20 ms. Medido en la grabación:

| Símbolo dentro de una racha de «1» | Tono 0 (el que ya no suena) | Tono 1 (el que toca) |
| ---------------------------------- | --------------------------- | -------------------- |
| 1.º tras el cambio                 | −37,3 dB                    | −41,3 dB             |
| 2.º                                | −40,6 dB                    | −41,6 dB             |
| 3.º                                | −48,8 dB                    | −40,3 dB             |

En el primer «1» después de un «0», **el eco del tono fuerte llega 4 dB por encima del
tono débil que se está emitiendo**. Con los dos tonos igual de fuertes, ese mismo eco
quedaría 6 dB por debajo y no molestaría. Al revés no pasa: durante los «0», el resto
del tono 1 queda 18 dB o más por debajo del tono 0.

**Por qué influye la distancia.** El sonido directo pierde 6 dB cada vez que se dobla
la distancia (de 30 cm a 1 m, unos 10 dB), mientras que la reverberación de la
habitación es más o menos igual en todas partes. Al alejarse, el eco pesa 10 dB más
respecto a la señal directa. Esta explicación es la esperable, pero **no está
comprobada**: falta repetir la prueba a 30 cm y a 1 m con la misma versión y la misma
colocación.

**Cómo falla el receptor de la fase 1** (los 17 errores, uno a uno):

1. **Arranque (6 errores en los 3 primeros bytes).** Hasta ver el primer bit de inicio,
   el receptor supone que los dos tonos llegan igual de fuertes (−42,9 dB los dos,
   cuando el tono 0 real está en −30,8 dB). Por eso sitúa el primer flanco 0,39 símbolos
   antes de tiempo y decide con un sesgo de 3 a 6 dB hacia el «0» durante los bytes 1 y 2.
2. **Centro (0 errores).** A partir del byte 3 las estimaciones de nivel se quedan a
   menos de 4,5 dB de las reales y el error de sincronía no pasa de 0,13 símbolos. Aun así la
   confianza es baja, porque la cola del tono 0 deja muchas decisiones casi en empate.
3. **Final (11 errores en los 2 últimos bytes).** El bit de inicio del byte 17 llega a
   unos −38 dB, 5 dB por debajo del nivel estimado para el tono 0 (−33,1 dB), y la
   comprobación de nivel del bit de inicio lo descarta dos veces como falso arranque. El
   receptor se engancha entonces 1,9 símbolos tarde, y 3,0 en el byte siguiente.

Para separar las causas se repitió la decisión de los 152 bits sobre la grabación en
condiciones idealizadas:

| Condición                                             | Bits erróneos |
| ----------------------------------------------------- | ------------- |
| Sincronía perfecta, sin compensar el twist            | 39            |
| Sincronía perfecta, twist real constante y conocido   | 3             |
| Sincronía del receptor, twist real conocido           | 18            |
| Sincronía perfecta, niveles estimados por el receptor | 4             |
| Lo que ocurrió (sincronía y niveles del receptor)     | 17            |

Conclusión: la compensación de twist funciona (de 39 a 3–4 errores) y **casi todo lo que
se pierde es por sincronía**, igual que en la limitación anterior.

**Qué se descartó.** El receptor anterior a las correcciones de twist (commit `32660bc`)
y el actual decodifican esa grabación exactamente igual (`npm run replay`), así que no
es una regresión del código. Y en simulación el receptor supera un twist de 10 y de
15 dB en los dos sentidos (tono 0 débil o tono 1 débil) sin un solo error con las
semillas de test: **el simulador todavía no reproduce este fallo**, porque esos tests
crean el twist con un único eco muy corto y no incluyen la cola de reverberación del tono
fuerte. Ningún umbral se ha ajustado con esta grabación.

**Solución prevista.** El preámbulo conocido de la fase 2 permitirá medir el nivel de
los dos tonos y la temporización **antes** del primer byte, y mantener la sincronía de
toda la trama en lugar de volver a buscarla en cada bit de inicio. Los códigos
correctores de la fase 3 absorberán los errores sueltos, y el OFDM de la fase 5, con
prefijo cíclico e igualación por portadora, está pensado precisamente para canales con
eco y respuesta en frecuencia desigual.
