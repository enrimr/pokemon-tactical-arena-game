# PROGRESS

Estado: **entrega completa y verificada** (2026-10-08). Comandos: `npm install`,
`npm run dev` / `npm run build && npm start`, `npm test`, `npm run typecheck`, `npm run lint`.

## Completado

1. ✔ Monorepo (packages/shared, apps/client, apps/server) con TS estricto, lockfile, ESLint.
2. ✔ Simulación compartida determinista a 60 Hz: movimiento/cápsula/escalón, hitscan con
   dispersión y compensación de latencia ≤150 ms, fases de ronda, núcleo (instalar 3 s /
   desactivar 7 s / kit 4 s / cuenta atrás 35 s), economía completa, escudo, utilidades de los
   4 personajes, asistencias, desempates por timestamp de simulación.
3. ✔ Mapa «Estación Aurora» validado por pruebas (tiempos, conectividad, sin línea spawn-spawn).
4. ✔ Bots: A*, percepción con oclusión/niebla/audición, roles, compras, utilidades, atasco.
5. ✔ Modelos procedurales de los 4 Pokémon con rasgos obligatorios + animaciones; búsqueda
   previa de modelos documentada en ASSET_SOURCES.md.
6. ✔ Cliente: menús es-ES, selección 3D, HUD completo, minimapa, compra, marcador, resultados,
   ajustes persistentes + controles reasignables, audio WebAudio sintetizado espacial,
   predicción/reconciliación/interpolación, espectador, pausa, overlay F3/F4.
7. ✔ Solitario y entrenamiento en Web Worker (sin servidor); multijugador con salas por código,
   bots de relleno, relevo ≤2 s, reconexión 60 s con token, entrada tardía, migración de
   anfitrión, validación y límites de frecuencia.
8. ✔ 47 pruebas automatizadas + 5 comprobaciones de navegador real (incl. 2 clientes
   simultáneos y partida completa hasta resultados). TEST_REPORT.md con limitaciones honestas.
9. ✔ README, docs (ARQUITECTURA/DISENO/CONTROLES/PLAN), ASSET_SOURCES, .env.example,
   capturas reales en docs/capturas/, ZIP reproducible (tools/package_zip.sh).

## Despliegue

- Railway (GitHub → `main`): un único servicio con `railway.json` (build completa, `npm start`,
  healthcheck `/salud`). Dominio: https://ptaserver-production.up.railway.app
- Región: europe-west4, 1 réplica (las salas viven en memoria: no escalar a varias réplicas
  sin añadir afinidad/estado compartido).
- Redespliegues sin cortar partidas: el servicio tiene `drainingSeconds=1800` y el servidor
  maneja SIGTERM (rechaza salas nuevas y espera a que acaben las partidas con humanos, con
  salida inmediata si no hay ninguna). Limitación: si un jugador pierde la conexión durante
  el drenado, su reconexión llega a la instancia nueva y no recupera la sala antigua.

## Modelos de personaje (2026-10-12)

- Modelos procedurales rehechos con más detalle (sonrisas, garras, colas orgánicas con
  `blobChain`, llama de tres capas, patrón del caparazón, bulbo con hojas en capas).
- Ajuste opcional «Modelos oficiales» (desactivado por defecto): carga `.glb` descargados
  por el usuario con `npm run modelos:oficiales` desde `pokemon-party/3d-pokemon`
  (Draco + WebP + esqueleto; ver `apps/client/src/officialModels.ts`). Los archivos quedan
  en `apps/client/public/modelos-oficiales/` (en `.gitignore`): son propiedad de
  Nintendo/Creatures/GAME FREAK y **no deben redistribuirse ni desplegarse** (ASSET_SOURCES.md).
- Sin archivos descargados el ajuste no hace nada y se usan los modelos propios.

## Soporte móvil/táctil (2026-10-12)

- Controles táctiles (`apps/client/src/touch.ts`): joystick virtual bajo el pulgar izquierdo
  (medio recorrido = caminar), arrastre para mirar con la sensibilidad de Ajustes, botones de
  acción (disparo, salto, agacharse-conmutador, recarga, habilidad, granada, usar, soltar
  núcleo contextual) y píldoras de Pausa/Compra/Marcador. Alimentan el mismo InputManager
  (bitmask BTN + movimiento analógico), sin cambios en red ni simulación.
- Detección por `pointer: coarse`; `?tactil` / `?no-tactil` para forzar en pruebas. Sin
  pointer lock en táctil: la entrada se congela mientras pausa o compra están abiertas.
- HUD reubicado en táctil y hoja de estilos adaptada a pantallas pequeñas (menús, selección
  de personaje, marcador y compra con scroll); aviso de girar el dispositivo en vertical.
- Verificado con emulación táctil de Playwright (joystick mueve, arrastre gira, compra y
  pausa abren) y re-ejecutada la comprobación de escritorio sin regresiones.

## Pendiente conocido (documentado en TEST_REPORT.md)

- Inspección jugable con ratón físico (sensación de apuntado) y escucha manual del audio.
- Verificación en Firefox/Safari y en redes WAN reales.
