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

  it('Categoría +68 (7 equipos): Zona Única sin precarga automática por defecto, Semifinales (1v4, 2v3), Final y 5°–7° directo', () => {
    const { service } = makeService();
    const cat = service.createCategory('Categoría +68', 'torneo_68');
    const zU = cat.zoneTournament.zones[0];
    assert.equal(zU.teamIds.length, 0, 'El sistema debe permitir registrar los equipos correspondientes sin cargarlos automáticamente');
    assert.equal(zU.targetTeams, 7);

    const names = [
      'Los Nahuel',
      'Águilas Doradas',
      'Toninas',
      'Unidos por el Newcom',
      'Newen',
      'Abrojal',
      'Corsarios'
    ];
    const teams = names.map((name) => service.createTeam(name, zU.id));
    assert.equal(teams.length, 7);
    assert.throws(() => service.createTeam('Octavo Equipo', zU.id), /admite exactamente 7/);

    assert.equal(teams[0].name, 'Los Nahuel');
    assert.equal(teams[6].name, 'Corsarios');

    // Jugar los 21 enfrentamientos todos contra todos de los 7 participantes registrados
    playRoundRobinOrdered(service, teams, zU.id);

    const standingsRows = service.standings(cat.id, 'ZONE_FINAL', zU.id);
    assert.equal(standingsRows.length, 7);

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
    assert.equal(finalTable.length, 7);
    assert.equal(finalTable[0].team.id, teams[0].id); // Campeón (1°)
    assert.equal(finalTable[1].team.id, teams[2].id); // Subcampeón (2°)
    assert.equal(finalTable[2].team.id, teams[3].id); // 3° puesto
    assert.equal(finalTable[3].team.id, teams[1].id); // 4° puesto
    // 5° al 7° directos de Tabla General sin partidos adicionales
    assert.equal(finalTable[4].position, 5);
    assert.equal(finalTable[4].team.id, teams[4].id);
    assert.equal(finalTable[5].position, 6);
    assert.equal(finalTable[5].team.id, teams[5].id);
    assert.equal(finalTable[6].position, 7);
    assert.equal(finalTable[6].team.id, teams[6].id);
    assert.equal(service.playoffs(cat.id).allComplete, true);
  });

  it('Verifica integración completa de +50, Interzonal C-D, +60, +68 (7 equipos) y tabla Partidos Jugados en app.js', () => {
    const { api, appNode, handlers } = mountApp();

    // 1. Verificar Categoría +68 con 7 equipos en app.js
    const cat68 = api.createCategory('Categoría +68', 'torneo_68');
    const z68 = cat68.zoneTournament.zones[0];
    assert.equal(z68.teamIds.length, 0);
    const teams68 = api.DEFAULT_TEAMS_68.map((name) => api.createTeam(name, z68.id));
    assert.equal(teams68.length, 7);
    assert.throws(() => api.createTeam('Equipo 8', z68.id), /admite exactamente 7/);

    for (let i = 0; i < teams68.length; i += 1) {
      for (let j = i + 1; j < teams68.length; j += 1) {
        api.addMatchFromSets(teams68[i].id, 2, teams68[j].id, 0, SETS['2-0'], z68.id);
      }
    }

    handlers.views.positions();
    assert.match(appNode.innerHTML, /ZONA ÚNICA \(7 EQUIPOS\) · 1° AL 4° SEMIFINALES · 5° AL 7° DIRECTO/);
    assert.match(appNode.innerHTML, /Semifinal 1/);
    assert.match(appNode.innerHTML, /Semifinal 2/);
    assert.match(appNode.innerHTML, /Gran Final \(1° y 2° Puesto\)/);
    assert.match(appNode.innerHTML, /3° y 4° Puesto/);
    assert.match(appNode.innerHTML, /Clasificación Final del 5° al 7° Puesto/);
    assert.doesNotMatch(appNode.innerHTML, /5° al 8°|8°/);

    api.addPlayoffMatchFromSets('semi-1', teams68[0].id, 2, 0, SETS['2-0']);
    api.addPlayoffMatchFromSets('semi-2', teams68[1].id, 2, 0, SETS['2-0']);
    api.addPlayoffMatchFromSets('final', teams68[0].id, 2, 0, SETS['2-0']);
    api.addPlayoffMatchFromSets('third-place', teams68[2].id, 2, 0, SETS['2-0']);
    const final68 = api.computeFinalStandings();
    assert.equal(final68.length, 7);
    assert.equal(final68[6].position, 7);

    // 2. Verificar Categoría +50 e Interzonal C-D
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
