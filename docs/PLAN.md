# Plan de ejecución — Pokémon Tactical Arena

Entorno detectado: macOS (darwin 25.2), Node v20.19.2, npm 10.8.2, sin Blender → los modelos 3D se crean proceduralmente en código (jerarquías Three.js con materiales propios), tal como contempla la sección 9 del documento maestro.

## Fases (orden obligatorio §14)

1. **Andamiaje** — monorepo npm workspaces: `apps/client` (Vite + Three.js), `apps/server` (Node + ws), `packages/shared` (simulación determinista compartida). Scripts raíz: dev/build/start/test/typecheck/lint.
2. **Núcleo jugable** — movimiento con cápsula (0,35 r × 1,5 h), colisiones contra geometría estática compartida (AABB + rampas), cámara FPS, combate hitscan mínimo en blockout.
3. **Reglas** — fases de ronda (20 s prep / 100 s activa / 6 s resolución), núcleo energético (instalar 3 s / desactivar 7 s ó 4 s con kit / cuenta atrás 35 s), economía completa, mitades de 6 rondas, desempates por timestamp de simulación.
4. **Bots** — grid de navegación + A*, percepción (FOV 110°, 35 m, oclusión, audición), máquina de estados con roles, 3 dificultades; partida en solitario completa dentro de un Web Worker.
5. **Modelos** — búsqueda breve documentada; creación procedural de los 4 Pokémon con rasgos obligatorios y animaciones (reposo, andar, ataque, recarga, habilidad, debilitamiento).
6. **Mapa + UI + audio** — «Estación Aurora» 64×48 m con 3 rutas, HUD completo, menús en español, audio sintetizado espacial, campo de entrenamiento.
7. **Multijugador** — salas con código de 6 caracteres, servidor autoritativo, predicción/reconciliación, interpolación 100 ms, lag comp ≤150 ms, bots de relevo, reconexión 60 s.
8. **Validación** — pruebas unitarias/integración, TEST_REPORT.md, ZIP reproducible.

## Decisiones fijadas (ambigüedades resueltas por sencillez)

- Protocolo de red: JSON sobre WebSocket (claridad y validación de esquema sencilla; el ancho de banda a 20 Hz con ≤10 jugadores es asumible).
- Colisiones estáticas: cajas alineadas a ejes (AABB) + rampas de eje X/Z descritas en `packages/shared/src/map.ts`; cliente y servidor usan la misma descripción.
- Navegación de bots: rejilla de 0,5 m generada desde la descripción del mapa + A*; suficiente para un mapa de 64×48 m.
- Modelos: jerarquías procedurales de primitivas suavizadas (esferas/cápsulas/conos escalados) con animación por código. Sin Blender en el sistema.
- Audio: sintetizado por WebAudio en tiempo real (osciladores + ruido), sin archivos externos.
- Aleatoriedad: mulberry32 sembrado por simulación.
