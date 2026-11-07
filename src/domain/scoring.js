/**
 * Reglas de puntuación de PuntajeNewcom.
 *
 * - Resultados permitidos: 2-0 y 2-1 (vistos desde el ganador; 1-2 y 0-2 desde el perdedor).
 * - 2-0 → 3 puntos al ganador, 1 al perdedor.
 * - 2-1 → 2 puntos al ganador, 1 al perdedor.
 * - Los marcadores por set alimentan puntos a favor (PF) y en contra (PC).
 *
 * Capa: domain. Funciones puras.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./errors.js'));
  } else {
    root.PuntajeNewcomModules = root.PuntajeNewcomModules || {};
    root.PuntajeNewcomModules.scoring = factory(root.PuntajeNewcomModules.errors);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (errors) {
  'use strict';

  const { DomainError } = errors;
  const VALID_SCORES = Object.freeze(['2-0', '2-1']);

  function isValidScore(score) {
    return VALID_SCORES.indexOf(score) >= 0;
  }

  /** Puntos de clasificación para ganador y perdedor según el resultado. */
  function resultPoints(score) {
    return score === '2-0' ? { winner: 3, loser: 1 } : { winner: 2, loser: 1 };
  }

  /** Normaliza un set `{a, b}` (a = ganador del partido). Devuelve null si es inválido. */
  function normalizeSet(set) {
    const a = Number(set && set.a);
    const b = Number(set && set.b);
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a === b) return null;
    return { a, b };
  }

  function normalizeSets(sets) {
    return Array.isArray(sets) ? sets.map(normalizeSet).filter(Boolean) : [];
  }

  function setWinnerCount(sets) {
    return sets.reduce(function (count, set) {
      return { a: count.a + (set.a > set.b ? 1 : 0), b: count.b + (set.b > set.a ? 1 : 0) };
    }, { a: 0, b: 0 });
  }

  /**
   * Sets válidos de un partido, o [] si no coinciden con su resultado.
   * Los resultados antiguos sin marcadores conservan sus puntos de clasificación
   * pero no aportan puntos a favor/en contra.
   */
  function matchSetsFor(match) {
    const sets = normalizeSets(match && match.sets);
    const wins = setWinnerCount(sets);
    const score = match && match.score;
    if ((score === '2-0' && sets.length !== 2) || (score === '2-1' && sets.length !== 3)) return [];
    if (wins.a !== 2 || wins.b !== (score === '2-1' ? 1 : 0)) return [];
    return sets;
  }

  /** Valida marcadores por set (orientados al ganador) y los devuelve normalizados. */
  function validateMatchSets(sets) {
    const normalized = normalizeSets(sets);
    const wins = setWinnerCount(normalized);
    if (!(normalized.length === 2 || normalized.length === 3)) {
      throw new DomainError('Ingresá 2 sets para un 2–0 o 3 sets para un 2–1.', 'INVALID_SETS');
    }
    if (wins.a === wins.b || Math.max(wins.a, wins.b) !== 2 || Math.min(wins.a, wins.b) > (normalized.length === 2 ? 0 : 1)) {
      throw new DomainError('Los marcadores no coinciden con un resultado válido 2–0 o 2–1.', 'INVALID_SETS');
    }
    return normalized;
  }

  /** Comprueba que el resultado tradicional coincida con los sets (orientados al ganador). */
  function ensureScoreMatchesSets(score, sets) {
    if (!sets.length) return;
    const wins = setWinnerCount(sets);
    if (wins.a !== 2 || score !== '2-' + wins.b) {
      throw new DomainError('El resultado tradicional no coincide con los marcadores.', 'SCORE_SETS_MISMATCH');
    }
  }

  /**
   * Interpreta los sets ganados por cada equipo (2-0, 2-1, 1-2, 0-2).
   * @returns {{teamAWins: boolean, score: string}}
   */
  function resolveSetsWon(setsA, setsB) {
    const a = Number(setsA);
    const b = Number(setsB);
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) {
      throw new DomainError('Los sets deben ser números enteros mayores o iguales a 0.', 'INVALID_SETS_WON');
    }
    if (!((a === 2 && (b === 0 || b === 1)) || (b === 2 && (a === 0 || a === 1)))) {
      throw new DomainError('Ingresá un resultado válido: 2–0 o 2–1.', 'INVALID_SETS_WON');
    }
    return { teamAWins: a > b, score: Math.max(a, b) + '-' + Math.min(a, b), totalSets: a + b };
  }

  return Object.freeze({
    VALID_SCORES,
    isValidScore,
    resultPoints,
    normalizeSet,
    normalizeSets,
    setWinnerCount,
    matchSetsFor,
    validateMatchSets,
    ensureScoreMatchesSets,
    resolveSetsWon
  });
}));
