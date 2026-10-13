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
- Ajuste opcional «Modelos oficiales» (desactivado por defecto): carga `.glb` de
  `pokemon-party/3d-pokemon` (Draco + WebP + esqueleto; `apps/client/src/officialModels.ts`).
  Prioridad: descarga local (`npm run modelos:oficiales`, queda en `.gitignore`) y, si falta,
  carga remota en el navegador directamente desde el repositorio de origen (funciona también
  en el despliegue). Este proyecto **no aloja ni redistribuye** esos archivos: son propiedad
  de Nintendo/Creatures/GAME FREAK (ASSET_SOURCES.md). Descodificador Draco copiado de
  `three` (npm) en `predev`/`prebuild` (`tools/copiar-draco.mjs`).
- Sin descarga local ni conexión, el ajuste no hace nada y se usan los modelos propios.
- Animación de los oficiales: clips del archivo cuando existen (Bulbasaur: idle/run/fight;
  Pikachu: «Impactrueno» congelado como pose y disparado al atacar); si no hay clips
  (Charmander, Squirtle), ciclo de andar y gesto de ataque procedurales sobre los huesos
  (`LThigh`/`RArm`/`Head`/`Jaw`/`Tail…`), con correcciones de pose de reposo por personaje
  (Charmander venía en T con una pierna alzada y la cola arrastrando).

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

## Mewtwo y evolución en partida (2026-10-13)

- Quinto personaje jugable: Mewtwo (Confusión/Psicorrayo/Psíquico, habilidad *Premonición*:
  revela enemigos en 10 m a través de paredes durante 3 s vía marcadores/minimapa). Sin
  evolución. Modelo procedural propio y oficial (dex 150).
- Sistema de evolución en la sim compartida (`EVO_*` en constants.ts): puntos por bajas,
  asistencias y objetivo; umbrales 80/180; al evolucionar +15 PS máx. con cura, recarga un
  12 % más rápida por etapa y habilidad recargada. Persiste entre rondas; cambiar de
  personaje la reinicia. Snapshot: `evoStage` público, `evoPoints` propio/aliados.
- Cliente: variantes procedurales por etapa (Raichu, Charmeleon/Charizard con alas,
  Wartortle/Blastoise con cañones, Ivysaur/Venusaur con flor) y modelos oficiales por etapa
  con carga perezosa (dex 2,3,5,6,8,9,26). HUD con progreso («Evolución 40/80»), aviso
  central y sintonía al evolucionar; el modelo se reconstruye al cambiar de etapa.
  `?etapa=1|2` previsualiza evoluciones en el selector (depuración).
- Pruebas: `packages/shared/test/evolution.test.ts` (umbrales, PS por etapa, persistencia,
  Premonición, reinicio al cambiar de personaje); 51 en total.

## Efectos elementales de los ataques (2026-10-14)

- Nuevo `apps/client/src/attackFx.ts`: el trazo cilíndrico se sustituye por efectos con
  identidad elemental (solo presentación; el daño sigue siendo hitscan): rayo en zigzag con
  ramas y parpadeo (Pikachu), cono de llamas que crece y asciende (Charmander), chorro de
  agua con gotas —y burbujas en la ráfaga— (Squirtle), hojas giratorias y haz dorado en Rayo
  Solar (Bulbasaur), anillos psíquicos en expansión (Mewtwo). El perfil modula tamaño,
  intensidad y duración (preciso > pulso > ráfaga).
- Geometrías compartidas, materiales aditivos por efecto, tope de 48 efectos simultáneos;
  con «movimiento reducido» se mantiene el trazo sencillo y más corto de antes.

## Pendiente conocido (documentado en TEST_REPORT.md)

- Inspección jugable con ratón físico (sensación de apuntado) y escucha manual del audio.
- Verificación en Firefox/Safari y en redes WAN reales.
