/**
 * Repositorio de estado sobre Web Storage (localStorage).
 *
 * Se conserva el mecanismo de persistencia original (misma clave
 * `puntaje-newcom-state`, JSON completo del estado). Mejoras:
 *  - Antes de reescribir un estado migrado se guarda una copia exacta del JSON
 *    original en `<clave>.backup-v<versión anterior>` (una sola vez).
 *  - `save` devuelve false en lugar de lanzar, para que la capa de aplicación
 *    pueda revertir el cambio en memoria (ver `TournamentService.commit`).
 *
 * Capa: infrastructure. Implementa el puerto `StateRepository { load(), save(state) }`.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../domain/constants.js'), require('./state-schema.js'));
  } else {
    const modules = root.PuntajeNewcomModules;
    modules.localStorageRepository = factory(modules.constants, modules.stateSchema);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (constants, stateSchema) {
  'use strict';

  /**
   * @param {{getItem: Function, setItem: Function}} storage Implementación de Web Storage.
   * @param {{key?: string, newId: Function, now: Function, logger?: {warn: Function, info: Function}}} options
   */
  function createLocalStorageRepository(storage, options) {
    const key = options.key || constants.STORAGE_KEY;
    const logger = options.logger || { warn: function () {}, info: function () {} };
    const deps = { newId: options.newId, now: options.now };

    function load() {
      let rawText = null;
      try {
        rawText = storage.getItem(key);
        if (!rawText) return stateSchema.emptyState();
        const parsed = JSON.parse(rawText);
        const result = stateSchema.normalize(parsed, deps);
        result.notes.forEach(function (note) { logger.info('[PuntajeNewcom] ' + note); });
        const normalizedText = JSON.stringify(result.state);
        if (normalizedText !== JSON.stringify(parsed)) {
          const previousVersion = Number.isInteger(parsed && parsed.schemaVersion) ? parsed.schemaVersion : 1;
          const backupKey = key + '.backup-v' + previousVersion;
          if (previousVersion !== constants.SCHEMA_VERSION && !storage.getItem(backupKey)) storage.setItem(backupKey, rawText);
          storage.setItem(key, normalizedText);
        }
        return result.state;
      } catch (error) {
        logger.warn('No se pudo leer el estado guardado; se inició vacío.', error);
        if (rawText) {
          try { storage.setItem(key + '.corrupt-' + Date.now(), rawText); } catch (ignored) { /* best effort */ }
        }
        return stateSchema.emptyState();
      }
    }

    function save(state) {
      try {
        storage.setItem(key, JSON.stringify(state));
        return true;
      } catch (error) {
        logger.warn('No se pudo guardar el estado.', error);
        return false;
      }
    }

    return Object.freeze({ load, save, key });
  }

  /** Implementación en memoria de Web Storage (tests y entornos sin localStorage). */
  function createMemoryStorage(initial) {
    const data = Object.assign({}, initial || {});
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
      setItem: function (k, v) { data[k] = String(v); },
      removeItem: function (k) { delete data[k]; },
      keys: function () { return Object.keys(data); }
    };
  }

  return Object.freeze({ createLocalStorageRepository, createMemoryStorage });
}));
