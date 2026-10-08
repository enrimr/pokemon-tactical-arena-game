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
| Mapa «Estación Aurora» (geometría, puertas, zonas) | `packages/shared/src/map.ts` | Diseño original propio | — |
| Textura de hormigón | `apps/client/src/renderer.ts` (`concreteTexture()`, canvas procedural) | Generada localmente | — |
| Letreros/sprites de texto (A/B, nombres) | `apps/client/src/renderer.ts` (canvas) | Generados localmente | — |
| Todos los sonidos (disparos, pasos, recarga, habilidades, núcleo, música de menú) | `apps/client/src/audio.ts` (síntesis WebAudio en tiempo real: osciladores + ruido) | Sintetizados localmente, sin muestras externas | — |
| Interfaz (HTML/CSS) | `apps/client/src/styles.css` | Propia | — |

No se descargó, extrajo ni incluyó ningún archivo de audio, modelo, textura o interfaz de
terceros ni de juegos comerciales. No hay dependencias de CDN en tiempo de ejecución.

## Aviso de propiedad intelectual

Este es un fan game no oficial, sin ánimo de lucro y sin monetización. Los nombres y diseños
de los personajes Pokémon son propiedad de sus titulares (The Pokémon Company, Nintendo,
Game Freak, Creatures Inc.). La creación local de modelos propios inspirados en esos
personajes no elimina los derechos sobre los personajes; el proyecto no debe presentarse
como oficial ni distribuirse comercialmente.
