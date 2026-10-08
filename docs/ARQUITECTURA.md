# Arquitectura

## Visión general

Monorepo npm workspaces con **una única simulación autoritativa** compartida:

- `packages/shared` — TypeScript puro, sin dependencias de navegador ni Node:
  - `constants.ts`: todos los valores de diseño (velocidades, daños, economía, tiempos).
  - `map.ts`: descripción declarativa de «Estación Aurora» (cajas AABB con etiqueta de material,
    puertas, zonas A/B, apariciones, pistas para bots). Cliente (render + minimapa), servidor
    (colisiones) y navegación de bots derivan todo de esta única fuente.
  - `collision.ts`: cápsula-contra-AABB con escalón (≤0,25 m), raycast por losas, cilindro y
    esfera para impactos, línea de visión.
  - `movement.ts`: integración de un tick de movimiento (determinista; la usan el servidor,
    el worker y la predicción del cliente).
  - `weapons.ts`: dispersión (base/movimiento/aire/agachado/apuntado/ráfaga) y cadencias.
  - `sim.ts` (`GameSim`): fases de ronda, núcleo, economía, utilidades, daño/escudo, asistencias,
    compensación de latencia (historial de hitboxes ≤150 ms, rebobinado por `ackTick`),
    visibilidad por equipo (oclusión + niebla) y generación de snapshots filtrados.
  - `bots.ts`: percepción (FOV 110°, 35 m, oclusión, memoria 3 s, audición por eventos),
    A* sobre `nav.ts` (rejilla de 0,5 m generada del mapa), roles, compras, utilidades con
    contexto, detección de atasco (2 s re-ruta, 5 s ruta alternativa).
  - `host.ts` (`MatchHost`): bucle 60 Hz + snapshots 20 Hz + saneamiento de entradas.
  - `protocol.ts`: mensajes tipados C2S/S2C (JSON sobre WebSocket).

- `apps/server` — Node + `ws`. `Room` gestiona lobby (código de 6 caracteres sin ambigüedad,
  tokens de sesión de 128 bits, equilibrio de equipos, anfitrión), partida (relleno con bots,
  relevo de bot en ≤2 s al desconectar, reconexión con token 60 s, entrada tardía sustituyendo
  a un bot al empezar la siguiente ronda, migración de anfitrión, destrucción de sala tras 60 s
  sin humanos) y límites de frecuencia (≤45 paquetes de entrada/s, ≤10 mensajes/s, ≤16 KB).
  El mismo proceso sirve los estáticos de la build (mismo origen).

- `apps/client` — Three.js + Vite.
  - **Solitario/entrenamiento**: `localHost.worker.ts` ejecuta `GameSim + MatchHost` en un
    Web Worker; el cliente habla el mismo protocolo a través de un adaptador de transporte
    (`WorkerTransport` / `WSTransport`). No hay dos versiones del juego.
  - **Predicción**: el cliente simula su movimiento a 60 Hz con `stepMovement`, envía entradas
    en paquetes de 2 (30 Hz) y reconcilia con el `ackSeq` del snapshot reproduciendo las
    entradas pendientes. Resto de entidades: interpolación con búfer de 100 ms.
  - **Render**: geometría del mapa fusionada por material (pocas draw calls), sombras según
    calidad, DPR ≤1,5, resolución interna 75 % opcional, pools de trazos/partículas.
  - **Audio**: síntesis WebAudio (osciladores/ruido) con panoramizado espacial; se desbloquea
    tras el primer gesto del usuario.

## Red y autoridad

El cliente envía **intenciones** (`PlayerInput {seq, mover, yaw, pitch, botones, ackTick}`),
nunca posiciones ni daño. El servidor valida esquema, rangos, frecuencia y fase; descarta
duplicados/reordenados por `seq` y limita la reutilización de la última entrada a 0,25 s.
Los disparos rebobinan a los enemigos al tick que el cliente había visto (`ackTick`),
acotado a 150 ms, con la geometría estática siempre bloqueando.

Los snapshots a 20 Hz contienen: estado propio y de aliados completo, **solo los enemigos con
línea de visión del equipo** (más marcadores de última posición ≤2 s), zonas, proyectiles,
núcleo (sin posición del portador oculto para los defensores) y eventos filtrados (sonidos solo
si algún aliado puede oírlos). Los debilitados reciben la vista de su equipo (sin cámara libre).

## Simultaneidad y resolución de ronda

Por tick: 1) reloj de fase — un deadline vencido resuelve la ronda **antes** de procesar
interacciones (en empate exacto gana el deadline); 2) entradas/movimiento/acciones;
3) zonas/proyectiles; 4) núcleo; 5) eliminaciones del tick (doble eliminación: defensa si no
está instalado, ataque si lo está). `endRound` es idempotente y congela daño y acciones.

## Rendimiento

Simulación: ~1 ms/tick con 10 bots (ver TEST_REPORT.md). Cliente: geometría estática fusionada
(≈12 draw calls de mapa), instancias de materiales compartidas, pooling de efectos, limpieza
completa al volver al menú (verificada con 3 partidas consecutivas).
