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
    GENERAL: 'GENERAL', // Primera etapa (zonas iniciales).
    TOP_16: 'TOP_16', // Legado: flujo eliminatorio anterior (sólo datos existentes).
    TOP_8: 'TOP_8',
    TOP_4: 'TOP_4',
    SEMIFINAL: 'SEMIFINAL',
    FINAL: 'FINAL',
    ZONE_FINAL: 'ZONE_FINAL', // Zona única (segunda etapa o modalidad +60).
    FINISHED: 'FINISHED'
  });

  const STAGE_LABELS = Object.freeze({
    GENERAL: 'Primera etapa · zonas',
    TOP_16: 'Top 16',
    TOP_8: 'Top 8',
    TOP_4: 'Top 4',
    SEMIFINAL: 'Semifinales',
    FINAL: 'Final',
    ZONE_FINAL: 'Segunda etapa · zona única',
    FINISHED: 'Finalizado'
  });

  /** Etapas del flujo eliminatorio heredado. No se ofrecen para categorías nuevas. */
  const LEGACY_KNOCKOUT_STAGES = Object.freeze(['TOP_16', 'TOP_8', 'TOP_4', 'SEMIFINAL', 'FINAL']);

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
   * - ZONES: Modalidad A. Zonas iniciales → 2 clasificados por zona → zona única.
   * - SINGLE_ZONE: Modalidad B (+60). Todos los equipos en una única zona.
   */
  const FORMATS = Object.freeze({ ZONES: 'ZONES', SINGLE_ZONE: 'SINGLE_ZONE' });

  const FORMAT_LABELS = Object.freeze({
    ZONES: 'Zonas + zona única',
    SINGLE_ZONE: 'Zona única · todos contra todos'
  });

  /** Estados de alto nivel que se muestran al usuario (derivados, nunca persistidos). */
  const PHASES = Object.freeze({
    CONFIGURING: 'CONFIGURING',
    FIRST_STAGE_IN_PROGRESS: 'FIRST_STAGE_IN_PROGRESS',
    QUALIFICATION_PENDING: 'QUALIFICATION_PENDING',
    QUALIFIED: 'QUALIFIED',
    SINGLE_ZONE_IN_PROGRESS: 'SINGLE_ZONE_IN_PROGRESS',
    FINAL_AVAILABLE: 'FINAL_AVAILABLE',
    LEGACY_KNOCKOUT: 'LEGACY_KNOCKOUT',
    FINISHED: 'FINISHED'
  });

  const PHASE_LABELS = Object.freeze({
    CONFIGURING: 'En configuración',
    FIRST_STAGE_IN_PROGRESS: 'Etapa inicial en curso',
    QUALIFICATION_PENDING: 'Clasificación pendiente',
    QUALIFIED: 'Equipos clasificados',
    SINGLE_ZONE_IN_PROGRESS: 'Zona única en curso',
    FINAL_AVAILABLE: 'Clasificación final disponible',
    LEGACY_KNOCKOUT: 'Etapa eliminatoria (datos anteriores)',
    FINISHED: 'Finalizado'
  });

  /** Cantidad de clasificados por zona inicial hacia la zona única. */
  const QUALIFIERS_PER_ZONE = 2;

  /** Nombre por defecto de la zona única. */
  const SINGLE_ZONE_NAME = 'Zona única';
  const SECOND_STAGE_ZONE_NAME = 'Zona única · Segunda etapa';

  /** Las categorías cuyo nombre contiene "+60" usan la modalidad de zona única. */
  const SINGLE_ZONE_CATEGORY_PATTERN = /\+\s*60(?!\d)/;

  /** Motivo de archivo de un resultado de zona única cuando cambian los clasificados. */
  const ARCHIVE_REASONS = Object.freeze({ QUALIFICATION_CHANGE: 'QUALIFICATION_CHANGE' });

  /** Versión del esquema persistido. Incrementar sólo junto con una migración. */
  const SCHEMA_VERSION = 2;
  const STORAGE_KEY = 'puntaje-newcom-state';

  return Object.freeze({
    STAGES,
    STAGE_LABELS,
    LEGACY_KNOCKOUT_STAGES,
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
