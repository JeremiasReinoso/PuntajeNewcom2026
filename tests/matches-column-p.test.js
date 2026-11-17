'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createMemoryStorage } = require('./helpers.js');

function mountApp() {
  const storage = createMemoryStorage();
  const handlers = { views: {}, phaseFilter: null, zoneFilter: null };

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
        return ['zones', 'results', 'positions', 'matches'].map((viewName) => ({
          getAttribute(attr) { return attr === 'data-view' ? viewName : ''; },
          set onclick(fn) { handlers.views[viewName] = fn; }
        }));
      }
      if (selector === '[data-action="match-phase-filter"]') {
        const el = { value: 'ALL', set onchange(fn) { handlers.phaseFilter = (v) => { el.value = v; fn(); }; } };
        return [el];
      }
      if (selector === '[data-action="match-zone-filter"]') {
        const el = { value: 'ALL', set onchange(fn) { handlers.zoneFilter = (v) => { el.value = v; fn(); }; } };
        return [el];
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
    console
  };
  context.globalThis = context;
  vm.createContext(context);
  const code = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  vm.runInContext(code, context);

  return { api: context.window.PuntajeNewcom, appNode, handlers };
}

function extractRenderedMatches(html) {
  const regex = /<tr class="match-row-winner"><td rowspan="2" class="match-p-cell"><strong>([^<]+)<\/strong><\/td><td rowspan="2" class="match-zone-cell"><strong>([^<]+)<\/strong><small>([^<]+)<\/small><\/td><td class="match-team-cell is-winner"><strong>([^<]+)<\/strong><\/td>.*?data-action="edit-match" data-id="([^"]+)"/g;
  const rows = [];
  let match;
  while ((match = regex.exec(html)) !== null) {
    rows.push({
      pCell: match[1],
      zone: match[2],
      phase: match[3],
      winner: match[4],
      matchId: match[5]
    });
  }
  return rows;
}

describe('Columna P en Partidos Jugados', () => {
  it('muestra numeración correlativa sin prefijo P del 1 al 10 y la conserva al filtrar por zona o fase', () => {
    const { api, appNode, handlers } = mountApp();
    api.createCategory('Categoría +50', 'zonas_y_final');

    const zA = api.createZone('Zona A');
    const zB = api.createZone('Zona B');
    const a = ['A1', 'A2', 'A3', 'A4'].map((n) => api.createTeam(n, zA.id));
    const b = ['B1', 'B2', 'B3', 'B4'].map((n) => api.createTeam(n, zB.id));

    const sets20 = [{ a: 15, b: 8 }, { a: 15, b: 9 }];
    // 4 partidos en Zona A + 4 partidos en Zona B = 8 partidos en fase clasificatoria
    api.addMatchFromSets(a[0].id, 2, a[1].id, 0, sets20, zA.id);
    api.addMatchFromSets(a[0].id, 2, a[2].id, 0, sets20, zA.id);
    api.addMatchFromSets(a[0].id, 2, a[3].id, 0, sets20, zA.id);
    api.addMatchFromSets(a[1].id, 2, a[2].id, 0, sets20, zA.id);

    api.addMatchFromSets(b[0].id, 2, b[1].id, 0, sets20, zB.id);
    api.addMatchFromSets(b[0].id, 2, b[2].id, 0, sets20, zB.id);
    api.addMatchFromSets(b[0].id, 2, b[3].id, 0, sets20, zB.id);
    api.addMatchFromSets(b[1].id, 2, b[2].id, 0, sets20, zB.id);

    // Completar cruces restantes necesarios para poder cerrar zonas y pasar a Zona Final
    api.addMatchFromSets(a[1].id, 2, a[3].id, 0, sets20, zA.id);
    api.addMatchFromSets(a[2].id, 2, a[3].id, 0, sets20, zA.id);
    api.addMatchFromSets(b[1].id, 2, b[3].id, 0, sets20, zB.id);
    api.addMatchFromSets(b[2].id, 2, b[3].id, 0, sets20, zB.id);

    api.confirmZones();
    const finalZoneId = api.getState().categories[0].zoneTournament.secondStageZoneId;
    // 2 partidos en Zona Final (total 14 partidos; los primeros 10 cubren 1..10)
    api.addMatchFromSets(a[0].id, 2, b[0].id, 0, sets20, finalZoneId);
    api.addMatchFromSets(a[1].id, 2, b[1].id, 0, sets20, finalZoneId);

    handlers.views.matches();
    assert.match(appNode.innerHTML, /<thead><tr><th>P<\/th>/);
    assert.doesNotMatch(appNode.innerHTML, /class="match-p-cell"><strong>P\d+<\/strong>/);

    const allRows = extractRenderedMatches(appNode.innerHTML);
    assert.equal(allRows.length, 14);
    assert.deepEqual(
      allRows.slice(0, 10).map((r) => r.pCell),
      ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']
    );
    assert.deepEqual(
      allRows.map((r) => r.pCell),
      ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14']
    );

    const numberByMatchId = new Map(allRows.map((r) => [r.matchId, r.pCell]));

    // Filtrar por Zona A: cada partido conserva su número único identificador
    handlers.zoneFilter(zA.id);
    const zoneARows = extractRenderedMatches(appNode.innerHTML);
    assert.equal(zoneARows.length, 6);
    zoneARows.forEach((r) => {
      assert.equal(r.pCell, numberByMatchId.get(r.matchId));
      assert.doesNotMatch(r.pCell, /^P/);
    });

    // Filtrar por Zona B: numeración única sin colisionar con Zona A
    handlers.zoneFilter(zB.id);
    const zoneBRows = extractRenderedMatches(appNode.innerHTML);
    assert.equal(zoneBRows.length, 6);
    zoneBRows.forEach((r) => {
      assert.equal(r.pCell, numberByMatchId.get(r.matchId));
      assert.doesNotMatch(r.pCell, /^P/);
    });

    // Filtrar por Fase Final: la numeración continúa en 13 y 14 (no reinicia en 1)
    handlers.zoneFilter('ALL');
    handlers.phaseFilter('ZONE_FINAL');
    const finalRows = extractRenderedMatches(appNode.innerHTML);
    assert.equal(finalRows.length, 2);
    assert.deepEqual(finalRows.map((r) => r.pCell), ['13', '14']);
  });
});
