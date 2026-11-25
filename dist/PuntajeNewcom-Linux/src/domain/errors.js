/**
 * Errores tipados del dominio.
 *
 * `DomainError` representa una regla de negocio incumplida o una entrada inválida.
 * Su `message` está pensado para mostrarse al usuario (en español). Cualquier otro
 * error (TypeError, fallo de almacenamiento inesperado, etc.) se considera un
 * defecto interno: la UI muestra un mensaje genérico y lo registra en consola.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PuntajeNewcomModules = root.PuntajeNewcomModules || {};
    root.PuntajeNewcomModules.errors = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  class DomainError extends Error {
    /**
     * @param {string} message Mensaje apto para el usuario.
     * @param {string} [code] Código estable para tests y diagnósticos.
     */
    constructor(message, code) {
      super(message);
      this.name = 'DomainError';
      this.code = code || 'DOMAIN_RULE';
    }
  }

  class PersistenceError extends DomainError {
    constructor(message) {
      super(message, 'PERSISTENCE_FAILED');
      this.name = 'PersistenceError';
    }
  }

  /** Lanza un DomainError cuando la condición no se cumple. */
  function ensure(condition, message, code) {
    if (!condition) throw new DomainError(message, code);
  }

  return Object.freeze({ DomainError, PersistenceError, ensure });
}));
