/**
 * Reglas de puntuación de PuntajeNewcom.
 *
 * - Resultados permitidos: 2-0 y 2-1 (vistos desde el ganador; 1-2 y 0-2 desde el perdedor).
 * - 2-0 → 3 puntos al ganador, 1 al perdedor.
 * - 2-1 → 3 puntos al ganador, 2 al perdedor.
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

  /**
   * Tabla oficial inmutable del sistema de puntuación 3-2-1:
   * - Victoria 2-0: 3 puntos para el ganador, 1 punto para el perdedor.
   * - Victoria 2-1: 3 puntos para el ganador, 2 punto para el perdedor.
   */
  const SCORE_POINTS = Object.freeze({
    '2-0': Object.freeze({ winner: 3, loser: 1 }),
    '2-1': Object.freeze({ winner: 3, loser: 2 })
  });

  function isValidScore(score) {
    return VALID_SCORES.indexOf(score) >= 0;
  }

  function normalizeScore(score) {
    if (score === '2-0' || score === '0-2') return '2-0';
    if (score === '2-1' || score === '1-2') return '2-1';
    return null;
  }

  /** Puntos de clasificación para ganador y perdedor según el resultado (3-2-1). */
  function resultPoints(score) {
    const canonical = normalizeScore(score);
    if (!canonical) {
      throw new DomainError('El resultado debe ser 2–0 o 2–1.', 'INVALID_SCORE');
    }
    const pts = SCORE_POINTS[canonical];
    return { winner: pts.winner, loser: pts.loser };
  }

  /** Normaliza un set `{a, b}` (a = ganador del partido). Devuelve null si es inválido. */
  function normalizeSet(set) {
    if (!set || typeof set !== 'object' || set.a === '' || set.b === '' || set.a === null || set.b === null || typeof set.a === 'boolean' || typeof set.b === 'boolean') {
      return null;
    }
    const a = Number(set.a);
    const b = Number(set.b);
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
   * Calcula automáticamente el resultado del partido ('2-0' o '2-1') a partir de los sets.
   * Devuelve null si los sets no definen un resultado válido 2-0 o 2-1.
   */
  function deriveScoreFromSets(sets) {
    if (!Array.isArray(sets) || (sets.length !== 2 && sets.length !== 3)) return null;
    const normalized = normalizeSets(sets);
    if (normalized.length !== sets.length) return null;
    const wins = setWinnerCount(normalized);
    const maxWins = Math.max(wins.a, wins.b);
    const minWins = Math.min(wins.a, wins.b);
    if (maxWins !== 2 || minWins !== (normalized.length === 2 ? 0 : 1)) return null;
    if (normalized.length === 3) {
      const firstTwo = setWinnerCount(normalized.slice(0, 2));
      if (firstTwo.a !== 1 || firstTwo.b !== 1) return null;
    }
    return '2-' + minWins;
  }

  /**
   * Resuelve el resultado oficial ('2-0' o '2-1') de un partido registrado.
   * Si el partido tiene sets válidos orientados al ganador, el resultado se deriva de ellos;
   * en caso contrario se utiliza `match.score` validado.
   */
  function resolveMatchScore(match) {
    if (!match) return null;
    const canonical = normalizeScore(match.score);
    const rawSets = Array.isArray(match.sets) ? match.sets : [];
    const sets = normalizeSets(rawSets);
    if (rawSets.length > 0 && sets.length === rawSets.length) {
      const wins = setWinnerCount(sets);
      if (wins.a === 2 && (wins.b === 0 || wins.b === 1) && sets.length === 2 + wins.b) {
        const derived = '2-' + wins.b;
        if (!canonical || canonical === derived) return derived;
      }
    }
    return canonical;
  }

  /**
   * Calcula automáticamente los puntos de clasificación (3-2-1) de un partido.
   * @returns {{winner: number, loser: number, score: string}|null}
   */
  function matchClassificationPoints(match) {
    const score = resolveMatchScore(match);
    if (!score) return null;
    const pts = resultPoints(score);
    return { winner: pts.winner, loser: pts.loser, score };
  }

  /**
   * Puntos de clasificación obtenidos por `teamId` en `match` según el sistema 3-2-1.
   */
  function matchPointsForTeam(match, teamId) {
    if (!match || match.archived || !teamId) return 0;
    if (match.winnerId !== teamId && match.loserId !== teamId) return 0;
    if (match.winnerId === match.loserId) return 0;
    const pts = matchClassificationPoints(match);
    if (!pts) return 0;
    return match.winnerId === teamId ? pts.winner : pts.loser;
  }

  /**
   * Sets válidos de un partido, o [] si no coinciden con su resultado.
   * Los resultados antiguos sin marcadores conservan sus puntos de clasificación
   * pero no aportan puntos a favor/en contra.
   */
  function matchSetsFor(match) {
    if (!match || !Array.isArray(match.sets) || !match.sets.length) return [];
    const sets = normalizeSets(match.sets);
    if (sets.length !== match.sets.length) return [];
    const wins = setWinnerCount(sets);
    const score = normalizeScore(match.score);
    if ((score === '2-0' && sets.length !== 2) || (score === '2-1' && sets.length !== 3)) return [];
    if (wins.a !== 2 || wins.b !== (score === '2-1' ? 1 : 0)) return [];
    if (sets.length === 3) {
      const firstTwo = setWinnerCount(sets.slice(0, 2));
      if (firstTwo.a !== 1 || firstTwo.b !== 1) return [];
    }
    return sets;
  }

  /** Valida marcadores por set (orientados al ganador) y los devuelve normalizados. */
  function validateMatchSets(sets) {
    if (!Array.isArray(sets)) {
      throw new DomainError('Ingresá 2 sets para un 2–0 o 3 sets para un 2–1.', 'INVALID_SETS');
    }
    const normalized = normalizeSets(sets);
    if (normalized.length !== sets.length || !(normalized.length === 2 || normalized.length === 3)) {
      throw new DomainError('Ingresá 2 sets para un 2–0 o 3 sets para un 2–1.', 'INVALID_SETS');
    }
    const wins = setWinnerCount(normalized);
    if (wins.a === wins.b || Math.max(wins.a, wins.b) !== 2 || Math.min(wins.a, wins.b) > (normalized.length === 2 ? 0 : 1)) {
      throw new DomainError('Los marcadores no coinciden con un resultado válido 2–0 o 2–1.', 'INVALID_SETS');
    }
    if (normalized.length === 3) {
      const firstTwo = setWinnerCount(normalized.slice(0, 2));
      if (firstTwo.a !== 1 || firstTwo.b !== 1) {
        throw new DomainError('Los marcadores no coinciden con un resultado válido 2–0 o 2–1.', 'INVALID_SETS');
      }
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
   * @returns {{teamAWins: boolean, score: string, totalSets: number, winnerPoints: number, loserPoints: number}}
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
    const score = Math.max(a, b) + '-' + Math.min(a, b);
    const pts = resultPoints(score);
    return { teamAWins: a > b, score, totalSets: a + b, winnerPoints: pts.winner, loserPoints: pts.loser };
  }

  return Object.freeze({
    VALID_SCORES,
    SCORE_POINTS,
    isValidScore,
    normalizeScore,
    resultPoints,
    normalizeSet,
    normalizeSets,
    setWinnerCount,
    deriveScoreFromSets,
    resolveMatchScore,
    matchClassificationPoints,
    matchPointsForTeam,
    matchSetsFor,
    validateMatchSets,
    ensureScoreMatchesSets,
    resolveSetsWon
  });
}));
