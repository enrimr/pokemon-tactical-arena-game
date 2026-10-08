# Diseño — Estación Aurora y reglas

## Mapa

Estación de investigación Pokémon abandonada pero luminosa: hormigón claro, paneles azul
oscuro, jardineras y vegetación contenida en el invernadero (lado B), tuberías y cajas
tecnológicas. 64 × 48 m, sin pisos superpuestos; un único desnivel (pasarela central de 1 m
con rampas escalonadas).

```
            ┌──────────────────────── z=24 ───────────────────────┐
            │ macizo norte      [SPAWN DEFENSOR]       macizo norte│
            │ ┌─────────┐  franja W ─ puertas ─ franja E ┌───────┐ │
            │ │ PLAZA A │◄──────────┐  bloque  ┌────────►│PLAZA B│ │
            │ │  (A)    │ conector S│ interior │conector S│  (B) │ │
            │ └────▲────┘ (en S)    └────┬─────┘  (en S)  └──▲───┘ │
            │ pasillo W            SALA CENTRAL             pasillo│
            │   (oeste)       (pasarela 1 m + caja)         E (este)
            │      ▲                   ▲                        ▲  │
            │  antesala W ── puertas spawn atacante ── antesala E  │
            │                [SPAWN ATACANTE]                      │
            └──────────────────────── z=-24 ──────────────────────┘
```

- Tres rutas: pasillo oeste → A; centro disputado (sala central + conectores en S) con salida
  a ambas zonas; invernadero este → B. Cada zona tiene dos accesos independientes más la
  franja de rotación defensora.
- Conectores «en S» y bloque interior del spawn defensor: eliminan las líneas rectas
  este–oeste y spawn–spawn (verificado por prueba automática).
- ~24 coberturas (cajas 0,6/1,2 m, pilares, jardineras); zonas con cobertura sólida para
  instalar y espacio de retoma.
- Mediciones sobre la rejilla de navegación (prueba `map.test.ts`): defensores → zona 4,3–5,1 s;
  atacantes → zona 8,2–10,9 s; rotación A–B ≈ 10,9 s; línea de visión máxima ≈ 36,8 m;
  sin línea spawn–spawn; puertas ≥1,8 m (2–3 m).

## Decisiones de ambigüedad (documentadas al elegirlas)

1. **Protocolo JSON sobre WS**: legible y fácil de validar; el ancho de banda a 20 Hz con ≤10
   jugadores es pequeño. Binario habría sido optimización prematura.
2. **Equipamiento al morir**: «morir elimina mejoras» se aplica a arma, escudo, kit y cargas
   no usadas; sobrevivir conserva todo (incl. consumibles, máx. 1 por tipo). Es la lectura
   más coherente con «consumibles no gastados se conservan» (condicionado a sobrevivir).
3. **Primer equipo atacante**: Azul ataca la 1.ª mitad.
4. **Elección de personaje repetible**, también entre bots.
5. **Reutilización de la última entrada** ante pérdida de paquetes: máximo 0,25 s; después el
   jugador se detiene (evita «correr solo» con lag).
6. **Zona utilitaria sobre un muro**: el proyectil se asienta en la primera superficie válida
   bajo el impacto; si cae sobre un tejado, la línea de efecto limita su influencia.
7. **Visibilidad de enemigos para humanos**: oclusión por geometría + niebla (sin FOV en el
   filtro del servidor, porque la pantalla del cliente define el FOV real).
8. **Entrenamiento**: compra y cambio de personaje libres en cualquier momento, rondas de
   30 min, reapariciones a los 2,5 s, y el humano puede tanto instalar como desactivar el
   núcleo de práctica (roles relajados solo ahí).

## Bots

- Percepción: FOV 110°, 35 m, oclusión real (raycast) y niebla; memoria de 3 s; audición
  (correr 12 m, saltar 10 m, disparar 25 m, posición aproximada redondeada a 2 m).
- Dificultades: fácil 450 ms/4°; normal 280 ms/2°; difícil 180 ms/1°; giro limitado (360°/s),
  error angular sembrado y refrescado; nunca apuntado instantáneo.
- Roles atacantes: portador + escoltas por la ruta del sitio elegido (elección determinista
  por semilla y ronda) y flanqueadores por el centro; recuperación del núcleo por los dos más
  cercanos. Defensores: 2×A, 2×B, 1 centro, con puestos y vigilancia de accesos; tras la
  instalación priorizan retoma/desactivación (un desactivador, resto cubre).
- Compras con contexto (perfil → escudo → kit → habilidad → granada, con variación sembrada);
  utilidades al entrar al sitio (atacantes) o sobre el enemigo percibido (defensores).
