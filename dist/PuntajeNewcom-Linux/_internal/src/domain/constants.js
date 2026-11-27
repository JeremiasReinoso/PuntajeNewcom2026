/**
 * Constantes del dominio de PuntajeNewcom.
 *
 * Capa: domain (sin dependencias de DOM, almacenamiento ni frameworks).
 * Todos los valores persistidos (claves de etapas, estados y modalidades) son
 * parte del esquema guardado en localStorage: NO renombrarlos sin migración.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PuntajeNewcomModules = root.PuntajeNewcomModules || {};
    root.PuntajeNewcomModules.constants = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /** Etapas persistidas en `category.currentStage`, `team.stage` y `match.stage`. */
  const STAGES = Object.freeze({
    GENERAL: 'GENERAL', // Fase clasificatoria / Fase de grupos (Día 1 / Días 1-2).
    ZONE_FINAL: 'ZONE_FINAL', // Segunda fase (Zona final / Zonas 1-3 / Zonas 1-6 / Zona única).
    PLAYOFFS: 'PLAYOFFS', // Cruces finales (Semifinales, Final y puestos).
    FINISHED: 'FINISHED'
  });

  const STAGE_LABELS = Object.freeze({
    GENERAL: 'Fase de grupos',
    ZONE_FINAL: 'Segunda fase',
    PLAYOFFS: 'Cruces finales',
    FINISHED: 'Finalizado'
  });

  /** Fase de cada zona. */
  const ZONE_PHASES = Object.freeze({
    QUALIFYING: 'clasificatoria',
    FINAL: 'final',
    CHAMPIONSHIP: 'campeonato',
    STIMULUS: 'estimulo',
    PLACEMENT: 'posicion'
  });

  const STATUS = Object.freeze({
    ACTIVE: 'ACTIVE',
    QUALIFIED: 'QUALIFIED',
    ELIMINATED: 'ELIMINATED',
    CHAMPION: 'CHAMPION',
    RUNNER_UP: 'RUNNER_UP'
  });

  const STATUS_LABELS = Object.freeze({
    ACTIVE: 'Activo',
    QUALIFIED: 'Clasificado',
    ELIMINATED: 'Eliminado',
    CHAMPION: 'Campeón',
    RUNNER_UP: 'Subcampeón'
  });

  const ZONE_STATUS = Object.freeze({
    CONFIGURING: 'CONFIGURING',
    IN_PROGRESS: 'IN_PROGRESS',
    PENDING_CLOSE: 'PENDING_CLOSE',
    FINISHED: 'FINISHED'
  });

  const ZONE_STATUS_LABELS = Object.freeze({
    CONFIGURING: 'En configuración',
    IN_PROGRESS: 'En curso',
    PENDING_CLOSE: 'Pendiente de cierre',
    FINISHED: 'Finalizada'
  });

  /**
   * Modalidades de competición.
   * - ZONES_AND_FINAL / ZONES: Zonas clasificatorias → 2 clasificados por zona → Zona final (+40 / genérico).
   * - ROUND_ROBIN / SINGLE_ZONE: Todos contra todos en una única zona (genérico).
   * - TORNEO_50: +50 (14 eq.): 4 zonas (A=4, B=4, C=3+Interz, D=3+Interz) → Z1, Z2, Z3 → Cruces Día 3.
   * - TORNEO_60: +60 (18 eq.): 3 zonas (A=6, B=6, C=6) → Z1..Z6 (triangulares) → Cruces Día 3.
   * - TORNEO_68: +68 (7 eq.): Zona Única (7) → Semifinales (1v4, 2v3), Final, 3°/4° y 5°-7° directo.
   */
  const FORMATS = Object.freeze({
    ZONES_AND_FINAL: 'zonas_y_final',
    ROUND_ROBIN: 'todos_contra_todos',
    TORNEO_50: 'torneo_50',
    TORNEO_60: 'torneo_60',
    TORNEO_68: 'torneo_68',
    ZONES: 'zonas_y_final',
    SINGLE_ZONE: 'todos_contra_todos'
  });

  const FORMAT_LABELS = Object.freeze({
    zonas_y_final: 'Zonas clasificatorias + Zona final (+40 / Genérico)',
    todos_contra_todos: 'Todos contra todos (zona única)',
    torneo_50: 'Categoría +50 · 14 equipos (4 zonas + Interzonal C-D + Cruces)',
    torneo_60: 'Categoría +60 · 18 equipos (3 zonas de 6 + Triangulares + Cruces)',
    torneo_68: 'Categoría +68 · 7 equipos (Zona única + Semifinales y Final)'
  });

  const MATCH_TYPES = Object.freeze({
    ZONE: 'ZONE',
    INTERZONAL: 'INTERZONAL',
    PLAYOFF: 'PLAYOFF'
  });

  const DEFAULT_TEAMS_68 = Object.freeze([
    'Los Nahuel',
    'Águilas Doradas',
    'Toninas',
    'Unidos por el Newcom',
    'Newen',
    'Abrojal',
    'Corsarios'
  ]);

  /** Estados de alto nivel que se muestran al usuario (derivados, nunca persistidos). */
  const PHASES = Object.freeze({
    CONFIGURING: 'CONFIGURING',
    FIRST_STAGE_IN_PROGRESS: 'FIRST_STAGE_IN_PROGRESS',
    QUALIFICATION_PENDING: 'QUALIFICATION_PENDING',
    QUALIFIED: 'QUALIFIED',
    SINGLE_ZONE_IN_PROGRESS: 'SINGLE_ZONE_IN_PROGRESS',
    FINAL_AVAILABLE: 'FINAL_AVAILABLE',
    FINISHED: 'FINISHED'
  });

  const PHASE_LABELS = Object.freeze({
    CONFIGURING: 'En configuración',
    FIRST_STAGE_IN_PROGRESS: 'Fase clasificatoria en curso',
    QUALIFICATION_PENDING: 'Clasificación pendiente',
    QUALIFIED: 'Equipos clasificados',
    SINGLE_ZONE_IN_PROGRESS: 'Zona final en curso',
    FINAL_AVAILABLE: 'Tabla final disponible',
    FINISHED: 'Finalizado'
  });

  /** Cantidad de clasificados por zona inicial hacia la zona final. */
  const QUALIFIERS_PER_ZONE = 2;

  /** Nombre por defecto de la zona única / zona final. */
  const SINGLE_ZONE_NAME = 'Zona única';
  const SECOND_STAGE_ZONE_NAME = 'Zona final';

  /** Las categorías +60 y +68 usan la modalidad todos contra todos. */
  const SINGLE_ZONE_CATEGORY_PATTERN = /\+\s*(?:60|68)(?!\d)/;

  /** Motivo de archivo de un resultado de zona final cuando cambian los clasificados. */
  const ARCHIVE_REASONS = Object.freeze({ QUALIFICATION_CHANGE: 'QUALIFICATION_CHANGE' });

  /** Versión del esquema persistido. Incrementar sólo junto con una migración. */
  const SCHEMA_VERSION = 2;
  const STORAGE_KEY = 'puntaje-newcom-state';

  return Object.freeze({
    STAGES,
    STAGE_LABELS,
    ZONE_PHASES,
    STATUS,
    STATUS_LABELS,
    ZONE_STATUS,
    ZONE_STATUS_LABELS,
    FORMATS,
    FORMAT_LABELS,
    PHASES,
    PHASE_LABELS,
    QUALIFIERS_PER_ZONE,
    SINGLE_ZONE_NAME,
    SECOND_STAGE_ZONE_NAME,
    SINGLE_ZONE_CATEGORY_PATTERN,
    ARCHIVE_REASONS,
    MATCH_TYPES,
    DEFAULT_TEAMS_68,
    SCHEMA_VERSION,
    STORAGE_KEY
  });
}));
