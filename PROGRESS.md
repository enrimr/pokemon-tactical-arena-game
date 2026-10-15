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

## Pokéballs aleatorias con premios (2026-10-14)

- Nueva entidad `PickupState` en la sim compartida: cada ronda aparecen `POKEBALL_COUNT` (4)
  pokéballs en puntos aleatorios (RNG determinista de la sim) de los 11 candidatos neutrales
  de `map.pokeballSpots`. Recogida automática al pisarlas (ambos equipos, también bots);
  reaparecen en cada ronda.
- Premio aleatorio al abrirlas (`openPokeball`): energía de evolución (+30), cura (+40 PS
  hasta el máximo), MT (aprende el siguiente ataque: pulso→ráfaga→preciso, cargador lleno) o
  MO (recarga la habilidad; si ya la tiene, la granada). Premios sin efecto degeneran en
  +300 créditos (tope de economía respetado). Evento `pokeball` filtrado al equipo del
  recolector.
- Cliente: modelo de pokéball (clonado de una plantilla, halo radial, flotación y giro),
  destello al recogerla, puntos en el minimapa, aviso central con el premio y campanilla
  (`audio.pokeball`) para el propio jugador; línea en el registro para los aliados.
- Pruebas: `packages/shared/test/pokeball.test.ts` (14): validez de los puntos (fuera de
  spawns, transitables, fuera de sólidos), determinismo por semilla, recogida solo en ronda
  activa, reaparición por ronda y cada tipo de premio con sus degeneraciones; 65 en total.

## Ataque explosivo de área (2026-10-14)

- Cuarto perfil de arma `explosivo` («Carga explosiva», 2600 cr): proyectil rápido
  (22 m/s, con gravedad) que detona al impactar contra el mapa o un enemigo, o al agotar
  el alcance (50 m). Daño en área: 65 en el centro con atenuación lineal hasta el 25 % en
  el borde (radio 3,2 m); la onda respeta la línea de efecto (las paredes bloquean) y no
  afecta a aliados ni al lanzador. Nombres por personaje: Bola Voltio, Estallido,
  Hidropulso, Bomba Germen, Esfera Aural.
- Sim: `fireExplosive`/`detonateExplosive` en sim.ts, tipo de proyectil `explosivo`,
  evento `explosionFx` (solo presentación). Compra en `buy()`/menú B; los bots la compran
  a veces (20 % con créditos de sobra). Indicador de perfil: racimo de cargas.
- Cliente: proyectil como orbe luminoso, detonación con destello, onda elemental del color
  del personaje, anillo en el suelo y chispas (`createExplosionFx`); sonido grave de
  lanzamiento + explosión existente. Sin trazo hitscan (ni local ni de red).
- Pruebas: `packages/shared/test/explosive.test.ts` (6): compra, proyectil sin trazo,
  atenuación por distancia, aliados ilesos, radio máximo, paredes que bloquean y
  detonación por impacto directo; 71 en total.

## Capturas y vídeos con modelos oficiales (2026-10-14)

- `tools/browser_check.mjs` y `tools/browser_training.mjs` activan «Modelos oficiales»
  (localStorage `pta-ajustes-v1`) antes de cargar: todas las capturas usan los modelos
  reales descargados en local. Demo del explosivo con vídeo:
  `docs/videos/ataque-explosivo.webm` (19 s) y capturas `docs/capturas/explosivo-*.png`.

## Ambientación del mundo Pokémon (2026-10-14)

- `buildPokemonTheming()` en renderer.ts: texturas canvas generadas localmente (nada
  extraído de los juegos, ver ASSET_SOURCES.md) inspiradas en ciudades, mapas y rutas:
  - Murales «MAPA DE LA REGIÓN» estilo Mapa del Pueblo (ciudades de Kanto en castellano
    unidas por rutas, con la Estación Aurora marcada con ★) en los muros de ambos spawns
    y de las plazas A/B.
  - Letreros de madera tipo poste de ruta: «← RUTA A» / «RUTA B →» en las antesalas y
    «ZONA A/B» junto a los conectores (sin colisión). Sustituyen a los sprites ◀A/B▶.
  - Marca de pokéball pintada en el suelo de las zonas A y B, bajo el anillo.
  - Hierba alta (planos cruzados con textura de hojas, fusionados en una malla) en el
    invernadero, jardineras, bordes de pasillos y antesalas.
- Capturas: `docs/capturas/tema-*.png`. De paso, corregido un fallo del aviso de pokéball
  (premio MO evaluaba `WEAPONS[detalle]` con detalle no-arma → error de consola).

## Dos mapas nuevos: Bosque Verde y Pueblo Paleta (2026-10-14)

- Infraestructura multi-mapa: `MapId`, registro `MAP_INFO`/`buildMapById` en
  `packages/shared/src/mapas.ts`; el mapa viaja en el protocolo (`crear`, `LobbyState`,
  `inicio`) y en `WorkerConfig`. Selector de mapa en solo/entrenamiento y al crear sala;
  el lobby muestra el mapa elegido. La ambientación (cielo/niebla, murales, letreros,
  hierba, arbustos, árboles) y los muñecos de entrenamiento ahora son datos del mapa
  (`MapDef.theming`, `dummySpots`); el renderer es genérico. Tags nuevos: seto (follaje
  procedural), tronco, agua (translúcida, decor), casa, tejado, valla. Suelo de césped
  (Grass004, CC0) en los mapas verdes.
- **Bosque Verde**: recreación del bosque de los juegos: caseta de entrada al sureste,
  sendero por el borde sur, pasillos en zigzag entre hileras impenetrables de árboles con
  copas, gran campo central de hierba alta con tocones, y claros oeste (A) y este (B) ante
  la caseta de salida norte.
- **Pueblo Paleta**: recreación del pueblo: casas del jugador y del rival con tejado rojo,
  salida a la Ruta 1 entre ambas (spawn defensor, con su hierba alta), Laboratorio Pokémon
  al sureste (zona B), plaza del cartel «PUEBLO PALETA» (zona A), vallas, y el mar de la
  Ruta 21 al suroeste con muelle (agua cercada, los atacantes desembarcan en la playa).
- Pruebas (`packages/shared/test/mapas.test.ts`, 17): por mapa, spawns transitables y en
  zona, caminos a A/B desde ambos spawns, ventaja defensora, sin visión entre spawns,
  puertas que sellan en preparación, pokéballs/muñecos/letreros válidos; y una partida
  5v5 completa de bots en cada mapa nuevo (combate, objetivo, nadie sale del mapa);
  86 en total.

## Modo móvil pulido, giroscopio y auras de equipo (2026-10-15)

- Disposición táctil revisada con medición automática de solapes
  (`tools/_movil_check.mjs`, viewports 667×375/844×390/1024×768): las píldoras
  superiores pasan a una fila flexible de iconos (🧭 ▤ 🛒 ☰) que no puede montarse,
  el racimo de botones se compacta en arco junto al disparo (nada por encima de
  ~260 px), la munición pasa abajo a la izquierda y en anchos de teléfono se oculta
  la etiqueta de ronda. Antes: salto pisaba «Marcador» y la munición quedaba bajo
  el botón de soltar en el centro.
- Apuntado con giroscopio (opcional): píldora 🧭 en táctil y ajuste persistente.
  `devicemotion.rotationRate` integrado 1:1 en radianes (`input.applyLookRad`, sin
  sensibilidad ni inversión), mapeado según la orientación de pantalla y sumado al
  arrastre. Permiso de iOS gestionado (Chromium contesta 'prompt': solo bloquea
  'denied'). Verificado con eventos sintéticos (Δyaw exacto al esperado).
- Aura de color de equipo bajo cada Pokémon: anillo azul/naranja en los pies +
  halo radial con latido suave, clonado de una plantilla por equipo. Identifica
  el bando con modelos propios y oficiales desde cualquier ángulo.

## Aura DBZ, espectador orbital, PWA y pantallas móviles (2026-10-15)

- Aura de equipo ampliada a llamarada vertical estilo Dragon Ball: cilindro abierto
  con lenguas de energía (canvas, aditivo) que gira y respira, sobre el anillo y el
  halo existentes; materiales compartidos por equipo con latido.
- Espectador: cámara orbital en 3ª persona alrededor del aliado seguido (giro con
  ratón/arrastre, sin atravesar paredes) con alternancia a 1ª persona (clic derecho
  o salto); clic izquierdo sigue cambiando de aliado.
- PWA instalable: manifest.webmanifest, iconos pokéball generados localmente
  (`tools/generar-iconos.mjs`), service worker red-primero con reserva en caché
  (`public/sw.js`, no intercepta el WebSocket) y metadatos iOS. Tipos MIME nuevos
  en el servidor (.webmanifest, .jpg, .glb, .wasm…).
- Pantallas sin cortes en móvil: `.screen` con `overflow-y: auto` y centrado
  `safe center` (con respaldo), paneles con desplazamiento y safe-areas de la
  muesca. Verificado programáticamente (sin desbordes, inicio visible, scroll
  llega al final) en 667×375.
- Animaciones de ataque de los modelos oficiales mejoradas tras inventariar los
  clips de los .glb (`tools/_glb_clips.mjs`): Mewtwo usa `battlewait` como postura
  de combate y dispara con `rangeattack01`, rotando entre los ataques disponibles
  (attack01/attack02; fight_b/fight_d en Bulbasaur); Pikachu ya disparaba
  «Impactrueno». Charmander/Squirtle y evoluciones sin clips siguen con los
  gestos procedurales.

## Ajustes compactos en móvil y cuatro luchadores de Pokkén (2026-10-15)

- Móvil: un solo contexto de scroll en las pantallas (el panel ya no se limita a
  92vh), ajustes compactados (filas y controles menores, nota pequeña) y a dos
  columnas en apaisado; las teclas reasignables se ocultan en táctil
  (`.solo-teclado`). Auditoría automática (`tools/_audit_movil.mjs`): menú,
  ajustes, selección, crear/unirse, créditos, compra y pausa sin desbordes y con
  scroll completo en 667×375.
- Centrado de los modelos oficiales por el hueso de la cadera (antes el centro de
  la caja: Mewtwo quedaba adelantado sobre su anillo por la cola).
- Cuatro personajes nuevos del plantel de Pokkén Tournament: **Gengar** (Niebla
  Sombría), **Gardevoir** (Premonición), **Lucario** (Destello de Aura) y
  **Garchomp** (Bramido Dragón), con nombres de ataque canónicos por perfil,
  modelos procedurales propios, modelos oficiales (dex 94/282/448/445, con
  corrección de pose T en Gardevoir y Lucario), colores, sonidos y efectos
  elementales afines. Sin cadena evolutiva (formas finales, como en Pokkén).

## Pendiente conocido (documentado en TEST_REPORT.md)

- Inspección jugable con ratón físico (sensación de apuntado) y escucha manual del audio.
- Verificación en Firefox/Safari y en redes WAN reales.
