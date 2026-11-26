'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { makeService, play, SETS, createMemoryStorage } = require('./helpers.js');

function mountApp() {
  const storage = createMemoryStorage();
  const handlers = { views: {}, actions: {}, forms: {} };

  const makeEl = () => ({
    innerHTML: '',
    textContent: '',
    hidden: false,
    disabled: false,
    value: '',
    className: '',
    classList: { toggle() {}, add() {}, remove() {} },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    addEventListener() {},
    setAttribute() {},
    getAttribute() { return ''; },
    closest() { return null; },
    focus() {},
    select() {},
    click() {}
  });

  const appNode = {
    innerHTML: '',
    querySelectorAll(selector) {
      if (selector === '[data-view]') {
        return ['home', 'zones', 'results', 'positions', 'matches'].map((v) => ({
          getAttribute(attr) { return attr === 'data-view' ? v : ''; },
          set onclick(fn) { handlers.views[v] = fn; }
        }));
      }
      return [];
    },
    querySelector() { return null; }
  };

  const context = {
    window: {},
    localStorage: storage,
    document: {
      documentElement: makeEl(),
      getElementById(id) { return id === 'app' ? appNode : makeEl(); }
    },
    FormData: function () {},
    confirm: () => true,
    alert: () => {},
    console
  };
  context.globalThis = context;
  vm.createContext(context);
  const code = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  vm.runInContext(code, context);
  return { api: context.window.PuntajeNewcom, appNode, handlers, storage, code, makeEl };
}

function playRoundRobinOrdered(service, orderedTeams, zoneId) {
  for (let i = 0; i < orderedTeams.length; i += 1) {
    for (let j = i + 1; j < orderedTeams.length; j += 1) {
      play(service, orderedTeams[i], '2-0', orderedTeams[j], zoneId);
    }
  }
}

describe('5° Torneo Nacional «Águilas Doradas» — +50, +60 y +68', () => {
  it('Categoría +50 (14 equipos): Zonas A-D, reglas estrictas del Selector Interzonal C-D, Ronda Campeonato/Estímulo con arrastre y Cruces Día 3', () => {
    const { service, storage } = makeService();
    const cat = service.createCategory('Categoría +50', 'torneo_50');
    assert.equal(cat.format, 'torneo_50');

    const initZones = cat.zoneTournament.zones;
    assert.deepEqual(initZones.map((z) => z.name), ['Zona A', 'Zona B', 'Zona C', 'Zona D']);
    const [zA, zB, zC, zD] = initZones;

    const a = ['A1', 'A2', 'A3', 'A4'].map((n) => service.createTeam(n, zA.id));
    const b = ['B1', 'B2', 'B3', 'B4'].map((n) => service.createTeam(n, zB.id));
    const c = ['C1', 'C2', 'C3'].map((n) => service.createTeam(n, zC.id));
    const d = ['D1', 'D2', 'D3'].map((n) => service.createTeam(n, zD.id));

    // Respeta cupos exactos por zona
    assert.throws(() => service.createTeam('A5', zA.id), /cupo de 4/);
    assert.throws(() => service.createTeam('C4', zC.id), /cupo de 3/);

    // Reglas obligatorias del Selector Interzonal C-D
    assert.throws(() => service.setInterzonalPair(1, c[0].id, ''), /incompletos/);
    assert.throws(() => service.setInterzonalPair(1, c[0].id, c[1].id), /Zona C contra un equipo de Zona D/);
    assert.throws(() => service.setInterzonalPair(1, d[0].id, d[1].id), /Zona C contra un equipo de Zona D/);

    service.setInterzonalPair(1, c[0].id, d[0].id);
    // No permite repetir equipos en otro enfrentamiento
    assert.throws(() => service.setInterzonalPair(2, c[0].id, d[1].id), /repetir equipos/);
    assert.throws(() => service.setInterzonalPair(2, c[1].id, d[0].id), /repetir equipos/);

    service.setInterzonalPair(2, c[1].id, d[1].id);
    service.setInterzonalPair(3, c[2].id, d[2].id);

    const izState = service.interzonalStatus(cat.id);
    assert.equal(izState.allAssigned, true);
    assert.equal(izState.pendingC.length, 0);
    assert.equal(izState.pendingD.length, 0);

    // Cargar partidos internos: A (6), B (6), C (3), D (3)
    playRoundRobinOrdered(service, a, zA.id);
    playRoundRobinOrdered(service, b, zB.id);
    playRoundRobinOrdered(service, c, zC.id);
    playRoundRobinOrdered(service, d, zD.id);

    // No deja cerrar Fase 1 si faltan los 3 partidos del Interzonal C-D
    assert.throws(() => service.confirmZones(), /Interzonal C-D/);

    // Cargar los 3 partidos del Interzonal C-D
    service.createInterzonalMatchFromSets(1, c[0].id, 2, 0, SETS['2-0']); // C1 vence a D1
    service.createInterzonalMatchFromSets(2, c[1].id, 2, 0, SETS['2-0']); // C2 vence a D2
    service.createInterzonalMatchFromSets(3, d[2].id, 2, 1, SETS['2-1']); // D3 vence a C3 2-1 (D3=3, C3=2)

    // Si se modifica un cruce con resultado cargado sin force, exige confirmación
    assert.throws(() => service.clearInterzonalPair(3), /resultado cargado/);
    // Con confirmación, elimina resultado previo y permite reasignar
    service.clearInterzonalPair(3, { force: true });
    assert.equal(service.interzonalStatus(cat.id).playedCount, 2);
    service.setInterzonalPair(3, c[2].id, d[2].id);
    service.createInterzonalMatchFromSets(3, d[2].id, 2, 1, SETS['2-1']);

    // Cada equipo de Zona C y D suma 3 partidos en la Fase 1 (2 internos + 1 interzonal)
    const zCRows = service.standings(cat.id, 'GENERAL', zC.id);
    assert.deepEqual(zCRows.map((r) => r.resultCount), [3, 3, 3]);
    assert.deepEqual(zCRows.map((r) => r.team.name), ['C1', 'C2', 'C3']);
    // C1: 2 victorias internas (6) + 1 victoria interzonal (3) = 9 pts
    assert.equal(zCRows[0].classificationPoints, 9);

    const zDRows = service.standings(cat.id, 'GENERAL', zD.id);
    assert.deepEqual(zDRows.map((r) => r.resultCount), [3, 3, 3]);
    // D1 ganó a D2 y D3 (6) + perdió 0-2 con C1 (1) = 7 pts
    // D2 ganó a D3 (3) + perdió con D1 (1) + perdió con C2 (1) = 5 pts
    // D3 perdió con D1 (1) y D2 (1) + ganó 2-1 a C3 (3) = 5 pts (DIF mejor o menor: check D2 vs D3 -> D2 beat D3 -> D2 2°, D3 3°)
    assert.deepEqual(zDRows.map((r) => r.team.name), ['D1', 'D2', 'D3']);

    // Cerrar Fase 1 -> genera Zona 1, Zona 2 (Ronda Campeonato) y Zona 3 (Ronda Estímulo)
    service.confirmZones();
    const afterConfirm = service.selectedCategory();
    assert.equal(afterConfirm.currentStage, 'ZONE_FINAL');
    // No permite editar Interzonal después de cerrar Fase 1
    assert.throws(() => service.setInterzonalPair(1, c[0].id, d[0].id, { force: true }), /cerrada/);

    const z1 = afterConfirm.zoneTournament.zones.find((z) => z.code === '1');
    const z2 = afterConfirm.zoneTournament.zones.find((z) => z.code === '2');
    const z3 = afterConfirm.zoneTournament.zones.find((z) => z.code === '3');

    // Z1: 1°ZA (A1), 1°ZB (B1), 2°ZC (C2), 2°ZD (D2)
    assert.deepEqual(z1.teamIds, [a[0].id, b[0].id, c[1].id, d[1].id]);
    // Z2: 1°ZC (C1), 1°ZD (D1), 2°ZA (A2), 2°ZB (B2)
    assert.deepEqual(z2.teamIds, [c[0].id, d[0].id, a[1].id, b[1].id]);
    // Z3: 3°ZA, 4°ZA, 3°ZB, 4°ZB, 3°ZC, 3°ZD
    assert.deepEqual(z3.teamIds, [a[2].id, a[3].id, b[2].id, b[3].id, c[2].id, d[2].id]);

    // Verificar arrastre de estadísticas desde Fase 1 hacia Zona 1
    const z1Before = service.standings(cat.id, 'ZONE_FINAL', z1.id);
    assert.equal(z1Before.find((r) => r.team.id === a[0].id).classificationPoints, 9);
    assert.equal(z1Before.find((r) => r.team.id === a[0].id).resultCount, 3);

    // Completar Zona 1 y Zona 2 (mientras Zona 3 todavía NO empezó)
    playRoundRobinOrdered(service, [a[0], b[0], c[1], d[1]], z1.id);
    playRoundRobinOrdered(service, [c[0], d[0], a[1], b[1]], z2.id);

    const poBeforeZ3 = service.playoffs(cat.id);
    assert.equal(poBeforeZ3.unlocked, true, 'Cruces Día 3 deben habilitarse al terminar Z1 y Z2 aunque Z3 siga en curso');
    assert.equal(poBeforeZ3.allComplete, false);

    const z1Rank = service.standings(cat.id, 'ZONE_FINAL', z1.id).map((r) => r.team.id);
    const z2Rank = service.standings(cat.id, 'ZONE_FINAL', z2.id).map((r) => r.team.id);
    const semi1 = poBeforeZ3.slots.find((s) => s.id === 'semi-1');
    const semi2 = poBeforeZ3.slots.find((s) => s.id === 'semi-2');
    assert.equal(semi1.teamA.id, z1Rank[0]);
    assert.equal(semi1.teamB.id, z2Rank[1]);
    assert.equal(semi2.teamA.id, z2Rank[0]);
    assert.equal(semi2.teamB.id, z1Rank[1]);

    // Cargar Semis, 5°/6°, 7°/8°, Final y 3°/4°
    service.createPlayoffMatchFromSets('semi-1', semi1.teamA.id, 2, 0, SETS['2-0']);
    service.createPlayoffMatchFromSets('semi-2', semi2.teamA.id, 2, 1, SETS['2-1']);
    service.createPlayoffMatchFromSets('fifth-place', z1Rank[2], 2, 0, SETS['2-0']);
    service.createPlayoffMatchFromSets('seventh-place', z1Rank[3], 2, 0, SETS['2-0']);

    const poAfterSemis = service.playoffs(cat.id);
    const finalSlot = poAfterSemis.slots.find((s) => s.id === 'final');
    const thirdSlot = poAfterSemis.slots.find((s) => s.id === 'third-place');
    assert.equal(finalSlot.teamA.id, semi1.teamA.id);
    assert.equal(finalSlot.teamB.id, semi2.teamA.id);
    assert.equal(thirdSlot.teamA.id, semi1.teamB.id);
    assert.equal(thirdSlot.teamB.id, semi2.teamB.id);

    service.createPlayoffMatchFromSets('final', finalSlot.teamA.id, 2, 0, SETS['2-0']);
    service.createPlayoffMatchFromSets('third-place', thirdSlot.teamB.id, 2, 0, SETS['2-0']);

    // Completar Zona 3 (Ronda Estímulo: 6 equipos = 15 partidos)
    playRoundRobinOrdered(service, [a[2], a[3], b[2], b[3], c[2], d[2]], z3.id);

    const finalTable = service.finalStandings(cat.id);
    assert.equal(finalTable.length, 14);
    assert.equal(finalTable[0].position, 1);
    assert.equal(finalTable[0].team.id, finalSlot.teamA.id);
    assert.equal(finalTable[1].position, 2);
    assert.equal(finalTable[1].team.id, finalSlot.teamB.id);
    assert.equal(finalTable[2].position, 3);
    assert.equal(finalTable[2].team.id, thirdSlot.teamB.id);
    assert.equal(finalTable[13].position, 14);
    assert.ok(service.playoffs(cat.id).allComplete);

    // Recargar desde storage preserva toda la estructura de +50
    const { service: reloaded } = makeService(storage);
    assert.equal(reloaded.finalStandings(cat.id).length, 14);
    assert.equal(reloaded.interzonalStatus(cat.id).playedCount, 3);
  });

  it('Categoría +60 (18 equipos): 3 zonas de 6, cierre hacia Triangulares Zonas 1-6 con arrastre y Cruces Finales Día 3', () => {
    const { service } = makeService();
    const cat = service.createCategory('Categoría +60', 'torneo_60');
    const [zA, zB, zC] = cat.zoneTournament.zones;
    assert.deepEqual([zA.name, zB.name, zC.name], ['Zona A', 'Zona B', 'Zona C']);

    const a = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'].map((n) => service.createTeam(n, zA.id));
    const b = ['B1', 'B2', 'B3', 'B4', 'B5', 'B6'].map((n) => service.createTeam(n, zB.id));
    const c = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6'].map((n) => service.createTeam(n, zC.id));

    assert.throws(() => service.createTeam('A7', zA.id), /cupo de 6/);

    playRoundRobinOrdered(service, a, zA.id);
    playRoundRobinOrdered(service, b, zB.id);
    playRoundRobinOrdered(service, c, zC.id);

    service.confirmZones();
    const updated = service.selectedCategory();
    const zByCode = (code) => updated.zoneTournament.zones.find((z) => z.code === code);

    assert.deepEqual(zByCode('1').teamIds, [a[0].id, b[1].id, c[0].id]); // 1°A, 2°B, 1°C
    assert.deepEqual(zByCode('2').teamIds, [a[1].id, b[0].id, c[1].id]); // 2°A, 1°B, 2°C
    assert.deepEqual(zByCode('3').teamIds, [a[2].id, b[2].id, c[2].id]); // 3°s -> 7°..9°
    assert.deepEqual(zByCode('4').teamIds, [a[3].id, b[3].id, c[3].id]); // 4°s -> 10°..12°
    assert.deepEqual(zByCode('5').teamIds, [a[4].id, b[4].id, c[4].id]); // 5°s -> 13°..15°
    assert.deepEqual(zByCode('6').teamIds, [a[5].id, b[5].id, c[5].id]); // 6°s -> 16°..18°

    // A1 llevó sus 5 victorias (15 pts) a Zona 1
    const z1Init = service.standings(cat.id, 'ZONE_FINAL', zByCode('1').id);
    assert.equal(z1Init.find((r) => r.team.id === a[0].id).classificationPoints, 15);

    // Completar todos los triangulares
    [1, 2, 3, 4, 5, 6].forEach((num) => {
      const z = zByCode(String(num));
      const tList = z.teamIds.map((id) => service.teamById(id));
      playRoundRobinOrdered(service, tList, z.id);
    });

    const po = service.playoffs(cat.id);
    assert.equal(po.unlocked, true);
    const s1 = po.slots.find((s) => s.id === 'semi-1');
    const s2 = po.slots.find((s) => s.id === 'semi-2');
    const s5 = po.slots.find((s) => s.id === 'fifth-place');
    service.createPlayoffMatchFromSets('semi-1', s1.teamA.id, 2, 0, SETS['2-0']);
    service.createPlayoffMatchFromSets('semi-2', s2.teamB.id, 2, 0, SETS['2-0']);
    service.createPlayoffMatchFromSets('fifth-place', s5.teamA.id, 2, 1, SETS['2-1']);

    const po2 = service.playoffs(cat.id);
    const fin = po2.slots.find((s) => s.id === 'final');
    const third = po2.slots.find((s) => s.id === 'third-place');
    service.createPlayoffMatchFromSets('final', fin.teamB.id, 2, 1, SETS['2-1']);
    service.createPlayoffMatchFromSets('third-place', third.teamA.id, 2, 0, SETS['2-0']);

    const finalTable = service.finalStandings(cat.id);
    assert.equal(finalTable.length, 18);
    assert.equal(finalTable[0].team.id, fin.teamB.id);
    assert.equal(finalTable[1].team.id, fin.teamA.id);
    assert.equal(finalTable[6].position, 7);
    assert.equal(finalTable[17].position, 18);
    assert.equal(service.playoffs(cat.id).allComplete, true);
  });

  it('PRUEBA A — Categoría +68 con 7 equipos: registro flexible, fixture de 21 partidos (6 por equipo y 1 fecha libre), tabla, Top 4, Semifinales, Final, 3° puesto y persistencia', () => {
    const { service, storage } = makeService();
    const cat = service.createCategory('Categoría +68', 'torneo_68');
    const zU = cat.zoneTournament.zones[0];
    assert.equal(zU.teamIds.length, 0);

    // Validación de cantidad mínima suficiente de equipos (< 4 no permite generar torneo)
    const teamNames7 = [
      'Los Nahuel',
      'Águilas Doradas',
      'Toninas',
      'Unidos por el Newcom',
      'Newen',
      'Abrojal',
      'Dubke Ñucom'
    ];
    const t1 = service.createTeam(teamNames7[0], zU.id);
    const t2 = service.createTeam(teamNames7[1], zU.id);
    const t3 = service.createTeam(teamNames7[2], zU.id);
    assert.throws(() => service.generateFixture(zU.id), /al menos 4 equipos/);
    assert.equal(service.playoffs(cat.id).unlocked, false);
    assert.doesNotMatch(service.playoffs(cat.id).reasons.join(' '), /8 equipos/);

    // No permite duplicar equipos
    assert.throws(() => service.createTeam('Los Nahuel', zU.id), /Ya existe un equipo/);

    // Registrar los 4 equipos restantes hasta completar 7 equipos inscriptos
    const t4 = service.createTeam(teamNames7[3], zU.id);
    const t5 = service.createTeam(teamNames7[4], zU.id);
    const t6 = service.createTeam(teamNames7[5], zU.id);
    const t7 = service.createTeam(teamNames7[6], zU.id);
    const teams7 = [t1, t2, t3, t4, t5, t6, t7];

    assert.equal(service.teamsOf(cat.id).length, 7, 'Deben existir exactamente 7 equipos registrados (sin equipos ficticios)');

    // Generar y verificar el fixture para 7 equipos
    const fixture = service.generateFixture(zU.id);
    assert.equal(fixture.valid, true);
    assert.equal(fixture.teamCount, 7);
    assert.equal(fixture.totalMatches, 21, 'Con 7 equipos deben generarse exactamente 21 partidos');
    assert.equal(fixture.matchesPerTeam, 6, 'Cada equipo debe jugar exactamente 6 partidos');
    assert.equal(fixture.roundsCount, 7, 'El fixture de 7 equipos debe tener 7 fechas/rondas');
    assert.equal(fixture.hasFreeDates, true, 'Con 7 equipos debe haber fecha libre en cada ronda');
    assert.equal(fixture.allMatches.length, 21);

    // Verificar que cada equipo juegue exactamente 6 partidos, sin duplicados ni partidos contra sí mismo
    const pairSet = new Set();
    for (const m of fixture.allMatches) {
      assert.ok(m.teamAId && m.teamBId, 'Ningún partido puede incluir equipos ficticios o nulos');
      assert.notEqual(m.teamAId, m.teamBId, 'Un equipo nunca debe jugar contra sí mismo');
      const pk = [m.teamAId, m.teamBId].sort().join('|');
      assert.equal(pairSet.has(pk), false, `Enfrentamiento duplicado detectado: ${pk}`);
      pairSet.add(pk);
    }
    assert.equal(pairSet.size, 21);

    for (const team of teams7) {
      assert.equal(fixture.matchesByTeam[team.id], 6, `El equipo ${team.name} debe tener exactamente 6 partidos`);
    }

    // Verificar fechas libres: 1 equipo libre por fecha, y los 7 equipos tienen exactamente 1 fecha libre
    assert.equal(fixture.freeTeamsByRound.length, 7);
    const freeTeamIds = fixture.rounds.map((r) => {
      assert.equal(r.matches.length, 3, `La ${r.name} debe tener 3 partidos reales`);
      assert.ok(r.freeTeamId, `La ${r.name} debe asignar 1 equipo con fecha libre`);
      const playingInRound = new Set();
      r.matches.forEach((m) => {
        playingInRound.add(m.teamAId);
        playingInRound.add(m.teamBId);
      });
      assert.equal(playingInRound.has(r.freeTeamId), false, 'El equipo con fecha libre no debe jugar en esa misma fecha');
      return r.freeTeamId;
    });
    assert.equal(new Set(freeTeamIds).size, 7, 'Cada uno de los 7 equipos debe tener exactamente una fecha libre');

    // Cargar resultados de los 21 partidos programados en el fixture
    // El equipo con menor índice en teams7 gana 2-0 (o 2-1 en cruces consecutivos) para ordenar 1°..7°
    const rankOrder = new Map(teams7.map((t, idx) => [t.id, idx]));
    for (const m of fixture.allMatches) {
      const idxA = rankOrder.get(m.teamAId);
      const idxB = rankOrder.get(m.teamBId);
      const aWins = idxA < idxB;
      const closeMatch = Math.abs(idxA - idxB) === 1;
      if (aWins) {
        play(service, service.teamById(m.teamAId), closeMatch ? '2-1' : '2-0', service.teamById(m.teamBId), zU.id);
      } else {
        play(service, service.teamById(m.teamBId), closeMatch ? '2-1' : '2-0', service.teamById(m.teamAId), zU.id);
      }
    }

    // Comprobar tabla de posiciones (PJ=6, PG, PP, PF, PC, DIF, Puntos)
    const table = service.standings(cat.id, 'ZONE_FINAL', zU.id);
    assert.equal(table.length, 7);
    assert.deepEqual(table.map((r) => r.team.id), teams7.map((t) => t.id));
    table.forEach((row, idx) => {
      assert.equal(row.resultCount, 6, 'Cada equipo debe registrar PJ = 6');
      assert.equal(row.wins, 6 - idx, 'PG debe coincidir con victorias reales');
      assert.equal(row.losses, idx, 'PP debe coincidir con derrotas reales');
      assert.ok(row.pointsFor > 0 && row.pointsAgainst > 0);
      assert.equal(row.difference, row.pointsFor - row.pointsAgainst, 'DIF = PF - PC');
      assert.equal(row.classificationPoints, (6 - idx) * 3 + (idx > 0 ? idx + 1 : 0));
    });

    // Clasificación de los 4 primeros y generación de Semifinales (1° vs 4° y 2° vs 3°)
    const po = service.playoffs(cat.id);
    assert.equal(po.unlocked, true, 'Al completar los 21 partidos de los 7 equipos deben habilitarse las eliminatorias');
    const s1 = po.slots.find((s) => s.id === 'semi-1');
    const s2 = po.slots.find((s) => s.id === 'semi-2');
    assert.equal(s1.teamA.id, teams7[0].id); // 1°
    assert.equal(s1.teamB.id, teams7[3].id); // 4°
    assert.equal(s2.teamA.id, teams7[1].id); // 2°
    assert.equal(s2.teamB.id, teams7[2].id); // 3°

    // Disputar Semifinales -> genera automáticamente Gran Final y 3°/4° puesto
    service.createPlayoffMatchFromSets('semi-1', s1.teamA.id, 2, 0, SETS['2-0']);
    service.createPlayoffMatchFromSets('semi-2', s2.teamB.id, 2, 1, SETS['2-1']);

    const po2 = service.playoffs(cat.id);
    const fin = po2.slots.find((s) => s.id === 'final');
    const third = po2.slots.find((s) => s.id === 'third-place');
    assert.equal(fin.ready, true);
    assert.equal(fin.teamA.id, teams7[0].id);
    assert.equal(fin.teamB.id, teams7[2].id);
    assert.equal(third.ready, true);
    assert.equal(third.teamA.id, teams7[3].id);
    assert.equal(third.teamB.id, teams7[1].id);

    service.createPlayoffMatchFromSets('final', fin.teamA.id, 2, 0, SETS['2-0']);
    service.createPlayoffMatchFromSets('third-place', third.teamB.id, 2, 1, SETS['2-1']);

    // Verificar posiciones finales: 1° al 4° por eliminatorias, y 5° al 7° conservan su posición de la tabla general
    const finalTable = service.finalStandings(cat.id);
    assert.equal(finalTable.length, 7, 'Con 7 equipos la clasificación final debe tener exactamente 7 puestos');
    assert.equal(finalTable[0].team.id, teams7[0].id); // 1° Campeón
    assert.equal(finalTable[1].team.id, teams7[2].id); // 2° Subcampeón
    assert.equal(finalTable[2].team.id, teams7[1].id); // 3° Puesto
    assert.equal(finalTable[3].team.id, teams7[3].id); // 4° Puesto
    assert.equal(finalTable[4].team.id, teams7[4].id); // 5° directo por Tabla General
    assert.equal(finalTable[5].team.id, teams7[5].id); // 6° directo por Tabla General
    assert.equal(finalTable[6].team.id, teams7[6].id); // 7° directo por Tabla General
    assert.equal(service.playoffs(cat.id).allComplete, true);

    // Verificar persistencia al cerrar y volver a abrir el servicio sobre el mismo almacenamiento
    const { service: reloadedService } = makeService(storage);
    const reloadedFx = reloadedService.fixture(cat.id, zU.id);
    assert.equal(reloadedFx.teamCount, 7);
    assert.equal(reloadedFx.totalMatches, 21);
    assert.equal(reloadedFx.playedMatchesCount, 21);
    assert.equal(reloadedService.finalStandings(cat.id).length, 7);
    assert.equal(reloadedService.finalStandings(cat.id)[0].team.id, teams7[0].id);
  });

  it('PRUEBA B — Categoría +68 con 8 equipos: fixture de 28 partidos (7 por equipo), tabla, Top 4, Semifinales (1v4, 2v3), Final y 5°–8° directo', () => {
    const { service, storage } = makeService();
    const cat = service.createCategory('Categoría +68', 'torneo_68', { preloadTeams68: true });
    const zU = cat.zoneTournament.zones[0];
    assert.equal(zU.teamIds.length, 8);

    const teams = zU.teamIds.map((id) => service.teamById(id));
    assert.equal(teams[0].name, 'Los Nahuel');
    assert.equal(teams[7].name, 'Corsarios');

    // Comprobar generación automática del fixture para 8 equipos
    const fixture = service.generateFixture(zU.id);
    assert.equal(fixture.valid, true);
    assert.equal(fixture.teamCount, 8);
    assert.equal(fixture.totalMatches, 28, 'Con 8 equipos deben generarse exactamente 28 partidos');
    assert.equal(fixture.matchesPerTeam, 7, 'Cada equipo debe disputar exactamente 7 partidos');
    assert.equal(fixture.roundsCount, 7, 'El fixture de 8 equipos debe organizarse en 7 fechas');
    assert.equal(fixture.hasFreeDates, false, 'Con 8 equipos (par) no hay fechas libres');
    assert.equal(fixture.freeTeamsByRound.length, 0);
    for (const team of teams) {
      assert.equal(fixture.matchesByTeam[team.id], 7, `El equipo ${team.name} debe tener 7 partidos`);
    }

    // Jugar los 28 partidos (todos contra todos)
    playRoundRobinOrdered(service, teams, zU.id);

    const table = service.standings(cat.id, 'ZONE_FINAL', zU.id);
    assert.equal(table.length, 8);
    table.forEach((row) => assert.equal(row.resultCount, 7, 'Cada equipo debe tener PJ = 7'));

    const po = service.playoffs(cat.id);
    assert.equal(po.unlocked, true);
    const s1 = po.slots.find((s) => s.id === 'semi-1');
    const s2 = po.slots.find((s) => s.id === 'semi-2');
    assert.equal(s1.teamA.id, teams[0].id); // 1°
    assert.equal(s1.teamB.id, teams[3].id); // 4°
    assert.equal(s2.teamA.id, teams[1].id); // 2°
    assert.equal(s2.teamB.id, teams[2].id); // 3°

    service.createPlayoffMatchFromSets('semi-1', s1.teamA.id, 2, 0, SETS['2-0']);
    service.createPlayoffMatchFromSets('semi-2', s2.teamB.id, 2, 1, SETS['2-1']);

    const po2 = service.playoffs(cat.id);
    const fin = po2.slots.find((s) => s.id === 'final');
    const third = po2.slots.find((s) => s.id === 'third-place');
    service.createPlayoffMatchFromSets('final', fin.teamA.id, 2, 0, SETS['2-0']);
    service.createPlayoffMatchFromSets('third-place', third.teamA.id, 2, 0, SETS['2-0']);

    const finalTable = service.finalStandings(cat.id);
    assert.equal(finalTable.length, 8);
    assert.equal(finalTable[0].team.id, teams[0].id); // Campeón
    assert.equal(finalTable[1].team.id, teams[2].id); // Subcampeón
    // 5° al 8° directos de Tabla General sin partidos extra
    assert.equal(finalTable[4].team.id, teams[4].id);
    assert.equal(finalTable[5].team.id, teams[5].id);
    assert.equal(finalTable[6].team.id, teams[6].id);
    assert.equal(finalTable[7].team.id, teams[7].id);
    assert.equal(service.playoffs(cat.id).allComplete, true);

    // Verificar persistencia al recargar
    const { service: reloaded } = makeService(storage);
    assert.equal(reloaded.fixture(cat.id, zU.id).totalMatches, 28);
    assert.equal(reloaded.finalStandings(cat.id).length, 8);
  });

  it('Verifica adaptación de la interfaz (app.js) y persistencia para +68 con 7 y 8 equipos, además de +50 e Interzonal C-D', () => {
    const { api, appNode, handlers, storage, code, makeEl } = mountApp();

    // 1. Verificar UI en app.js para Categoría +68 con 7 equipos
    const cat68 = api.createCategory('Categoría +68 Águilas', 'torneo_68');
    const z68 = cat68.zoneTournament.zones[0];
    const names7 = ['Los Nahuel', 'Águilas Doradas', 'Toninas', 'Unidos por el Newcom', 'Newen', 'Abrojal', 'Dubke Ñucom'];
    const teams7 = names7.map((n) => api.createTeam(n, z68.id));

    const fx7 = api.generateFixture(z68.id);
    assert.equal(fx7.teamCount, 7);
    assert.equal(fx7.totalMatches, 21);
    assert.equal(fx7.matchesPerTeam, 6);
    assert.equal(fx7.roundsCount, 7);
    assert.equal(fx7.hasFreeDates, true);

    handlers.views.zones();
    assert.match(appNode.innerHTML, /7 Equipos Inscriptos \(21 Partidos Programados\)/);
    assert.match(appNode.innerHTML, /6 partidos/);
    assert.match(appNode.innerHTML, /Fecha libre:/);
    assert.doesNotMatch(appNode.innerHTML, /requiere exactamente 8 equipos/);

    // Cargar los 21 partidos de los 7 equipos en app.js
    for (let i = 0; i < teams7.length; i += 1) {
      for (let j = i + 1; j < teams7.length; j += 1) {
        api.addMatchFromSets(teams7[i].id, 2, teams7[j].id, 0, SETS['2-0'], z68.id);
      }
    }

    handlers.views.positions();
    assert.match(appNode.innerHTML, /ZONA ÚNICA · 7 EQUIPOS · 1° AL 4° SEMIFINALES · 5° AL 7° DIRECTO/);
    assert.match(appNode.innerHTML, /Semifinal 1/);
    assert.match(appNode.innerHTML, /Semifinal 2/);

    const po7 = api.computePlayoffs();
    assert.equal(po7.unlocked, true);
    api.addPlayoffMatchFromSets('semi-1', teams7[0].id, 2, 0, SETS['2-0']);
    api.addPlayoffMatchFromSets('semi-2', teams7[1].id, 2, 1, SETS['2-1']);
    api.addPlayoffMatchFromSets('final', teams7[0].id, 2, 0, SETS['2-0']);
    api.addPlayoffMatchFromSets('third-place', teams7[2].id, 2, 0, SETS['2-0']);

    const final7 = api.computeFinalStandings();
    assert.equal(final7.length, 7);
    assert.equal(final7[0].team.id, teams7[0].id);
    assert.equal(final7[6].team.id, teams7[6].id);

    // Simular cierre y reapertura de app.js con el mismo storage
    const appNode2 = { innerHTML: '', querySelectorAll() { return []; }, querySelector() { return null; } };
    const context2 = {
      window: {},
      localStorage: storage,
      document: {
        documentElement: makeEl(),
        getElementById(id) { return id === 'app' ? appNode2 : makeEl(); }
      },
      FormData: function () {},
      confirm: () => true,
      alert: () => {},
      console
    };
    context2.globalThis = context2;
    vm.createContext(context2);
    vm.runInContext(code, context2);
    const apiReloaded = context2.window.PuntajeNewcom;
    assert.equal(apiReloaded.getFixture(cat68.id, z68.id).totalMatches, 21);
    assert.equal(apiReloaded.computeFinalStandings().length, 7);

    // 2. Verificar también +50 e Interzonal C-D en app.js
    const cat50 = api.createCategory('Categoría +50', 'torneo_50');
    const [zA, zB, zC, zD] = cat50.zoneTournament.zones;
    const a = ['A1', 'A2', 'A3', 'A4'].map((n) => api.createTeam(n, zA.id));
    const b = ['B1', 'B2', 'B3', 'B4'].map((n) => api.createTeam(n, zB.id));
    const c = ['C1', 'C2', 'C3'].map((n) => api.createTeam(n, zC.id));
    const d = ['D1', 'D2', 'D3'].map((n) => api.createTeam(n, zD.id));

    api.setInterzonalPair(1, c[0].id, d[0].id);
    api.setInterzonalPair(2, c[1].id, d[1].id);
    api.setInterzonalPair(3, c[2].id, d[2].id);
    assert.throws(() => api.setInterzonalPair(2, c[0].id, d[2].id), /repetir equipos/);

    // Renderizar Paso 1 en app.js: muestra la sección Interzonal C-D y los listados
    handlers.views.zones();
    assert.match(appNode.innerHTML, /Interzonal C-D/);
    assert.match(appNode.innerHTML, /Partidos Interzonales C-D Registrados/);

    api.addInterzonalMatchFromSets(1, c[0].id, 2, 0, SETS['2-0']);
    api.addMatchFromSets(a[0].id, 2, a[1].id, 0, SETS['2-0'], zA.id);

    // Verificar Partidos Jugados: columna P sin prefijo "P" y sin columna ACCIONES
    handlers.views.matches();
    assert.match(appNode.innerHTML, /<thead><tr><th>P<\/th><th>ZONA \/ FASE<\/th><th>EQUIPO<\/th><th>RES\.<\/th><th>SET 1<\/th><th>SET 2<\/th><th>SET 3<\/th><\/tr><\/thead>/);
    assert.match(appNode.innerHTML, /<td rowspan="2" class="match-p-cell"><strong>1<\/strong><\/td>/);
    assert.match(appNode.innerHTML, /<td rowspan="2" class="match-p-cell"><strong>2<\/strong><\/td>/);
    assert.match(appNode.innerHTML, /Interzonal C-D/);
    assert.doesNotMatch(appNode.innerHTML, /ACCIONES|>Editar<|>Deshacer</);
  });
});
