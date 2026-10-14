# ASSET_SOURCES — origen de todos los recursos

## Búsqueda de modelos existentes (sección 9 del documento de diseño)

Fecha de acceso: 2026-10-08. Búsqueda real realizada contra la API pública de Sketchfab
(`api.sketchfab.com/v3/search?type=models&downloadable=true`). Candidatos inspeccionados
(título | autor declarado | licencia declarada | ficha):

- Pikachu | HarrisonHag1 | CC Attribution | https://sketchfab.com/3d-models/none-273766237c614ab1bbaf094c9fc72a3e
- Pikachu | Raghav Gupta | CC Attribution | https://sketchfab.com/3d-models/none-37c740f674cd4719a1d1d2970bbe8c30
- Charmander | luluning | CC Attribution | https://sketchfab.com/3d-models/none-f243d57b2d52477982014722d23d13c0
- Charmander (Pokemon) | Patrickart.hk | CC BY-NC-ND | https://sketchfab.com/3d-models/none-8a096cdfc20b4d3099ddedafc7ff107a
- Pokemon - Charmander | Katerina Novakova | CC BY-SA | https://sketchfab.com/3d-models/none-1f18443b6a7a41b38a9be521731040a6
- SquirtlE | LeafChan | CC Attribution | https://sketchfab.com/3d-models/none-42ddca11ab584aa18c74ae550823f276
- 007 Squirtle | A-Z inc. | CC Attribution | https://sketchfab.com/3d-models/none-102ca3237aac44a6b5b15d6e3fbdc1df
- Bulbasaur | fongoose | CC BY-NC | https://sketchfab.com/3d-models/none-64815cda802746b8b1be2e2246db4b35
- Bulbasaur - Pokemon | thanhtp | CC Attribution | https://sketchfab.com/3d-models/none-853e861e891047c0883860db627adb35

**Decisión: no usar ninguno.** Motivos:
1. La descarga desde Sketchfab exige una cuenta autenticada (OAuth); este proyecto se
   construyó sin crear cuentas ni contratar servicios.
2. No es posible verificar la procedencia de los archivos sin descargarlos; una parte de los
   modelos de personajes de videojuegos subidos a estos catálogos son extracciones de juegos
   comerciales, cuyo uso está prohibido por este proyecto.
3. Una etiqueta CC del archivo no acredita derechos sobre el personaje: Pokémon y sus
   criaturas son marcas y diseños de The Pokémon Company / Nintendo / Game Freak / Creatures Inc.
   Esta limitación se mantiene también para los modelos propios (ver aviso final).

## Recursos incluidos en el juego (todos generados localmente)

| Recurso | Archivo | Origen | Licencia del archivo |
| --- | --- | --- | --- |
| Modelos 3D de Pikachu, Charmander, Squirtle y Bulbasaur | `apps/client/src/models.ts` (jerarquías procedurales Three.js, por partes, animadas por código) | Generados localmente para este proyecto | Mismo que el código del proyecto |
| Mapas «Estación Aurora», «Bosque Verde» y «Pueblo Paleta» (geometría, puertas, zonas) | `packages/shared/src/map.ts`, `packages/shared/src/mapas.ts` | Diseño propio; Bosque Verde y Pueblo Paleta son recreaciones de los escenarios de los juegos hechas desde cero (sin datos ni gráficos extraídos) | — |
| Textura de hormigón (reserva) | `apps/client/src/renderer.ts` (`concreteTexture()`, canvas procedural) | Generada localmente | — |
| Texturas del mapa (suelo, muros, cajas, madera, chapa, metal) | `apps/client/public/texturas/*.jpg` | ambientCG (ver sección «Texturas del mapa») | CC0 1.0 (dominio público) |
| Letreros/sprites de texto (A/B, nombres) | `apps/client/src/renderer.ts` (canvas) | Generados localmente | — |
| Ambientación Pokémon: murales «mapa de la región», letreros de ruta, pokéball de las zonas, hierba alta | `apps/client/src/renderer.ts` (`buildPokemonTheming()`, canvas procedural) | Dibujados localmente, inspirados en los juegos (sin extraer gráficos; ver aviso final) | — |
| Todos los sonidos (disparos, pasos, recarga, habilidades, núcleo, música de menú) | `apps/client/src/audio.ts` (síntesis WebAudio en tiempo real: osciladores + ruido) | Sintetizados localmente, sin muestras externas | — |
| Interfaz (HTML/CSS) | `apps/client/src/styles.css` | Propia | — |

No se descargó, extrajo ni incluyó ningún archivo de audio, modelo, textura o interfaz de
terceros ni de juegos comerciales. No hay dependencias de CDN en tiempo de ejecución
(única excepción, opcional y desactivada por defecto: ver «Modelos oficiales opcionales»).

## Texturas del mapa (CC0, incluidas en el repositorio)

Añadido el 2026-10-14. Las superficies del mapa usan texturas fotográficas de
**ambientCG** (https://ambientcg.com), cuyo catálogo completo se publica bajo
**Creative Commons CC0 1.0** (dominio público): se permite usar, modificar y
redistribuir sin atribución, también con fines comerciales. Por eso, a diferencia
de los modelos oficiales, estos archivos **sí** están en el repositorio
(`apps/client/public/texturas/`) y en el despliegue.

Descarga reproducible con `npm run texturas` (`tools/descargar-texturas.mjs`),
que baja los zips 1K-JPG, conserva los mapas de color y de normales (estos
reducidos a 512 px) y los renombra:

| Archivo local | Asset de ambientCG | Uso en el mapa |
| --- | --- | --- |
| `hormigon-suelo_*` | Concrete034 | suelo y rampas |
| `yeso-muro_*` | Plaster001 | muros, muros bajos y pilares |
| `placas-metal_*` | CorrugatedSteel005 | cajas altas (coberturas) |
| `madera_*` | Planks037A | cajas bajas y jardineras |
| `chapa-metal_*` | DiamondPlate008C | pasarela central |
| `metal-oxidado_*` | Metal009 | tuberías |
| `cesped_*` | Grass004 | suelo de Bosque Verde y Pueblo Paleta |

Si los archivos faltan (p. ej. clon sin ellos y sin ejecutar el script), el juego
sigue funcionando con la textura procedural de hormigón y los colores planos.

## Modelos oficiales opcionales (no incluidos ni distribuidos)

Añadido el 2026-10-12. El juego tiene un ajuste «Modelos oficiales», **desactivado por
defecto**, que carga modelos `.glb` desde `apps/client/public/modelos-oficiales/` si el
usuario los ha descargado en su copia con `npm run modelos:oficiales`
(`tools/descargar-modelos-oficiales.mjs`).

- Origen de la descarga: repositorio público `pokemon-party/3d-pokemon` (GitHub), archivos
  `models/opt/regular/{1,4,7,25}.glb` (Bulbasaur, Charmander, Squirtle, Pikachu). Ese
  repositorio declara: «All 3D assets are property of Nintendo/Creatures Inc./GAME FREAK
  inc.»; son con casi total certeza extracciones de los juegos oficiales optimizadas
  (Draco + WebP). Su licencia MIT cubre solo el código del pipeline, no los modelos.
- Por ese motivo los `.glb` **no están en este repositorio** (están en `.gitignore`), no se
  incluyen en el zip **ni se alojan en el despliegue** (Railway). Se pidió subirlos al
  despliegue con un aviso de propiedad; se descartó: un aviso no otorga licencia y alojarlos
  sería redistribución directa de archivos con copyright de Nintendo.
- Con el ajuste activado y sin descarga local, el cliente los carga **en tiempo de ejecución
  directamente del repositorio de origen** (`raw.githubusercontent.com/pokemon-party/3d-pokemon`,
  que sirve con `Access-Control-Allow-Origin: *`): este proyecto no almacena ni sirve esos
  archivos; la fuente es el repositorio de terceros. Es la única carga remota del juego y
  solo ocurre si el usuario activa el ajuste (desactivado por defecto).
- El descodificador Draco necesario se copia desde el paquete npm de `three`
  (`examples/jsm/libs/draco/gltf/`, redistribuible) a `apps/client/public/draco/` en
  `predev`/`prebuild` (`tools/copiar-draco.mjs`), así que sí está en el despliegue.
- Sin descarga local y sin conexión a la fuente, el ajuste no tiene efecto y se usan los
  modelos procedurales propios (`apps/client/src/models.ts`), que siguen siendo los
  predeterminados.

## Aviso de propiedad intelectual

Este es un fan game no oficial, sin ánimo de lucro y sin monetización. Los nombres y diseños
de los personajes Pokémon son propiedad de sus titulares (The Pokémon Company, Nintendo,
Game Freak, Creatures Inc.). La creación local de modelos propios inspirados en esos
personajes no elimina los derechos sobre los personajes; el proyecto no debe presentarse
como oficial ni distribuirse comercialmente.
