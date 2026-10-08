# TEST_REPORT — Pokémon Tactical Arena

**Entorno de pruebas**: macOS 26.2 (Darwin 25.2, Apple Silicon), Node v20.19.2, npm 10.8.2,
Chromium headless 156 (Playwright 1.64, renderizado por software SwiftShader/ANGLE).
Fecha: 2026-10-08. Semillas de bots fijadas en las pruebas: 7 y 2024.

## Qué se ejecutó

### 1. Pruebas automatizadas (`npm test`) — 47/47 pasan

**Mapa (`packages/shared/test/map.test.ts`, 10 pruebas)** — medidas sobre la rejilla de
navegación generada del mapa real:
- Conectividad spawn↔A/B para ambos equipos.
- Tiempos de recorrido (a 4,5 m/s, mejor punto de aparición): defensores→zona 4,3–5,1 s
  (objetivo 3–5 s), atacantes→zona 8,2–10,9 s (objetivo 8–11 s), rotación A–B ≈10,9 s
  (objetivo 9–12 s).
- Sin línea de visión spawn–spawn a altura de ojos (todas las parejas de puntos de aparición).
- Las puertas cerradas bloquean la salida en preparación; abiertas no.
- Línea de visión máxima muestreada: **36,8 m** (objetivo «aproximadamente 35 m»; desviación
  registrada: es una diagonal situacional plaza B → spawn defensor).

**Reglas (`rules.test.ts`, 24 pruebas)**:
- Economía: victoria +2400, derrota 1900 + racha (+400, tope +1200), bajas +200,
  instalación +200, desactivación +300, tope 6000; compras rechazadas fuera de fase,
  duplicadas, sin saldo, fuera del spawn, kit solo defensor.
- Escudo: ejemplo del documento (daño 20 contra escudo 5 → 5 escudo + 15 PV) y absorción 50 %.
- Daño congelado fuera de fases activas; debilitamiento suelta el núcleo y reparte créditos.
- Núcleo: instalación 3 s → cuenta atrás 35 s; interrupciones (moverse/atacar reinician;
  recibir daño no); expiración del reloj con instalación en curso = victoria defensora;
  desactivación 7 s / 4 s con kit; **empate exacto desactivación/cuenta atrás → vence el
  deadline (atacantes)**; eliminación doble en el mismo tick (defensa sin instalar, ataque
  instalado); tras instalar, eliminar atacantes no termina la ronda; defensores no pueden
  recoger el núcleo, atacantes lo recogen a <1 m.
- Mitades: tras 6 rondas se intercambian roles, economía/rachas/arsenal reiniciados; 7 gana;
  6–6 = empate sin prórroga.
- Supervivencia: sobrevivir conserva arma/escudo (y repone PV y cargador); morir lo pierde.
- Cambio de personaje: solo en preparación; pierde la carga de habilidad sin reembolso.
- Disparo: imposible dañar a través de un muro; impactos a cielo abierto; recarga completa;
  no se recarga con cargador lleno; no se dispara en preparación.

**Partida de bots (`botmatch.test.ts`, 2 pruebas)**:
- Los atacantes progresan hacia una zona en <26 s de la primera ronda (semilla 2024).
- Partida 5v5 completa (semilla 7) termina 7–x con >10 bajas y ≥1 instalación, nadie sale
  del mapa, y **el mismo resultado y el mismo número de ticks al repetir la semilla**
  (simulación determinista).

**Red (`apps/server/test/net.test.ts`, 12 pruebas)** contra el servidor real por WebSocket:
- Código de sala de 6 caracteres no ambiguos; unirse; equilibrio de equipos al entrar.
- Rechazo de alias/código inválidos y JSON corrupto; entradas corruptas (NaN, rangos absurdos,
  tipos erróneos) saneadas sin romper el servidor; artículo de compra inexistente ignorado;
  compra sin saldo rechazada.
- Cadencia excesiva (300 paquetes seguidos) descartada sin desconectar.
- Jitter/duplicados: secuencias repetidas o reordenadas no se encolan dos veces; la
  reutilización de la última entrada se corta a 0,25 s (sin «correr solo» por lag).
- Compra duplicada simultánea: un solo cobro y efecto.
- Desconexión → bot controla la entidad en ≤2 s conservándola humana; reconexión con token
  recupera el control; un token falso NO captura la plaza de otro jugador.
- Entrada tardía: sustituye a un bot y juega desde la ronda siguiente.
- Migración de anfitrión al humano más antiguo.
- Los snapshots no incluyen enemigos sin línea de visión del equipo.

### 2. Pruebas de navegador real (Playwright + Chromium, servidor `npm start`)

- `tools/browser_check.mjs`: menú → selección → solitario (10 personajes) → compra (B, escudo)
  → ronda activa con navegación hasta la zona A → disparos → marcador (Tab).
  **0 errores de consola.** Capturas 01–07 en `docs/capturas/`.
- `tools/browser_multi.mjs`: **dos sesiones independientes** crean/unen la sala con código,
  el anfitrión inicia, ambas ven la misma fase, el mismo recuento de vivos y el mismo marcador
  tras 30 s (ticks idénticos); ids distintos; una desconexión brusca no afecta a la otra.
  0 errores. Capturas 08–09.
- `tools/browser_fullmatch.mjs`: **partida en solitario completa desde el menú hasta la
  pantalla de resultados** (13,9 min reales, 0–7 con cambio de mitad e instalación-detonación
  de los bots en la 2.ª mitad). 0 errores de página. Captura 10.
- `tools/browser_training.mjs`: entrenamiento con muñecos (3 estáticos + 2 móviles), compra
  libre en cualquier momento, ayuda de controles e instalación de práctica (fase `planted`).
  0 errores. Captura 11.
- `tools/browser_leaks.mjs`: tres partidas consecutivas con vuelta al menú — número de
  canvases/HUD estable, sin residuos ni errores (sin acumulación de listeners/contextos).

### 3. Compilación y calidad

- `npm run build` sin errores. Carga inicial: **~630 KB sin comprimir (~155 KB gzip)**,
  muy por debajo del objetivo de 40 MB (todos los recursos son procedurales).
- `npm run typecheck` (TS estricto, 3 proyectos) y `npm run lint` (ESLint): limpios.

### 4. Rendimiento medido

- Simulación autoritativa: **~0,95 ms/tick** con 10 bots, utilidades y combate (presupuesto
  16,7 ms); una ronda completa de 100 s simula en ~2,6 s de CPU.
- Cliente a 1920×1080 en Chromium headless **con renderizado por software**: 60 FPS,
  16,7 ms/frame, 82 draw calls, ~21 k triángulos, ping 0 (worker local).
  *Nota honesta*: no se dispuso de una GPU integrada «de referencia» distinta de esta máquina;
  el objetivo «60 FPS en GPU integrada reciente» queda como aspiración razonable dado que
  se alcanza 60 FPS incluso por software, pero no está garantizado universalmente.
  No se midieron percentiles en hardware ajeno.

## Limitaciones y pruebas pendientes (no marcadas como aprobadas)

- **Inspección jugable con ratón real** (sensación de apuntado, retroceso): el entorno es
  headless sin pointer lock; se verificó con entrada simulada por teclado. Pendiente: jugar
  2 minutos con ratón (`npm run dev`, http://localhost:5173) y ajustar `sensibilidad` al gusto.
- **Latencia real de internet**: la compensación de lag y la reconexión están probadas con
  loopback + duplicados/jitter sintéticos; no se probó en una red WAN real.
- **Audio**: la síntesis se verifica por código (sin errores con el audio bloqueado), pero la
  mezcla/volúmenes no se pueden evaluar en headless; pendiente de escucha manual.
- **Safari/Firefox**: solo se automatizó Chromium; el código usa APIs estándar (WebGL,
  WebAudio, Pointer Lock, Worker) pero no hay verificación automatizada en otros motores.
- Objetivo de diseño «líneas ≤ ~35 m»: medida real 36,8 m (desviación aceptada y documentada).

## Cómo reproducir

```bash
npm install && npm test && npm run typecheck && npm run lint
npm run build && npm start           # en otra terminal:
node tools/browser_check.mjs
node tools/browser_multi.mjs
node tools/browser_training.mjs
node tools/browser_leaks.mjs
node tools/browser_fullmatch.mjs     # ~15–30 min reales
```
