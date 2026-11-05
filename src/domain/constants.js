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
    GENERAL: 'GENERAL', // Fase clasificatoria (zonas iniciales).
    ZONE_FINAL: 'ZONE_FINAL', // Zona final (+50/+40) o zona única (+60/+68).
    FINISHED: 'FINISHED'
  });

  const STAGE_LABELS = Object.freeze({
    GENERAL: 'Fase clasificatoria',
    ZONE_FINAL: 'Zona final',
    FINISHED: 'Finalizado'
  });

  /** Fase de cada zona (`clasificatoria` o `final`). */
  const ZONE_PHASES = Object.freeze({
    QUALIFYING: 'clasificatoria',
    FINAL: 'final'
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
   * - ZONES_AND_FINAL / ZONES: Zonas clasificatorias → 2 clasificados por zona → Zona final (+50 y +40).
   * - ROUND_ROBIN / SINGLE_ZONE: Todos contra todos en una única zona (+60/+68).
   */
  const FORMATS = Object.freeze({
    ZONES_AND_FINAL: 'zonas_y_final',
    ROUND_ROBIN: 'todos_contra_todos',
    ZONES: 'zonas_y_final',
    SINGLE_ZONE: 'todos_contra_todos'
  });

  const FORMAT_LABELS = Object.freeze({
    zonas_y_final: 'Zonas clasificatorias + Zona final',
    todos_contra_todos: 'Todos contra todos (zona única)'
  });

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
    SCHEMA_VERSION,
    STORAGE_KEY
  });
}));
