# Especificación Algorítmica: Optimizador Multi-Criterio de Horarios SIGA (Meta55)

Este documento detalla la formulación matemática, el modelo por máscaras de bits (bitmasks) y los algoritmos combinatorios implementados en [`src/frontend/components/schedule/scheduleOptimizer.ts`](file:///c:/Users/jjjj/Documents/Malla-USM/src/frontend/components/schedule/scheduleOptimizer.ts).

---

## 1. Representación Matricial por Máscaras de Bits (Bitmasks)

El motor implementa una representación ultracompacta del calendario semanal para evaluar millones de combinaciones de paralelos en milisegundos sin bloquear el hilo principal del navegador.

La semana académica se discretiza en **7 días** (Lunes a Domingo, índices $d \in \{0, \dots, 6\}$) y hasta **24 bloques horarios** por día (bloques 1 a 16 para jornada diurna y bloques 17 a 20+ para régimen vespertino).

El horario de un estudiante se modela como un vector de 7 enteros de hasta 24 bits:

$$\mathbf{M} = \left[ M_{\text{lun}}, M_{\text{mar}}, M_{\text{mie}}, M_{\text{jue}}, M_{\text{vie}}, M_{\text{sab}}, M_{\text{dom}} \right] \in (\mathbb{U}_{32})^7$$

Donde el bit $k$-ésimo ($0 \le k \le 23$) vale $1$ si el bloque $k+1$ está ocupado, y $0$ si está libre:
$$M_d \in [0, 2^{24} - 1]$$

---

## 2. Detección de Colisiones y Conteo de Topes (Clashes)

Dos o más asignaturas colisionan en un bloque horario $(d, b)$ si sus máscaras de bits se intersectan mediante la operación AND a nivel de bits:

$$\text{HayColisión}(A, B) \iff \exists d \in \{0, \dots, 6\} : (M_{A, d} \ \& \ M_{B, d}) \ne 0$$

Para un conjunto de paralelos seleccionados $\mathcal{S}$:
$$\text{clashCount} = \sum_{d=0}^{6} \sum_{i < j} \text{popcount}(M_{i, d} \ \& \ M_{j, d})$$

Donde $\text{popcount}$ se calcula mediante conteo rápido de bits en tiempo constante $O(1)$.

---

## 3. Formulación de Ventanas Horarias y Días Libres

### Ventanas / Horas Muertas en Campus
Una ventana representa horas libres improductivas entre la primera y la última clase de un mismo día:

$$\text{Ventanas}_d = \begin{cases}
(b_{\max, d} - b_{\min, d} + 1) - \text{popcount}(M_d) & \text{si } \text{popcount}(M_d) \ge 2 \\
0 & \text{en caso contrario}
\end{cases}$$

$$\text{windowBlocks} = \sum_{d=0}^{4} \text{Ventanas}_d$$
*(Se omiten fines de semana del cálculo de ventanas por constituir jornadas de evaluación atípicas).*

### Cuantificación de Días Libres
- **Días Libres Completos ($\text{freeDays}$):**
  $$\text{freeDays} = \sum_{d=0}^{4} \mathbb{I}(\text{popcount}(M_d) == 0)$$
- **Medios Días Libres ($\text{freeHalfDays}$):** Mañanas (bloques 1 a 8, $\le 14:00$) o tardes (bloques 9 a 16, $> 14:00$) sin clases:
  $$\text{freeMornings} = \sum_{d=0}^{4} \mathbb{I}\left( (M_d \ \& \ \text{0x00FF}) == 0 \right)$$
  $$\text{freeAfternoons} = \sum_{d=0}^{4} \mathbb{I}\left( (M_d \ \& \ \text{0xFF00}) == 0 \right)$$
  $$\text{freeHalfDays} = \text{freeMornings} + \text{freeAfternoons}$$

---

## 4. Estrategia Algorítmica Dual: Exhaustiva vs Beam Search

Dado el conjunto de asignaturas $\{C_1, \dots, C_k\}$ con número de paralelos ofertados $|P_{C_i}|$, el tamaño del espacio combinatorio es $|\Omega| = \prod_{i=1}^k |P_{C_i}|$:

- **Espacio Pequeño ($|\Omega| \le 5.000$ combinaciones):**
  Se ejecuta una **búsqueda cartesiana exhaustiva completa**, garantizando el óptimo global absoluto.
- **Espacio Masivo ($|\Omega| > 5.000$ combinaciones):**
  Se activa automáticamente un algoritmo de **Beam Search heurístico** con un ancho de haz de $W = 60$. En cada etapa, se conservan únicamente los $W$ estados más prometedores según la estrategia de ordenamiento lexicográfico elegida:
  - `minimize_clashes`: Prioridad 0 topes $\rightarrow$ menor ventana $\rightarrow$ mayor tiempo libre.
  - `minimize_windows`: Prioridad 0 topes $\rightarrow$ compactación de horario $\rightarrow$ días libres.
  - `maximize_free_time`: Prioridad 0 topes $\rightarrow$ maximizar días y medios días libres $\rightarrow$ ventanas.

Esto acota la complejidad temporal a $O(k \cdot W \cdot \max |P|)$, garantizando un tiempo de cómputo en el navegador inferior a **50 ms** incluso para espacios de miles de combinaciones.
