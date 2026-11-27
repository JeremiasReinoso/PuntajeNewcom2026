(function(){
  'use strict';
  var STAGES={GENERAL:'GENERAL',ZONE_FINAL:'ZONE_FINAL',PLAYOFFS:'PLAYOFFS',FINISHED:'FINISHED'},
      LABELS={GENERAL:'Fase de grupos · Zonas',ZONE_FINAL:'Segunda fase',PLAYOFFS:'Cruces finales · Día 3',FINISHED:'Torneo finalizado'},
      FORMATS={ZONES_AND_FINAL:'zonas_y_final',ROUND_ROBIN:'todos_contra_todos',TORNEO_50:'torneo_50',TORNEO_60:'torneo_60',TORNEO_68:'torneo_68'},
      FORMAT_LABELS={
        zonas_y_final:'Zonas clasificatorias + Zona final (+40 / Genérico)',
        todos_contra_todos:'Todos contra todos · Zona única (Genérico)',
        torneo_50:'Categoría +50 · 14 equipos (4 zonas + Interzonal C-D + Cruces)',
        torneo_60:'Categoría +60 · 18 equipos (3 zonas de 6 + Triangulares + Cruces)',
        torneo_68:'Categoría +68 · 8 equipos (Zona única + Semifinales y Final)'
      },
      ZONE_PHASES={QUALIFYING:'clasificatoria',FINAL:'final',CHAMPIONSHIP:'campeonato',STIMULUS:'estimulo',PLACEMENT:'posicion'},
      ZONE_PHASE_LABELS={clasificatoria:'Fase de grupos',final:'Fase final',campeonato:'Ronda Campeonato',estimulo:'Ronda Estímulo',posicion:'Triangular · Posiciones'},
      STATUS={ACTIVE:'ACTIVE',QUALIFIED:'QUALIFIED',ELIMINATED:'ELIMINATED',CHAMPION:'CHAMPION',RUNNER_UP:'RUNNER_UP'},
      STATUS_LABELS={ACTIVE:'Activo',QUALIFIED:'Clasificado',ELIMINATED:'Eliminado',CHAMPION:'Campeón',RUNNER_UP:'Subcampeón'},
      ZONE_STATUS={CONFIGURING:'CONFIGURING',IN_PROGRESS:'IN_PROGRESS',PENDING_CLOSE:'PENDING_CLOSE',FINISHED:'FINISHED'},
      ZONE_STATUS_LABELS={CONFIGURING:'Configurando zonas',IN_PROGRESS:'En juego',PENDING_CLOSE:'Lista para cerrar',FINISHED:'Finalizada'},
      MATCH_TYPES={ZONE:'ZONE',INTERZONAL:'INTERZONAL',PLAYOFF:'PLAYOFF'},
      DEFAULT_TEAMS_68=['Los Nahuel','Águilas Doradas','Toninas','Unidos por el Newcom','Newen','Abrojal','Dubke Ñucom','Corsarios'],
      TORNEO_50_SPEC=[{code:'A',name:'Zona A',targetTeams:4},{code:'B',name:'Zona B',targetTeams:4},{code:'C',name:'Zona C',targetTeams:3},{code:'D',name:'Zona D',targetTeams:3}],
      TORNEO_60_SPEC=[{code:'A',name:'Zona A',targetTeams:6},{code:'B',name:'Zona B',targetTeams:6},{code:'C',name:'Zona C',targetTeams:6}],
      INTERZONAL_LOADER_ID='__INTERZONAL__',
      PLAYOFFS_LOADER_ID='__PLAYOFFS__',
      KEY='puntaje-newcom-state';

  var app=document.getElementById('app'),modal=document.getElementById('modal'),state,view='home',theme='light',matchPhaseFilter='ALL',matchZoneFilter='ALL',toastState=null,loaderDraft=null,interzonalDraft=null;

  function empty(){return{categories:[],teams:[],matchResults:[],selectedCategoryId:null,theme:'light'};}
  function uid(prefix){return prefix+'-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8);}
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'})[c];});}
  function initial(v){return(String(v||'').trim().charAt(0)||'?').toUpperCase();}
  function isStage(v){return Object.keys(STAGES).some(function(k){return STAGES[k]===v;});}
  function isStatus(v){return Object.keys(STATUS).some(function(k){return STATUS[k]===v;});}
  function isZonePhase(v){return Object.keys(ZONE_PHASES).some(function(k){return ZONE_PHASES[k]===v;});}
  function isMatchType(v){return Object.keys(MATCH_TYPES).some(function(k){return MATCH_TYPES[k]===v;});}
  function inferFormat(name){return/\+\s*(?:60|68)(?!\d)/i.test(String(name||''))?FORMATS.ROUND_ROBIN:FORMATS.ZONES_AND_FINAL;}
  function normalizeFormat(fmt,name){
    if(fmt===FORMATS.TORNEO_50||fmt===FORMATS.TORNEO_60||fmt===FORMATS.TORNEO_68)return fmt;
    if(fmt===FORMATS.ROUND_ROBIN||fmt==='SINGLE_ZONE')return FORMATS.ROUND_ROBIN;
    if(fmt===FORMATS.ZONES_AND_FINAL||fmt==='ZONES')return FORMATS.ZONES_AND_FINAL;
    return inferFormat(name);
  }
  function isTorneo50(c){return Boolean(c&&c.format===FORMATS.TORNEO_50);}
  function isTorneo60(c){return Boolean(c&&c.format===FORMATS.TORNEO_60);}
  function isTorneo68(c){return Boolean(c&&c.format===FORMATS.TORNEO_68);}
  function hasPlayoffsFormat(c){return isTorneo50(c)||isTorneo60(c)||isTorneo68(c);}
  function isSingleZoneCategory(c){return Boolean(c&&(c.format===FORMATS.ROUND_ROBIN||c.format===FORMATS.TORNEO_68));}
  function categoryStageLabel(c){
    if(!c)return'';
    if(c.currentStage===STAGES.FINISHED)return LABELS.FINISHED;
    if(isTorneo68(c)){
      var po68=computePlayoffs(c);
      if(po68.unlocked)return'Zona única + Cruces finales (+68)';
      return'Zona única · 8 equipos (+68)';
    }
    if(c.format===FORMATS.ROUND_ROBIN)return'Zona única · Todos contra todos';
    if(isTorneo50(c)){
      if(c.currentStage===STAGES.GENERAL)return'Fase 1 · 4 Zonas + Interzonal C-D';
      var po50=computePlayoffs(c);
      return po50.unlocked?'Fase 2 y 3 · Campeonato / Estímulo / Cruces':'Fase 2 · Zonas 1, 2 y 3';
    }
    if(isTorneo60(c)){
      if(c.currentStage===STAGES.GENERAL)return'Fase 1 · 3 Zonas de 6 equipos';
      var po60=computePlayoffs(c);
      return po60.unlocked?'Fase 2 y 3 · Triangulares y Cruces':'Fase 2 · Triangulares Zonas 1–6';
    }
    return LABELS[c.currentStage]||LABELS.GENERAL;
  }
  function calculateTeamTotal(team){return team.scoreEntries.reduce(function(total,entry){return total+entry.points;},0);}
  function calculateTeamStageTotal(team,stage){return team.scoreEntries.filter(function(entry){return !stage||entry.stage===stage;}).reduce(function(total,entry){return total+entry.points;},0);}
  function normalizeEntry(entry,fallbackStage){var points=Number(entry&&entry.points);if(!Number.isInteger(points)||points<0)return null;return{id:typeof entry.id==='string'&&entry.id?entry.id:uid('score'),points:points,createdAt:typeof entry.createdAt==='string'?entry.createdAt:new Date().toISOString(),stage:isStage(entry.stage)?entry.stage:fallbackStage};}
  function normalizeSet(set){if(!set||typeof set!=='object'||set.a===''||set.b===''||set.a===null||set.b===null||typeof set.a==='boolean'||typeof set.b==='boolean')return null;var a=Number(set.a),b=Number(set.b);if(!Number.isInteger(a)||!Number.isInteger(b)||a<0||b<0||a===b)return null;return{a:a,b:b};}
  function normalizeSets(sets){return Array.isArray(sets)?sets.map(normalizeSet).filter(Boolean):[];}
  function setWinnerCount(sets){return sets.reduce(function(count,set){return{a:count.a+(set.a>set.b?1:0),b:count.b+(set.b>set.a?1:0)};},{a:0,b:0});}
  function normalizeScore(score){if(score==='2-0'||score==='0-2')return'2-0';if(score==='2-1'||score==='1-2')return'2-1';return null;}
  function resolveMatchScore(match){
    if(!match)return null;
    var canonical=normalizeScore(match.score);
    var rawSets=Array.isArray(match.sets)?match.sets:[];
    var sets=normalizeSets(rawSets);
    if(rawSets.length>0&&sets.length===rawSets.length){
      var wins=setWinnerCount(sets);
      if(wins.a===2&&(wins.b===0||wins.b===1)&&sets.length===2+wins.b){
        var derived='2-'+wins.b;
        if(!canonical||canonical===derived)return derived;
      }
    }
    return canonical;
  }
  function matchSetsFor(match){
    if(!match||!Array.isArray(match.sets)||!match.sets.length)return[];
    var sets=normalizeSets(match.sets);
    if(sets.length!==match.sets.length)return[];
    var wins=setWinnerCount(sets),score=normalizeScore(match.score);
    if((score==='2-0'&&sets.length!==2)||(score==='2-1'&&sets.length!==3)||wins.a!==2||wins.b!==(score==='2-1'?1:0))return[];
    if(sets.length===3){
      var firstTwo=setWinnerCount(sets.slice(0,2));
      if(firstTwo.a!==1||firstTwo.b!==1)return[];
    }
    return sets;
  }
  function validateMatchSets(sets){
    if(!Array.isArray(sets))throw Error('Ingresá 2 sets para un 2–0 o 3 sets para un 2–1.');
    var normalized=normalizeSets(sets),wins=setWinnerCount(normalized);
    if(normalized.length!==sets.length||!(normalized.length===2||normalized.length===3))throw Error('Ingresá 2 sets para un 2–0 o 3 sets para un 2–1.');
    if(wins.a===wins.b||Math.max(wins.a,wins.b)!==2||Math.min(wins.a,wins.b)>(normalized.length===2?0:1))throw Error('Los marcadores no coinciden con un resultado válido 2–0 o 2–1.');
    if(normalized.length===3){
      var firstTwo=setWinnerCount(normalized.slice(0,2));
      if(firstTwo.a!==1||firstTwo.b!==1)throw Error('Los marcadores no coinciden con un resultado válido 2–0 o 2–1.');
    }
    return normalized;
  }
  // Sistema oficial: ganador siempre 3 pts (2-0 o 2-1); perdedor 1 pt (0-2) o 2 pts (1-2).
  var SCORE_POINTS=Object.freeze({'2-0':Object.freeze({winner:3,loser:1}),'2-1':Object.freeze({winner:3,loser:2})});
  function resultPoints(score){
    var canonical=normalizeScore(score);
    if(!canonical)throw Error('El resultado debe ser 2–0 o 2–1.');
    var pts=SCORE_POINTS[canonical];
    return{winner:pts.winner,loser:pts.loser};
  }
  function matchPointsForTeam(match,teamId){
    if(!match||match.archived||!teamId||match.winnerId===match.loserId)return 0;
    if(match.winnerId!==teamId&&match.loserId!==teamId)return 0;
    var score=resolveMatchScore(match);
    if(!score)return 0;
    var pts=resultPoints(score);
    return match.winnerId===teamId?pts.winner:pts.loser;
  }
  function emptyCarriedStats(){
    return{classificationPoints:0,resultCount:0,wins:0,losses:0,won20:0,won21:0,lost02:0,lost12:0,setWins:0,setLosses:0,pointsFor:0,pointsAgainst:0,difference:0,setRatio:0,ptosRatio:0};
  }
  function nonNegativeInt(v){var n=Number(v);return Number.isInteger(n)&&n>=0?n:0;}
  function computeSetRatio(sw,sl){return sl>0?(sw/sl):(sw>0?1000+sw:0);}
  function computePointsRatio(pf,pa){return pa>0?(pf/pa):(pf>0?1000+pf:0);}
  function normalizeCarriedStats(raw){
    if(!raw||typeof raw!=='object')return emptyCarriedStats();
    var sw=nonNegativeInt(raw.setWins),sl=nonNegativeInt(raw.setLosses),pf=nonNegativeInt(raw.pointsFor),pa=nonNegativeInt(raw.pointsAgainst);
    var wins=nonNegativeInt(raw.wins),losses=nonNegativeInt(raw.losses);
    return{
      classificationPoints:nonNegativeInt(raw.classificationPoints),
      resultCount:Math.max(nonNegativeInt(raw.resultCount),wins+losses),
      wins:wins,losses:losses,
      won20:nonNegativeInt(raw.won20),won21:nonNegativeInt(raw.won21),
      lost02:nonNegativeInt(raw.lost02),lost12:nonNegativeInt(raw.lost12),
      setWins:sw,setLosses:sl,pointsFor:pf,pointsAgainst:pa,
      difference:pf-pa,setRatio:computeSetRatio(sw,sl),ptosRatio:computePointsRatio(pf,pa)
    };
  }
  function toCarriedStats(row){return(!row||typeof row!=='object')?emptyCarriedStats():normalizeCarriedStats(row);}
  function computeTeamStatsFromMatches(teamId,matches,baseline){
    var base=baseline?normalizeCarriedStats(baseline):null;
    var scoped=(Array.isArray(matches)?matches:[]).filter(function(r){
      return r&&!r.archived&&(r.winnerId===teamId||r.loserId===teamId)&&Boolean(resolveMatchScore(r));
    });
    var classificationPoints=base?base.classificationPoints:0;
    var wins=base?base.wins:0,losses=base?base.losses:0,won20=base?base.won20:0,won21=base?base.won21:0,lost02=base?base.lost02:0,lost12=base?base.lost12:0;
    var setWins=base?base.setWins:0,setLosses=base?base.setLosses:0,pointsFor=base?base.pointsFor:0,pointsAgainst=base?base.pointsAgainst:0;
    scoped.forEach(function(m){
      var isWinner=m.winnerId===teamId,sc=resolveMatchScore(m);
      classificationPoints+=matchPointsForTeam(m,teamId);
      if(isWinner){
        wins+=1;setWins+=2;
        if(sc==='2-1'){won21+=1;setLosses+=1;}else{won20+=1;}
      }else{
        losses+=1;setLosses+=2;
        if(sc==='2-1'){lost12+=1;setWins+=1;}else{lost02+=1;}
      }
      matchSetsFor(m).forEach(function(set){
        pointsFor+=isWinner?set.a:set.b;
        pointsAgainst+=isWinner?set.b:set.a;
      });
    });
    return{
      resultCount:(base?base.resultCount:0)+scoped.length,
      wins:wins,losses:losses,won20:won20,won21:won21,lost02:lost02,lost12:lost12,
      classificationPoints:classificationPoints,pointsFor:pointsFor,pointsAgainst:pointsAgainst,
      difference:pointsFor-pointsAgainst,setWins:setWins,setLosses:setLosses,
      setRatio:computeSetRatio(setWins,setLosses),ptosRatio:computePointsRatio(pointsFor,pointsAgainst)
    };
  }
  function teamGeneralMatchesList(categoryId,teamId,sourceZoneId,sourceMatches){
    return(sourceMatches||state.matchResults).filter(function(r){
      if(!r||r.archived||r.categoryId!==categoryId||r.stage!==STAGES.GENERAL)return false;
      if(r.winnerId!==teamId&&r.loserId!==teamId)return false;
      if(r.matchType===MATCH_TYPES.INTERZONAL)return true;
      return!sourceZoneId||!r.zoneId||r.zoneId===sourceZoneId;
    });
  }
  function syncCategoryCarriedStats(c,sourceMatches){
    if(!c||isSingleZoneCategory(c))return;
    var f=c.zoneTournament;
    if(!f||!Array.isArray(f.qualified)||!f.qualified.length)return;
    f.qualified.forEach(function(q){
      var generalMatches=teamGeneralMatchesList(c.id,q.teamId,q.sourceZoneId,sourceMatches);
      q.carriedStats=toCarriedStats(computeTeamStatsFromMatches(q.teamId,generalMatches,null));
    });
  }
  function defaultInterzonals(){return[{slot:1,teamCId:null,teamDId:null},{slot:2,teamCId:null,teamDId:null},{slot:3,teamCId:null,teamDId:null}];}
  function normalizeInterzonals(source,teamIds){
    var raw=Array.isArray(source)?source:[],bySlot={},usedC={},usedD={};
    raw.forEach(function(item){
      if(!item||(item.slot!==1&&item.slot!==2&&item.slot!==3))return;
      var cId=typeof item.teamCId==='string'&&teamIds[item.teamCId]&&!usedC[item.teamCId]?item.teamCId:null;
      var dId=typeof item.teamDId==='string'&&teamIds[item.teamDId]&&!usedD[item.teamDId]&&item.teamDId!==cId?item.teamDId:null;
      if(cId&&dId){usedC[cId]=true;usedD[dId]=true;bySlot[item.slot]={slot:item.slot,teamCId:cId,teamDId:dId};}
      else{bySlot[item.slot]={slot:item.slot,teamCId:null,teamDId:null};}
    });
    return[1,2,3].map(function(slot){return bySlot[slot]||{slot:slot,teamCId:null,teamDId:null};});
  }
  function normalizeTieBreaks(source){
    return Array.isArray(source)?source.filter(function(item){
      return item&&typeof item.scope==='string'&&typeof item.signature==='string'&&Array.isArray(item.order)&&item.order.every(function(id){return typeof id==='string';});
    }).map(function(item){return{scope:item.scope,signature:item.signature,order:item.order.slice(),createdAt:item.createdAt||null};}):[];
  }

  function normalize(raw){
    if(!raw||typeof raw!=='object')return empty();
    var categories=Array.isArray(raw.categories)?raw.categories:[],categoryIds={};
    categories=categories.filter(function(c){
      if(!c||typeof c.id!=='string'||!c.id||c.id==='demo-cat-50'||typeof c.name!=='string'||!c.name.trim()||categoryIds[c.id])return false;
      categoryIds[c.id]=true;
      return true;
    }).map(function(c){
      var source=c.zoneTournament||{};
      var hasSecondStage=typeof source.secondStageZoneId==='string'&&Boolean(source.secondStageZoneId);
      var fmt=normalizeFormat(c.format,c.name);
      if(!c.format&&fmt===FORMATS.ROUND_ROBIN&&Array.isArray(source.zones)&&source.zones.length>1){
        fmt=FORMATS.ZONES_AND_FINAL;
      }
      var stage=c.currentStage===STAGES.FINISHED?STAGES.FINISHED:(fmt===FORMATS.ROUND_ROBIN||fmt===FORMATS.TORNEO_68||c.currentStage===STAGES.ZONE_FINAL||hasSecondStage?(c.currentStage===STAGES.PLAYOFFS?STAGES.PLAYOFFS:STAGES.ZONE_FINAL):(c.currentStage===STAGES.PLAYOFFS?STAGES.PLAYOFFS:STAGES.GENERAL));
      return{id:c.id,name:c.name.trim(),format:fmt,currentStage:stage,championId:typeof c.championId==='string'?c.championId:null,runnerUpId:typeof c.runnerUpId==='string'?c.runnerUpId:null,zoneTournament:c.zoneTournament||null};
    });
    var seen={},sourceTeams=Array.isArray(raw.teams)?raw.teams:[],legacyResults=Array.isArray(raw.results)?raw.results:[],sourceMatches=Array.isArray(raw.matchResults)?raw.matchResults:[];
    var teams=sourceTeams.filter(function(t){return t&&typeof t.id==='string'&&t.id&&!seen[t.id]&&typeof t.name==='string'&&t.name.trim()&&typeof t.categoryId==='string'&&categoryIds[t.categoryId];}).map(function(t){
      seen[t.id]=true;
      var stage=isStage(t.stage)?t.stage:STAGES.GENERAL;
      var sourceEntries=Array.isArray(t.scoreEntries)?t.scoreEntries:legacyResults.filter(function(r){return r&&r.teamId===t.id;});
      return{id:t.id,name:t.name.trim(),categoryId:t.categoryId,status:isStatus(t.status)?t.status:STATUS.ACTIVE,stage:stage,scoreEntries:sourceEntries.map(function(e){return normalizeEntry(e,stage);}).filter(Boolean)};
    });
    var selected=typeof raw.selectedCategoryId==='string'&&categoryIds[raw.selectedCategoryId]?raw.selectedCategoryId:(categories[0]?categories[0].id:null);
    var teamIds=seen,matchIds={};
    var matchResults=sourceMatches.filter(function(r){return r&&typeof r.id==='string'&&r.id&&!matchIds[r.id]&&categoryIds[r.categoryId]&&teamIds[r.winnerId]&&teamIds[r.loserId]&&r.winnerId!==r.loserId&&Boolean(resolveMatchScore(r));}).map(function(r){
      matchIds[r.id]=true;
      var score=resolveMatchScore(r);
      var sets=matchSetsFor({score:score,sets:r.sets});
      var stage=isStage(r.stage)?r.stage:STAGES.GENERAL;
      var item={id:r.id,categoryId:r.categoryId,winnerId:r.winnerId,loserId:r.loserId,score:score,sets:sets.length?sets:[],stage:stage,zoneId:typeof r.zoneId==='string'?r.zoneId:null,createdAt:typeof r.createdAt==='string'?r.createdAt:new Date().toISOString()};
      if(isMatchType(r.matchType))item.matchType=r.matchType;
      if(r.interzonalSlot===1||r.interzonalSlot===2||r.interzonalSlot===3)item.interzonalSlot=r.interzonalSlot;
      if(typeof r.bracketId==='string'&&r.bracketId)item.bracketId=r.bracketId;
      if(typeof r.bracketLabel==='string'&&r.bracketLabel)item.bracketLabel=r.bracketLabel;
      if(typeof r.updatedAt==='string')item.updatedAt=r.updatedAt;
      if(r.archived===true)item.archived=true;
      return item;
    });
    var normalizedCategories=categories.map(function(c){
      var source=c.zoneTournament||{};
      var secondStageId=typeof source.secondStageZoneId==='string'?source.secondStageZoneId:null;
      var zones=Array.isArray(source.zones)?source.zones.filter(function(z){return z&&typeof z.id==='string'&&z.id&&typeof z.name==='string'&&z.name.trim();}).map(function(z){
        var phase=isZonePhase(z.phase)?z.phase:((z.id===secondStageId||c.format===FORMATS.ROUND_ROBIN||c.format===FORMATS.TORNEO_68)?ZONE_PHASES.FINAL:ZONE_PHASES.QUALIFYING);
        var nz={id:z.id,name:z.name.trim(),phase:phase,teamIds:Array.isArray(z.teamIds)?z.teamIds.filter(function(id){return teamIds[id];}):[]};
        if(typeof z.code==='string'&&z.code)nz.code=z.code;
        if(Number.isInteger(z.targetTeams)&&z.targetTeams>0)nz.targetTeams=z.targetTeams;
        return nz;
      }):[];
      var hasSecond=Boolean(secondStageId||zones.some(function(z){return z.phase!==ZONE_PHASES.QUALIFYING;}));
      return Object.assign(c,{zoneTournament:{
        status:Object.keys(ZONE_STATUS).some(function(k){return ZONE_STATUS[k]===source.status;})?source.status:(zones.length?ZONE_STATUS.IN_PROGRESS:ZONE_STATUS.CONFIGURING),
        firstStageStatus:(c.format===FORMATS.ROUND_ROBIN||c.format===FORMATS.TORNEO_68)?'SKIPPED':(source.firstStageStatus==='FINISHED'||hasSecond?'FINISHED':(source.firstStageStatus||'CONFIGURING')),
        secondStageStatus:(c.format===FORMATS.ROUND_ROBIN||c.format===FORMATS.TORNEO_68)||source.secondStageStatus==='IN_PROGRESS'||hasSecond?'IN_PROGRESS':(source.secondStageStatus||null),
        zones:zones,
        secondStageZoneId:secondStageId,
        qualified:Array.isArray(source.qualified)?source.qualified.filter(function(q){return q&&teamIds[q.teamId]&&typeof q.sourceZoneId==='string';}).map(function(q){
          var entry={teamId:q.teamId,sourceZoneId:q.sourceZoneId,position:Number.isInteger(q.position)?q.position:null};
          if(typeof q.sourceCode==='string'&&q.sourceCode)entry.sourceCode=q.sourceCode;
          if(q.carriedStats&&typeof q.carriedStats==='object')entry.carriedStats=normalizeCarriedStats(q.carriedStats);
          return entry;
        }):[],
        interzonals:normalizeInterzonals(source.interzonals,teamIds),
        confirmedAt:source.confirmedAt||null,
        tieBreaks:normalizeTieBreaks(source.tieBreaks)
      }});
    });
    normalizedCategories.forEach(function(c){
      var f=c.zoneTournament;
      f.zones=f.zones.map(function(z){return Object.assign(z,{teamIds:z.teamIds.filter(function(id){return teams.some(function(t){return t.id===id&&t.categoryId===c.id;});})});});
      if(isSingleZoneCategory(c)){
        var finalZone=f.secondStageZoneId?f.zones.filter(function(z){return z.id===f.secondStageZoneId;})[0]:f.zones[0];
        if(!finalZone){
          finalZone={id:uid('zone'),code:'U',name:'Zona única',phase:ZONE_PHASES.FINAL,teamIds:[]};
          if(isTorneo68(c))finalZone.targetTeams=8;
          f.zones=[finalZone];
        }else{
          finalZone.phase=ZONE_PHASES.FINAL;
          if(isTorneo68(c)){finalZone.code='U';finalZone.targetTeams=8;}
          f.zones=[finalZone];
        }
        f.secondStageZoneId=finalZone.id;
        f.status=ZONE_STATUS.IN_PROGRESS;
        f.firstStageStatus='SKIPPED';
        f.secondStageStatus='IN_PROGRESS';
        if(c.currentStage!==STAGES.FINISHED&&c.currentStage!==STAGES.PLAYOFFS)c.currentStage=STAGES.ZONE_FINAL;
        teams.filter(function(t){return t.categoryId===c.id;}).forEach(function(t){
          if(finalZone.teamIds.indexOf(t.id)<0)finalZone.teamIds.push(t.id);
          t.stage=STAGES.ZONE_FINAL;
          if(t.status===STATUS.ELIMINATED)t.status=STATUS.ACTIVE;
        });
        matchResults.filter(function(r){return r.categoryId===c.id&&r.matchType!==MATCH_TYPES.PLAYOFF&&r.stage!==STAGES.PLAYOFFS;}).forEach(function(r){
          r.stage=STAGES.ZONE_FINAL;
          r.zoneId=finalZone.id;
        });
      }else{
        var initZones=f.zones.filter(function(z){return z.id!==f.secondStageZoneId&&z.phase===ZONE_PHASES.QUALIFYING;});
        if(c.currentStage===STAGES.GENERAL&&initZones.length===1){
          var onlyZone=initZones[0];
          teams.filter(function(t){return t.categoryId===c.id;}).forEach(function(t){
            if(onlyZone.teamIds.indexOf(t.id)<0)onlyZone.teamIds.push(t.id);
          });
        }
        var secondZoneIds={};
        f.zones.filter(function(z){return z.id===f.secondStageZoneId||z.phase!==ZONE_PHASES.QUALIFYING;}).forEach(function(z){secondZoneIds[z.id]=true;});
        matchResults.filter(function(r){return r.categoryId===c.id&&r.matchType!==MATCH_TYPES.INTERZONAL&&r.matchType!==MATCH_TYPES.PLAYOFF;}).forEach(function(r){
          if(r.zoneId&&secondZoneIds[r.zoneId])r.stage=STAGES.ZONE_FINAL;
          else if(!r.zoneId&&initZones.length===1){r.zoneId=initZones[0].id;r.stage=STAGES.GENERAL;}
        });
        if(f.qualified.length){
          f.qualified.forEach(function(q){
            var generalMatches=teamGeneralMatchesList(c.id,q.teamId,q.sourceZoneId,matchResults);
            if(generalMatches.length>0||!q.carriedStats){
              q.carriedStats=toCarriedStats(computeTeamStatsFromMatches(q.teamId,generalMatches,null));
            }
          });
        }
      }
    });
    return{categories:normalizedCategories,teams:teams,matchResults:matchResults,selectedCategoryId:selected,theme:raw.theme==='dark'?'dark':'light'};
  }

  function canUseDiskApi(){
    return typeof window!=='undefined'&&Boolean(window.location)&&/^https?:$/i.test(String(window.location.protocol||''))&&typeof XMLHttpRequest==='function';
  }
  function fetchDiskState(){
    if(!canUseDiskApi())return null;
    try{
      var xhr=new XMLHttpRequest();
      xhr.open('GET','/api/state?_='+Date.now(),false);
      xhr.setRequestHeader('Accept','application/json');
      xhr.send(null);
      if(xhr.status>=200&&xhr.status<300&&xhr.responseText){
        var payload=JSON.parse(xhr.responseText);
        if(payload&&payload.ok)return payload;
      }
    }catch(e){
      console.warn('No se pudo consultar el almacenamiento persistente local.',e);
    }
    return null;
  }
  function pushDiskState(currentState,reason){
    if(!canUseDiskApi())return false;
    try{
      var xhr=new XMLHttpRequest();
      xhr.open('POST','/api/state',false);
      xhr.setRequestHeader('Content-Type','application/json');
      xhr.send(JSON.stringify({state:currentState,reason:reason||'save'}));
      return xhr.status>=200&&xhr.status<300;
    }catch(e){
      console.warn('No se pudo guardar en el almacenamiento persistente local.',e);
      return false;
    }
  }
  function createDiskBackup(label){
    if(!canUseDiskApi())throw Error('El servicio de copias de seguridad en disco no está activo.');
    var xhr=new XMLHttpRequest();
    xhr.open('POST','/api/backups/create',false);
    xhr.setRequestHeader('Content-Type','application/json');
    xhr.send(JSON.stringify({label:label||''}));
    var payload=xhr.responseText?JSON.parse(xhr.responseText):null;
    if(!payload||!payload.ok)throw Error((payload&&payload.error)||'No se pudo crear la copia de seguridad.');
    return payload.backup;
  }
  function listDiskBackups(){
    if(!canUseDiskApi())return[];
    var xhr=new XMLHttpRequest();
    xhr.open('GET','/api/backups?_='+Date.now(),false);
    xhr.setRequestHeader('Accept','application/json');
    xhr.send(null);
    var payload=xhr.responseText?JSON.parse(xhr.responseText):null;
    return payload&&payload.ok&&Array.isArray(payload.backups)?payload.backups:[];
  }
  function restoreDiskBackup(backupName,confirmed){
    if(!canUseDiskApi())throw Error('El servicio de copias de seguridad en disco no está activo.');
    if(!confirmed){
      if(typeof confirm!=='function'||!confirm('¿Confirmás restaurar la copia de seguridad "'+backupName+'"? Se guardará automáticamente un respaldo previo de los datos actuales.'))return null;
    }
    var xhr=new XMLHttpRequest();
    xhr.open('POST','/api/backups/restore',false);
    xhr.setRequestHeader('Content-Type','application/json');
    xhr.send(JSON.stringify({backup:backupName,confirm:true}));
    var payload=xhr.responseText?JSON.parse(xhr.responseText):null;
    if(!payload||!payload.ok)throw Error((payload&&payload.error)||'No se pudo restaurar la copia de seguridad.');
    state=loadState();
    render();
    return payload;
  }

  function loadState(){
    var diskPayload=fetchDiskState();
    if(diskPayload&&diskPayload.exists&&diskPayload.state&&typeof diskPayload.state==='object'){
      try{
        var diskNormalized=normalize(diskPayload.state);
        try{localStorage.setItem(KEY,JSON.stringify(diskNormalized));}catch(ignored){}
        if(JSON.stringify(diskPayload.state)!==JSON.stringify(diskNormalized)){
          pushDiskState(diskNormalized,'normalize');
        }
        return diskNormalized;
      }catch(e){
        console.warn('No se pudo normalizar el estado persistente en disco; intentando localStorage.',e);
      }
    }
    var raw=null;
    try{
      raw=localStorage.getItem(KEY);
      if(!raw){
        var emptyInitial=empty();
        if(diskPayload&&!diskPayload.exists)pushDiskState(emptyInitial,'init');
        return emptyInitial;
      }
      var parsed=JSON.parse(raw),normalized=normalize(parsed);
      if(JSON.stringify(parsed)!==JSON.stringify(normalized)){
        try{
          var prevVer=parsed&&Number.isInteger(parsed.schemaVersion)?parsed.schemaVersion:1;
          var bKey=KEY+'.backup-v'+prevVer;
          if(!localStorage.getItem(bKey))localStorage.setItem(bKey,raw);
        }catch(ignored){}
        localStorage.setItem(KEY,JSON.stringify(normalized));
      }
      if(diskPayload&&!diskPayload.exists)pushDiskState(normalized,'migrate-localstorage');
      return normalized;
    }catch(e){
      console.warn('No se pudo leer localStorage; se inició vacío.',e);
      if(raw){
        try{localStorage.setItem(KEY+'.corrupt-'+Date.now(),raw);}catch(ignored){}
      }
      return empty();
    }
  }
  function saveState(){
    var savedLocal=false,savedDisk=false;
    try{localStorage.setItem(KEY,JSON.stringify(state));savedLocal=true;}catch(e){console.warn('No se pudo guardar localStorage.',e);}
    if(canUseDiskApi()){savedDisk=pushDiskState(state,'save');}
    return savedDisk||savedLocal;
  }
  function category(){return state.categories.filter(function(c){return c.id===state.selectedCategoryId;})[0]||null;}
  function teams(categoryId){return state.teams.filter(function(t){return t.categoryId===categoryId;});}
  function teamById(id){return state.teams.filter(function(t){return t.id===id;})[0]||null;}
  function active(categoryId){return teams(categoryId).filter(function(t){return t.status===STATUS.ACTIVE||t.status===STATUS.QUALIFIED;});}
  function categoryEntries(categoryId){return teams(categoryId).reduce(function(all,team){return all.concat(team.scoreEntries.map(function(entry){return{team:team,entry:entry};}));},[]);}

  function selectCategory(id,next){
    if(!state.categories.some(function(c){return c.id===id;}))throw Error('Categoría inexistente.');
    state.selectedCategoryId=id;
    loaderDraft=null;
    interzonalDraft=null;
    toastState=null;
    saveState();
    if(next)view=next;
    render();
  }
  function createCategory(name,format,opts){
    name=String(name||'').trim();
    if(!name)throw Error('La categoría necesita un nombre.');
    var fmt=normalizeFormat(format,name);
    var isSingle=fmt===FORMATS.ROUND_ROBIN||fmt===FORMATS.TORNEO_68;
    var singleZone=isSingle?{id:uid('zone'),code:'U',name:'Zona única',phase:ZONE_PHASES.FINAL,teamIds:[]}:null;
    if(singleZone&&fmt===FORMATS.TORNEO_68)singleZone.targetTeams=8;
    var initZones=[];
    if(fmt===FORMATS.TORNEO_50){
      initZones=TORNEO_50_SPEC.map(function(s){return{id:uid('zone'),code:s.code,name:s.name,phase:ZONE_PHASES.QUALIFYING,targetTeams:s.targetTeams,teamIds:[]};});
    }else if(fmt===FORMATS.TORNEO_60){
      initZones=TORNEO_60_SPEC.map(function(s){return{id:uid('zone'),code:s.code,name:s.name,phase:ZONE_PHASES.QUALIFYING,targetTeams:s.targetTeams,teamIds:[]};});
    }
    var c={
      id:uid('cat'),name:name,format:fmt,
      currentStage:isSingle?STAGES.ZONE_FINAL:STAGES.GENERAL,
      championId:null,runnerUpId:null,
      zoneTournament:{
        status:isSingle||initZones.length?ZONE_STATUS.IN_PROGRESS:ZONE_STATUS.CONFIGURING,
        firstStageStatus:isSingle?'SKIPPED':(initZones.length?'IN_PROGRESS':'CONFIGURING'),
        secondStageStatus:isSingle?'IN_PROGRESS':null,
        zones:isSingle?[singleZone]:initZones,
        secondStageZoneId:isSingle?singleZone.id:null,
        qualified:[],
        interzonals:defaultInterzonals(),
        confirmedAt:null,
        tieBreaks:[]
      }
    };
    state.categories.push(c);
    state.selectedCategoryId=c.id;
    if(fmt===FORMATS.TORNEO_68&&opts&&opts.preloadTeams68){
      DEFAULT_TEAMS_68.forEach(function(teamName){
        var t={id:uid('team'),name:teamName,categoryId:c.id,status:STATUS.ACTIVE,stage:STAGES.ZONE_FINAL,scoreEntries:[]};
        state.teams.push(t);
        singleZone.teamIds.push(t.id);
      });
    }
    loaderDraft=null;
    interzonalDraft=null;
    saveState();
    return c;
  }
  function preloadTeams68(){
    var c=category();
    if(!c||!isTorneo68(c))throw Error('Esta opción solo aplica a Categoría +68.');
    var z=finalZoneOf(c);
    if(!z||z.teamIds.length>0)throw Error('La Zona única ya tiene equipos cargados.');
    var created=DEFAULT_TEAMS_68.map(function(teamName){
      var t={id:uid('team'),name:teamName,categoryId:c.id,status:STATUS.ACTIVE,stage:STAGES.ZONE_FINAL,scoreEntries:[]};
      state.teams.push(t);
      z.teamIds.push(t.id);
      return t;
    });
    loaderDraft=null;
    saveState();
    return created;
  }
  function editCategory(id,name){
    var c=state.categories.filter(function(x){return x.id===id;})[0];
    name=String(name||'').trim();
    if(!c)throw Error('Categoría inexistente.');
    if(!name)throw Error('La categoría necesita un nombre.');
    c.name=name;
    saveState();
  }
  function deleteCategory(id){
    if(!state.categories.some(function(c){return c.id===id;}))throw Error('Categoría inexistente.');
    state.categories=state.categories.filter(function(c){return c.id!==id;});
    state.teams=state.teams.filter(function(t){return t.categoryId!==id;});
    state.matchResults=state.matchResults.filter(function(r){return r.categoryId!==id;});
    state.selectedCategoryId=state.categories[0]?state.categories[0].id:null;
    loaderDraft=null;
    interzonalDraft=null;
    toastState=null;
    saveState();
  }
  function zoneTargetTeams(c,z){
    if(!c||!z)return null;
    if(typeof z.targetTeams==='number'&&z.targetTeams>0)return z.targetTeams;
    if(isTorneo50(c)){
      var found=TORNEO_50_SPEC.filter(function(s){return s.code===z.code||s.name.toLowerCase()===z.name.toLowerCase();})[0];
      if(found)return found.targetTeams;
      if(z.code==='1'||z.code==='2')return 4;
      if(z.code==='3')return 6;
    }
    if(isTorneo60(c))return z.phase===ZONE_PHASES.QUALIFYING?6:3;
    if(isTorneo68(c))return 8;
    return null;
  }
  function createTeam(name,zoneId){
    var c=category();
    name=String(name||'').trim();
    if(!c)throw Error('Seleccioná una categoría.');
    if(!name)throw Error('El equipo necesita un nombre.');
    if(teams(c.id).some(function(t){return t.name.toLowerCase()===name.toLowerCase();}))throw Error('Ya existe un equipo con ese nombre en esta categoría.');
    if(isSingleZoneCategory(c)){
      if(c.currentStage===STAGES.FINISHED)throw Error('El torneo ya finalizó.');
      var finalZ=finalZoneOf(c);
      var cap=zoneTargetTeams(c,finalZ);
      if(cap&&finalZ&&finalZ.teamIds.length>=cap)throw Error(finalZ.name+' admite exactamente '+cap+' equipos.');
      var singleTeam={id:uid('team'),name:name,categoryId:c.id,status:STATUS.ACTIVE,stage:STAGES.ZONE_FINAL,scoreEntries:[]};
      state.teams.push(singleTeam);
      if(finalZ&&finalZ.teamIds.indexOf(singleTeam.id)<0)finalZ.teamIds.push(singleTeam.id);
      loaderDraft=null;
      saveState();
      return singleTeam;
    }
    var initZones=qualifyingZonesOf(c);
    if(!initZones.length)throw Error('Primero tenés que crear al menos una zona clasificatoria.');
    if(c.currentStage!==STAGES.GENERAL)throw Error('No se pueden agregar equipos después de cerrar la fase clasificatoria.');
    var targetZone=zoneId?zoneById(c,zoneId):(initZones.length===1?initZones[0]:null);
    if(zoneId&&(!targetZone||targetZone.phase!==ZONE_PHASES.QUALIFYING))throw Error('La zona clasificatoria seleccionada no existe.');
    var zCap=zoneTargetTeams(c,targetZone);
    if(zCap&&targetZone&&targetZone.teamIds.length>=zCap)throw Error(targetZone.name+' ya completó su cupo de '+zCap+' equipos.');
    var team={id:uid('team'),name:name,categoryId:c.id,status:STATUS.ACTIVE,stage:STAGES.GENERAL,scoreEntries:[]};
    state.teams.push(team);
    if(targetZone&&targetZone.teamIds.indexOf(team.id)<0)targetZone.teamIds.push(team.id);
    loaderDraft=null;
    interzonalDraft=null;
    saveState();
    return team;
  }
  function validateTeamForCurrent(teamId){var c=category(),team=teamById(teamId);if(!c||!team||team.categoryId!==c.id)throw Error('Equipo inválido para esta categoría.');if([STATUS.ELIMINATED,STATUS.CHAMPION,STATUS.RUNNER_UP].indexOf(team.status)>=0)throw Error('Este equipo no puede recibir puntajes.');if(c.currentStage===STAGES.FINISHED)throw Error('El torneo ya finalizó.');return{category:c,team:team};}
  function createScoreEntry(teamId,value){var found=validateTeamForCurrent(teamId),points=Number(value);if(!Number.isInteger(points)||points<0)throw Error('El puntaje debe ser un número entero mayor o igual a 0.');found.team.scoreEntries.push({id:uid('score'),points:points,createdAt:new Date().toISOString(),stage:found.category.currentStage});saveState();}
  function addQuickScores(entries){var c=category();if(!c)throw Error('Seleccioná una categoría.');var pending=[];entries.forEach(function(item){if(item.value===''||item.value===null||typeof item.value==='undefined')return;var team=validateTeamForCurrent(item.teamId),points=Number(item.value);if(!Number.isInteger(points)||points<0)throw Error('Cada puntaje debe ser un número entero mayor o igual a 0.');pending.push({team:team.team,entry:{id:uid('score'),points:points,createdAt:new Date().toISOString(),stage:c.currentStage}});});if(!pending.length)throw Error('Ingresá al menos un puntaje para guardar.');pending.forEach(function(item){item.team.scoreEntries.push(item.entry);});saveState();return pending.length;}
  function deleteScoreEntry(teamId,entryId){var team=teamById(teamId);if(!team||team.categoryId!==state.selectedCategoryId)throw Error('Carga inválida para esta categoría.');var index=team.scoreEntries.findIndex(function(entry){return entry.id===entryId;});if(index<0)throw Error('La carga seleccionada no existe.');var removed=team.scoreEntries.splice(index,1)[0];if(!saveState()){team.scoreEntries.splice(index,0,removed);throw Error('No se pudo guardar la eliminación. La carga permanece intacta.');}return removed;}

  function categoryMatches(categoryId){return state.matchResults.filter(function(r){return r.categoryId===categoryId&&!r.archived;});}
  function zoneFlow(c){return c&&c.zoneTournament?c.zoneTournament:{status:ZONE_STATUS.CONFIGURING,firstStageStatus:'CONFIGURING',secondStageStatus:null,zones:[],secondStageZoneId:null,qualified:[],interzonals:defaultInterzonals(),confirmedAt:null,tieBreaks:[]};}
  function zoneById(c,id){return zoneFlow(c).zones.filter(function(z){return z.id===id;})[0]||null;}
  function zoneByCode(c,code){
    var f=zoneFlow(c);
    return f.zones.filter(function(z){return z.code===code;})[0]||f.zones.filter(function(z){return z.name.toLowerCase()===('zona '+code).toLowerCase();})[0]||null;
  }
  function qualifyingZonesOf(c){
    var f=zoneFlow(c);
    if(isSingleZoneCategory(c))return[];
    return f.zones.filter(function(z){return z.id!==f.secondStageZoneId&&z.phase===ZONE_PHASES.QUALIFYING;});
  }
  function secondStageZonesOf(c){
    var f=zoneFlow(c);
    if(isSingleZoneCategory(c)){var z=finalZoneOf(c);return z?[z]:[];}
    return f.zones.filter(function(z){return z.id===f.secondStageZoneId||z.phase!==ZONE_PHASES.QUALIFYING;});
  }
  function finalZoneOf(c){
    var f=zoneFlow(c);
    if(f.secondStageZoneId)return zoneById(c,f.secondStageZoneId);
    return f.zones.filter(function(z){return z.phase!==ZONE_PHASES.QUALIFYING;})[0]||null;
  }
  function stageForZone(c,zoneId){
    if(c&&!zoneId&&typeof c==='object'&&c.phase){
      return c.phase===ZONE_PHASES.QUALIFYING?STAGES.GENERAL:STAGES.ZONE_FINAL;
    }
    var z=zoneId?(typeof zoneId==='object'?zoneId:zoneById(c,zoneId)):null;
    if(isSingleZoneCategory(c)||(z&&(z.phase!==ZONE_PHASES.QUALIFYING||z.id===zoneFlow(c).secondStageZoneId)))return STAGES.ZONE_FINAL;
    return STAGES.GENERAL;
  }
  function teamZone(c,teamId){return qualifyingZonesOf(c).filter(function(z){return z.teamIds.indexOf(teamId)>=0;})[0]||null;}
  function currentZoneId(c){var f=zoneFlow(c);return c.currentStage===STAGES.ZONE_FINAL?f.secondStageZoneId:null;}
  function isFinalAccumulatedScope(c,stage,zoneId){
    if(!c||isSingleZoneCategory(c))return false;
    var effectiveStage=stage||(zoneId?stageForZone(c,zoneId):undefined);
    if(effectiveStage!==STAGES.ZONE_FINAL)return false;
    if(!zoneId)return secondStageZonesOf(c).length>0;
    return secondStageZonesOf(c).some(function(z){return z.id===zoneId;});
  }
  function qualifiedBaselineMap(c){
    var map={};
    if(!c||isSingleZoneCategory(c))return map;
    var f=zoneFlow(c);
    (f.qualified||[]).forEach(function(q){
      if(!q||!q.teamId)return;
      var generalMatches=teamGeneralMatchesList(c.id,q.teamId,q.sourceZoneId,state.matchResults);
      if(generalMatches.length>0){
        map[q.teamId]=toCarriedStats(computeTeamStatsFromMatches(q.teamId,generalMatches,null));
      }else if(q.carriedStats){
        map[q.teamId]=normalizeCarriedStats(q.carriedStats);
      }else{
        map[q.teamId]=emptyCarriedStats();
      }
    });
    return map;
  }

  // Interzonal C-D (+50)
  function interzonalZones(c){
    if(!isTorneo50(c))return{zoneC:null,zoneD:null};
    return{zoneC:zoneByCode(c,'C'),zoneD:zoneByCode(c,'D')};
  }
  function isInterzonalZone(c,zone){
    if(!isTorneo50(c)||!zone)return false;
    var iz=interzonalZones(c);
    return Boolean((iz.zoneC&&zone.id===iz.zoneC.id)||(iz.zoneD&&zone.id===iz.zoneD.id));
  }
  function interzonalSlots(c){
    var raw=Array.isArray(zoneFlow(c).interzonals)?zoneFlow(c).interzonals:[],bySlot={};
    raw.forEach(function(item){
      if(item&&(item.slot===1||item.slot===2||item.slot===3)){
        bySlot[item.slot]={slot:item.slot,teamCId:item.teamCId||null,teamDId:item.teamDId||null};
      }
    });
    return[1,2,3].map(function(slot){return bySlot[slot]||{slot:slot,teamCId:null,teamDId:null};});
  }
  function pairKey(aId,bId){return[aId,bId].sort().join('|');}
  function interzonalMatches(categoryId){
    return categoryMatches(categoryId).filter(function(r){return r.stage===STAGES.GENERAL&&r.matchType===MATCH_TYPES.INTERZONAL;});
  }
  function interzonalMatchForSlot(c,slot,pairing){
    var list=interzonalMatches(c.id);
    var bySlot=list.filter(function(r){return r.interzonalSlot===slot;})[0];
    if(bySlot)return bySlot;
    if(pairing&&pairing.teamCId&&pairing.teamDId){
      var pk=pairKey(pairing.teamCId,pairing.teamDId);
      return list.filter(function(r){return pairKey(r.winnerId,r.loserId)===pk;})[0]||null;
    }
    return null;
  }
  function interzonalStatus(c){
    if(!c)return{applicable:false,zoneC:null,zoneD:null,teamsC:[],teamsD:[],slots:[],assignedC:[],pendingC:[],assignedD:[],pendingD:[],assignedCount:0,playedCount:0,allAssigned:false,allPlayed:false};
    var iz=interzonalZones(c),zoneC=iz.zoneC,zoneD=iz.zoneD;
    var teamsC=zoneC?zoneC.teamIds.map(teamById).filter(Boolean):[];
    var teamsD=zoneD?zoneD.teamIds.map(teamById).filter(Boolean):[];
    var slots=interzonalSlots(c).map(function(item){
      var tC=item.teamCId&&zoneC&&zoneC.teamIds.indexOf(item.teamCId)>=0?teamById(item.teamCId):null;
      var tD=item.teamDId&&zoneD&&zoneD.teamIds.indexOf(item.teamDId)>=0?teamById(item.teamDId):null;
      var assigned=Boolean(tC&&tD);
      var match=assigned?interzonalMatchForSlot(c,item.slot,{teamCId:tC.id,teamDId:tD.id}):null;
      return{slot:item.slot,teamCId:tC?tC.id:null,teamDId:tD?tD.id:null,teamC:tC,teamD:tD,assigned:assigned,match:match,played:Boolean(match)};
    });
    var usedC={},usedD={};
    slots.forEach(function(s){if(s.teamCId)usedC[s.teamCId]=true;if(s.teamDId)usedD[s.teamDId]=true;});
    var assignedC=teamsC.filter(function(t){return usedC[t.id];}),pendingC=teamsC.filter(function(t){return!usedC[t.id];});
    var assignedD=teamsD.filter(function(t){return usedD[t.id];}),pendingD=teamsD.filter(function(t){return!usedD[t.id];});
    var assignedCount=slots.filter(function(s){return s.assigned;}).length;
    var playedCount=slots.filter(function(s){return s.played;}).length;
    var allAssigned=teamsC.length===3&&teamsD.length===3&&assignedCount===3&&pendingC.length===0&&pendingD.length===0;
    return{applicable:isTorneo50(c),zoneC:zoneC,zoneD:zoneD,teamsC:teamsC,teamsD:teamsD,slots:slots,assignedC:assignedC,pendingC:pendingC,assignedD:assignedD,pendingD:pendingD,assignedCount:assignedCount,playedCount:playedCount,allAssigned:allAssigned,allPlayed:allAssigned&&playedCount===3};
  }
  function teamHasInterzonalAssignment(c,teamId){
    if(!isTorneo50(c))return false;
    return interzonalSlots(c).some(function(s){return s.teamCId===teamId||s.teamDId===teamId;});
  }
  function setInterzonalPair(slot,teamCId,teamDId,options){
    var c=category();
    if(!c||!isTorneo50(c))throw Error('El selector Interzonal C-D solo aplica a Categoría +50.');
    if(c.currentStage!==STAGES.GENERAL)throw Error('No se puede modificar el Interzonal C-D porque la Fase 1 ya fue cerrada.');
    var slotNum=Number(slot);
    if(slotNum!==1&&slotNum!==2&&slotNum!==3)throw Error('El enfrentamiento interzonal debe ser 1, 2 o 3.');
    if(!teamCId||!teamDId)throw Error('No se pueden guardar enfrentamientos incompletos. Seleccioná un equipo de Zona C y uno de Zona D.');
    var iz=interzonalZones(c);
    if(!iz.zoneC||!iz.zoneD)throw Error('Deben existir Zona C y Zona D.');
    if(teamCId===teamDId)throw Error('No podés seleccionar al mismo equipo.');
    if(iz.zoneC.teamIds.indexOf(teamCId)<0||iz.zoneD.teamIds.indexOf(teamDId)<0)throw Error('Cada cruce debe enfrentar un equipo de Zona C contra uno de Zona D.');
    var currentSlots=interzonalSlots(c);
    if(currentSlots.some(function(s){return s.slot!==slotNum&&(s.teamCId===teamCId||s.teamDId===teamDId);}))throw Error('No se pueden repetir equipos en enfrentamientos diferentes.');
    var existingSlot=currentSlots.filter(function(s){return s.slot===slotNum;})[0];
    var existingMatch=existingSlot&&existingSlot.teamCId&&existingSlot.teamDId?interzonalMatchForSlot(c,slotNum,existingSlot):null;
    var changed=!existingSlot||existingSlot.teamCId!==teamCId||existingSlot.teamDId!==teamDId;
    if(existingMatch&&changed&&!(options&&options.force)){
      throw Error('INTERZONAL_CONFIRM_NEEDED');
    }
    zoneFlow(c).interzonals=currentSlots.map(function(s){return s.slot===slotNum?{slot:slotNum,teamCId:teamCId,teamDId:teamDId}:s;});
    if(existingMatch&&changed){state.matchResults=state.matchResults.filter(function(r){return r.id!==existingMatch.id;});}
    interzonalDraft=null;
    saveState();
    return zoneFlow(c).interzonals[slotNum-1];
  }
  function clearInterzonalPair(slot,options){
    var c=category();
    if(!c||!isTorneo50(c))throw Error('El selector Interzonal C-D solo aplica a Categoría +50.');
    if(c.currentStage!==STAGES.GENERAL)throw Error('No se puede modificar el Interzonal C-D porque la Fase 1 ya fue cerrada.');
    var slotNum=Number(slot);
    if(slotNum!==1&&slotNum!==2&&slotNum!==3)throw Error('El enfrentamiento interzonal debe ser 1, 2 o 3.');
    var currentSlots=interzonalSlots(c);
    var existingSlot=currentSlots.filter(function(s){return s.slot===slotNum;})[0];
    var existingMatch=existingSlot&&existingSlot.teamCId&&existingSlot.teamDId?interzonalMatchForSlot(c,slotNum,existingSlot):null;
    if(existingMatch&&!(options&&options.force))throw Error('INTERZONAL_CONFIRM_NEEDED');
    zoneFlow(c).interzonals=currentSlots.map(function(s){return s.slot===slotNum?{slot:slotNum,teamCId:null,teamDId:null}:s;});
    if(existingMatch){state.matchResults=state.matchResults.filter(function(r){return r.id!==existingMatch.id;});}
    interzonalDraft=null;
    saveState();
  }

  function zoneMatches(categoryId,stage,zoneId){
    var targetCat=state.categories.filter(function(c){return c.id===categoryId;})[0]||category();
    var zone=targetCat&&zoneId?zoneById(targetCat,zoneId):null;
    if(targetCat&&stage===STAGES.GENERAL&&isTorneo50(targetCat)&&isInterzonalZone(targetCat,zone)){
      var members={};
      zone.teamIds.forEach(function(id){members[id]=true;});
      return categoryMatches(categoryId).filter(function(r){
        if(r.stage!==STAGES.GENERAL)return false;
        if(r.zoneId===zoneId)return true;
        return r.matchType===MATCH_TYPES.INTERZONAL&&(members[r.winnerId]||members[r.loserId]);
      });
    }
    return categoryMatches(categoryId).filter(function(r){return r.stage===stage&&r.zoneId===zoneId;});
  }
  function createZone(name){
    var c=category();
    name=String(name||'').trim();
    if(!c)throw Error('Seleccioná una categoría.');
    if(isSingleZoneCategory(c))throw Error('Esta categoría utiliza Zona única.');
    if(isTorneo50(c)||isTorneo60(c))throw Error('Esta categoría ya tiene sus zonas oficiales definidas.');
    if(c.currentStage!==STAGES.GENERAL||zoneFlow(c).status===ZONE_STATUS.FINISHED)throw Error('La fase clasificatoria ya fue cerrada.');
    if(!name)throw Error('La zona necesita un nombre.');
    if(zoneFlow(c).zones.some(function(z){return z.name.toLowerCase()===name.toLowerCase();}))throw Error('Ya existe una zona con ese nombre.');
    var z={id:uid('zone'),name:name,phase:ZONE_PHASES.QUALIFYING,teamIds:[]};
    zoneFlow(c).zones.push(z);
    zoneFlow(c).status=ZONE_STATUS.IN_PROGRESS;
    zoneFlow(c).firstStageStatus='IN_PROGRESS';
    loaderDraft=null;
    saveState();
    return z;
  }
  function renameZone(id,name){var c=category(),z=zoneById(c,id);name=String(name||'').trim();if(!z)throw Error('Zona inexistente.');if(!name)throw Error('La zona necesita un nombre.');if(zoneFlow(c).zones.some(function(other){return other.id!==id&&other.name.toLowerCase()===name.toLowerCase();}))throw Error('Ya existe una zona con ese nombre.');z.name=name;saveState();}
  function zoneHasResults(c,zoneId){return categoryMatches(c.id).some(function(r){return r.zoneId===zoneId;});}
  function assignTeamToZone(teamId,zoneId){
    var c=category(),team=teamById(teamId),z=zoneById(c,zoneId);
    if(!c||!team||team.categoryId!==c.id||!z||z.phase!==ZONE_PHASES.QUALIFYING)throw Error('Equipo o zona inválidos.');
    if(isSingleZoneCategory(c))throw Error('Esta categoría usa una única zona.');
    if(c.currentStage!==STAGES.GENERAL||zoneFlow(c).status===ZONE_STATUS.FINISHED)throw Error('La fase clasificatoria ya fue cerrada.');
    var cap=zoneTargetTeams(c,z);
    if(cap&&z.teamIds.indexOf(teamId)<0&&z.teamIds.length>=cap)throw Error(z.name+' ya completó su cupo de '+cap+' equipos.');
    var existing=teamZone(c,teamId);
    if(existing&&existing.id!==zoneId){
      if(teamHasInterzonalAssignment(c,teamId))throw Error('Limpiá primero el cruce Interzonal C-D de este equipo.');
      if(zoneHasResults(c,existing.id)||zoneHasResults(c,zoneId))throw Error('No se puede mover el equipo después de registrar resultados en la zona.');
      existing.teamIds=existing.teamIds.filter(function(id){return id!==teamId;});
    }
    if(z.teamIds.indexOf(teamId)<0)z.teamIds.push(teamId);
    loaderDraft=null;interzonalDraft=null;saveState();
  }
  function removeTeamFromZone(teamId,zoneId){
    var c=category(),z=zoneById(c,zoneId);
    if(!z)throw Error('Zona inexistente.');
    if(teamHasInterzonalAssignment(c,teamId))throw Error('Este equipo tiene un cruce Interzonal C-D asignado. Limpiá primero ese cruce.');
    if(zoneHasResults(c,zoneId))throw Error('No se puede quitar un equipo de una zona con resultados cargados.');
    if(isSingleZoneCategory(c)){z.teamIds=z.teamIds.filter(function(id){return id!==teamId;});state.teams=state.teams.filter(function(t){return t.id!==teamId;});loaderDraft=null;saveState();return;}
    if(c.currentStage!==STAGES.GENERAL)throw Error('No se puede modificar una etapa cerrada.');
    z.teamIds=z.teamIds.filter(function(id){return id!==teamId;});loaderDraft=null;interzonalDraft=null;saveState();
  }
  function deleteZone(id){
    var c=category(),f=zoneFlow(c),z=zoneById(c,id);
    if(!z||id===f.secondStageZoneId||z.phase!==ZONE_PHASES.QUALIFYING)throw Error('No se puede eliminar esta zona.');
    if(isTorneo50(c)||isTorneo60(c))throw Error('No se pueden eliminar las zonas reglamentarias de esta categoría.');
    if(c.currentStage!==STAGES.GENERAL||f.status===ZONE_STATUS.FINISHED)throw Error('La fase clasificatoria ya fue cerrada.');
    var affected=categoryMatches(c.id).filter(function(r){return r.zoneId===id;});
    f.zones=f.zones.filter(function(item){return item.id!==id;});
    state.matchResults=state.matchResults.filter(function(r){return r.zoneId!==id;});
    f.status=f.zones.length?ZONE_STATUS.IN_PROGRESS:ZONE_STATUS.CONFIGURING;
    loaderDraft=null;saveState();return{teams:z.teamIds.length,results:affected.length};
  }

  function headToHeadDiff(aTeamId,bTeamId,matches){
    if(!matches||!matches.length)return 0;
    var direct=matches.filter(function(m){
      return (m.winnerId===aTeamId&&m.loserId===bTeamId)||(m.winnerId===bTeamId&&m.loserId===aTeamId);
    });
    if(!direct.length)return 0;
    var aWins=direct.filter(function(m){return m.winnerId===aTeamId;}).length;
    var bWins=direct.filter(function(m){return m.winnerId===bTeamId;}).length;
    if(aWins>bWins)return -1;
    if(bWins>aWins)return 1;
    return 0;
  }
  function sameRanking(a,b,matches){
    return a.classificationPoints===b.classificationPoints&&a.difference===b.difference&&a.pointsFor===b.pointsFor&&a.pointsAgainst===b.pointsAgainst&&headToHeadDiff(a.team.id,b.team.id,matches)===0;
  }
  function rankingKey(row){return row.classificationPoints+'/'+row.difference+'/'+row.pointsFor+'/'+row.pointsAgainst;}
  function tieSignature(rows){return rows.map(function(r){return r.team.id;}).sort().join(',')+'@'+rankingKey(rows[0]);}
  function scopeKey(stage,zoneId){return stage+'|'+zoneId;}
  function rankWithTies(rows,resolutions,matches){
    var available=Array.isArray(resolutions)?resolutions:[];
    var output=[],ties=[],index=0;
    while(index<rows.length){
      var end=index;
      while(end+1<rows.length&&sameRanking(rows[index],rows[end+1],matches))end+=1;
      var group=rows.slice(index,end+1);
      if(group.length>1){
        var signature=tieSignature(group);
        var resolution=available.filter(function(item){return item.signature===signature;})[0];
        var resolved=Boolean(resolution);
        if(resolved){
          group=resolution.order.map(function(tid){return group.filter(function(r){return r.team.id===tid;})[0];}).filter(Boolean);
        }
        group=group.map(function(row){return Object.assign({},row,{tied:true,tieResolved:resolved});});
        ties.push({teamIds:group.map(function(r){return r.team.id;}),start:index,end:end,signature:signature,resolved:resolved});
      }
      group.forEach(function(r){output.push(r);});
      index=end+1;
    }
    return{rows:output,ties:ties};
  }

  function standings(categoryId,stage,zoneId){
    var targetCat=state.categories.filter(function(c){return c.id===categoryId;})[0]||category();
    var allScopedMatches=(zoneId&&targetCat&&stage)
      ?zoneMatches(categoryId,stage,zoneId).filter(function(r){return Boolean(resolveMatchScore(r));})
      :categoryMatches(categoryId).filter(function(r){return(!stage||r.stage===stage)&&(!zoneId||r.zoneId===zoneId)&&Boolean(resolveMatchScore(r));});
    var baselineMap=targetCat&&isFinalAccumulatedScope(targetCat,stage,zoneId)?qualifiedBaselineMap(targetCat):null;
    var rows=teams(categoryId).filter(function(team){
      return !zoneId||(zoneById(targetCat,zoneId)&&zoneById(targetCat,zoneId).teamIds.indexOf(team.id)>=0);
    }).map(function(team){
      var base=baselineMap&&baselineMap[team.id]?baselineMap[team.id]:null;
      var stats=computeTeamStatsFromMatches(team.id,allScopedMatches,base);
      return{team:team,resultCount:stats.resultCount,wins:stats.wins,losses:stats.losses,won20:stats.won20,won21:stats.won21,lost02:stats.lost02,lost12:stats.lost12,stagePoints:stats.classificationPoints,classificationPoints:stats.classificationPoints,scorePoints:calculateTeamStageTotal(team,stage),totalPoints:calculateTeamTotal(team),pointsFor:stats.pointsFor,pointsAgainst:stats.pointsAgainst,difference:stats.difference,setWins:stats.setWins,setLosses:stats.setLosses,setRatio:stats.setRatio,ptosRatio:stats.ptosRatio};
    }).sort(function(a,b){
      if(b.classificationPoints!==a.classificationPoints)return b.classificationPoints-a.classificationPoints;
      if(b.difference!==a.difference)return b.difference-a.difference;
      if(b.pointsFor!==a.pointsFor)return b.pointsFor-a.pointsFor;
      if(a.pointsAgainst!==b.pointsAgainst)return a.pointsAgainst-b.pointsAgainst;
      var h2h=headToHeadDiff(a.team.id,b.team.id,allScopedMatches);
      if(h2h!==0)return h2h;
      return a.team.name.localeCompare(b.team.name)||(a.team.id&&b.team.id?a.team.id.localeCompare(b.team.id):0);
    });
    if(targetCat&&zoneId&&stage){
      var res=(zoneFlow(targetCat).tieBreaks||[]).filter(function(item){return item.scope===scopeKey(stage,zoneId);});
      return rankWithTies(rows,res,allScopedMatches).rows;
    }
    return rows;
  }
  function zoneRankingFull(c,z,stage){
    var effectiveStage=stage||stageForZone(c,z.id);
    var matches=zoneMatches(c.id,effectiveStage,z.id).filter(function(r){return Boolean(resolveMatchScore(r));});
    var baselineMap=isFinalAccumulatedScope(c,effectiveStage,z.id)?qualifiedBaselineMap(c):null;
    var rawRows=z.teamIds.map(teamById).filter(Boolean).map(function(team){
      var base=baselineMap&&baselineMap[team.id]?baselineMap[team.id]:null;
      var stats=computeTeamStatsFromMatches(team.id,matches,base);
      return{team:team,resultCount:stats.resultCount,wins:stats.wins,losses:stats.losses,won20:stats.won20,won21:stats.won21,lost02:stats.lost02,lost12:stats.lost12,stagePoints:stats.classificationPoints,classificationPoints:stats.classificationPoints,scorePoints:calculateTeamStageTotal(team,effectiveStage),totalPoints:calculateTeamTotal(team),pointsFor:stats.pointsFor,pointsAgainst:stats.pointsAgainst,difference:stats.difference,setWins:stats.setWins,setLosses:stats.setLosses,setRatio:stats.setRatio,ptosRatio:stats.ptosRatio};
    }).sort(function(a,b){
      if(b.classificationPoints!==a.classificationPoints)return b.classificationPoints-a.classificationPoints;
      if(b.difference!==a.difference)return b.difference-a.difference;
      if(b.pointsFor!==a.pointsFor)return b.pointsFor-a.pointsFor;
      if(a.pointsAgainst!==b.pointsAgainst)return a.pointsAgainst-b.pointsAgainst;
      var h2h=headToHeadDiff(a.team.id,b.team.id,matches);
      if(h2h!==0)return h2h;
      return a.team.name.localeCompare(b.team.name)||(a.team.id&&b.team.id?a.team.id.localeCompare(b.team.id):0);
    });
    var scope=scopeKey(effectiveStage,z.id);
    var res=(zoneFlow(c).tieBreaks||[]).filter(function(item){return item.scope===scope;});
    var ranked=rankWithTies(rawRows,res,matches);
    return Object.assign(ranked,{scope:scope,stage:effectiveStage,zoneId:z.id});
  }
  function zoneRows(c,z,stage){return zoneRankingFull(c,z,stage).rows;}
  function zoneProgressInfo(c,z,stage){
    var effectiveStage=stage||stageForZone(c,z.id),members={};
    z.teamIds.forEach(function(id){members[id]=true;});
    var internalPairs={},interPairs={};
    zoneMatches(c.id,effectiveStage,z.id).forEach(function(m){
      if(m.matchType===MATCH_TYPES.INTERZONAL&&(members[m.winnerId]||members[m.loserId])){
        interPairs[pairKey(m.winnerId,m.loserId)]=true;
      }else if(members[m.winnerId]&&members[m.loserId]){
        internalPairs[pairKey(m.winnerId,m.loserId)]=true;
      }
    });
    var n=z.teamIds.length,intReq=n*(n-1)/2,intPlayed=Object.keys(internalPairs).length;
    var hasIz=effectiveStage===STAGES.GENERAL&&isTorneo50(c)&&isInterzonalZone(c,z);
    var izReq=hasIz?3:0,izPlayed=hasIz?Object.keys(interPairs).length:0;
    var req=intReq+izReq,played=intPlayed+izPlayed,target=zoneTargetTeams(c,z);
    var countOk=target?n===target:n>=2;
    return{teamCount:n,targetTeams:target,required:req,played:played,missing:Math.max(0,req-played),internalRequired:intReq,internalPlayed:intPlayed,interzonalRequired:izReq,interzonalPlayed:izPlayed,complete:countOk&&played===req};
  }
  function resolveTie(scope,order){
    var c=category();
    if(!c)throw Error('Seleccioná una categoría.');
    var parts=String(scope||'').split('|'),z=zoneById(c,parts[1]);
    if(!z||stageForZone(c,z.id)!==parts[0])throw Error('Ámbito de empate inválido.');
    var ids=Array.isArray(order)?order.slice():[];
    if(ids.length<2||new Set(ids).size!==ids.length)throw Error('Indicá un orden sin repetir equipos.');
    var matches=zoneMatches(c.id,parts[0],z.id);
    var rawRows=zoneRankingFull(c,z,parts[0]).rows;
    var rawTies=rankWithTies(standings(c.id,parts[0],z.id),[],matches).ties;
    var sorted=ids.slice().sort().join(',');
    var tie=rawTies.filter(function(t){return t.teamIds.slice().sort().join(',')===sorted;})[0];
    if(!tie)throw Error('Esos equipos no están empatados actualmente.');
    var f=zoneFlow(c),liveSigs=rawTies.map(function(t){return t.signature;});
    f.tieBreaks=(f.tieBreaks||[]).filter(function(item){return item.scope!==scope||(item.signature!==tie.signature&&liveSigs.indexOf(item.signature)>=0);});
    f.tieBreaks.push({scope:scope,signature:tie.signature,order:ids,createdAt:new Date().toISOString()});
    saveState();
  }
  function clearTieResolution(scope,signature){
    var c=category();if(!c)return;
    var f=zoneFlow(c);
    f.tieBreaks=(f.tieBreaks||[]).filter(function(item){return!(item.scope===scope&&item.signature===signature);});
    saveState();
  }

  function blockingTiesForZone(c,z,ranking){
    var unresolved=ranking.ties.filter(function(t){return!t.resolved;});
    if(!unresolved.length)return[];
    if(isTorneo50(c)){
      if(z.code==='A'||z.code==='B')return unresolved.filter(function(t){return(t.start<1&&t.end>=1)||(t.start<2&&t.end>=2);});
      return unresolved;
    }
    if(isTorneo60(c))return unresolved;
    return unresolved.filter(function(t){return t.start<2&&t.end>=2;});
  }

  function evaluateZoneQualification(c){
    if(!c||isSingleZoneCategory(c))return{ready:false,warnings:['Esta categoría utiliza Zona única.'],qualifiers:[],secondStageAllocations:[]};
    var initial=qualifyingZonesOf(c),warnings=[],qualifiers=[],assigned={};
    if(!initial.length){
      warnings.push('Creá al menos una zona clasificatoria.');
      return{ready:false,warnings:warnings,qualifiers:[],secondStageAllocations:[]};
    }
    initial.forEach(function(z){
      var target=zoneTargetTeams(c,z);
      if(target&&z.teamIds.length!==target){
        warnings.push(z.name+' debe tener exactamente '+target+' equipos (tiene '+z.teamIds.length+').');
      }else if(!target&&z.teamIds.length<2){
        warnings.push(z.name+' tiene menos de 2 equipos (necesita al menos 2 para clasificar a los dos primeros).');
      }
      z.teamIds.forEach(function(id){assigned[id]=(assigned[id]||0)+1;});
    });
    if(Object.keys(assigned).some(function(id){return assigned[id]>1;})){
      warnings.push('Un equipo no puede estar asignado en más de una zona clasificatoria.');
    }
    var missing=teams(c.id).filter(function(t){return!assigned[t.id];});
    if(missing.length){
      warnings.push('Hay equipos sin zona asignada: '+missing.map(function(t){return t.name;}).join(', ')+'.');
    }
    if(isTorneo50(c)){
      var iz=interzonalStatus(c);
      if(!iz.allAssigned)warnings.push('Completá los 3 enfrentamientos en el selector Interzonal C-D.');
      else if(!iz.allPlayed)warnings.push('Faltan cargar '+(3-iz.playedCount)+' resultado(s) del Interzonal C-D.');
    }
    initial.forEach(function(z){
      var prog=zoneProgressInfo(c,z,STAGES.GENERAL);
      var ranking=zoneRankingFull(c,z,STAGES.GENERAL);
      var rows=ranking.rows;
      var blocking=blockingTiesForZone(c,z,ranking);
      if(isTorneo50(c)||isTorneo60(c)){
        if(prog.teamCount===prog.targetTeams&&!prog.complete){
          if(prog.interzonalRequired&&prog.internalPlayed<prog.internalRequired){
            warnings.push(z.name+': faltan '+(prog.internalRequired-prog.internalPlayed)+' partido(s) internos.');
          }else if(!prog.interzonalRequired){
            warnings.push(z.name+': faltan '+prog.missing+' partido(s) para completar el todos contra todos.');
          }
        }
        if(prog.complete&&blocking.length){
          warnings.push(z.name+': hay un empate sin resolver que define la clasificación.');
        }
        rows.forEach(function(row,idx){
          qualifiers.push({teamId:row.team.id,sourceZoneId:z.id,sourceCode:z.code||z.name.slice(-1).toUpperCase(),position:idx+1,team:row.team,zone:z,row:row});
        });
      }else{
        if(z.teamIds.length<2)return;
        if(!zoneHasResults(c,z.id)){
          warnings.push(z.name+' todavía no tiene resultados cargados.');
          return;
        }
        if(blocking.length){
          warnings.push('Empate sin definir en '+z.name+' por el 2° puesto de clasificación.');
        }else if(rows.length>=2&&rows[0].resultCount===0&&rows[1].resultCount===0){
          warnings.push('Faltan resultados en '+z.name+' para definir a los dos clasificados.');
        }
        rows.slice(0,2).forEach(function(row,idx){
          qualifiers.push({teamId:row.team.id,sourceZoneId:z.id,position:idx+1,team:row.team,zone:z,row:row});
        });
      }
    });
    var allocations=[];
    var findQ=function(code,pos){return qualifiers.filter(function(q){return q.sourceCode===code&&q.position===pos;})[0];};
    if(isTorneo50(c)){
      allocations=[
        {code:'1',name:'Zona 1 · Ronda Campeonato',phase:ZONE_PHASES.CHAMPIONSHIP,targetTeams:4,items:[findQ('A',1),findQ('B',1),findQ('C',2),findQ('D',2)].filter(Boolean)},
        {code:'2',name:'Zona 2 · Ronda Campeonato',phase:ZONE_PHASES.CHAMPIONSHIP,targetTeams:4,items:[findQ('C',1),findQ('D',1),findQ('A',2),findQ('B',2)].filter(Boolean)},
        {code:'3',name:'Zona 3 · Ronda Estímulo (9° al 14°)',phase:ZONE_PHASES.STIMULUS,targetTeams:6,items:[findQ('A',3),findQ('A',4),findQ('B',3),findQ('B',4),findQ('C',3),findQ('D',3)].filter(Boolean)}
      ];
    }else if(isTorneo60(c)){
      allocations=[
        {code:'1',name:'Zona 1 · Campeonato',phase:ZONE_PHASES.CHAMPIONSHIP,targetTeams:3,items:[findQ('A',1),findQ('B',2),findQ('C',1)].filter(Boolean)},
        {code:'2',name:'Zona 2 · Campeonato',phase:ZONE_PHASES.CHAMPIONSHIP,targetTeams:3,items:[findQ('A',2),findQ('B',1),findQ('C',2)].filter(Boolean)},
        {code:'3',name:'Zona 3 · Puestos 7° al 9°',phase:ZONE_PHASES.PLACEMENT,targetTeams:3,items:[findQ('A',3),findQ('B',3),findQ('C',3)].filter(Boolean)},
        {code:'4',name:'Zona 4 · Puestos 10° al 12°',phase:ZONE_PHASES.PLACEMENT,targetTeams:3,items:[findQ('A',4),findQ('B',4),findQ('C',4)].filter(Boolean)},
        {code:'5',name:'Zona 5 · Puestos 13° al 15°',phase:ZONE_PHASES.PLACEMENT,targetTeams:3,items:[findQ('A',5),findQ('B',5),findQ('C',5)].filter(Boolean)},
        {code:'6',name:'Zona 6 · Puestos 16° al 18°',phase:ZONE_PHASES.PLACEMENT,targetTeams:3,items:[findQ('A',6),findQ('B',6),findQ('C',6)].filter(Boolean)}
      ];
    }else{
      allocations=[{code:'F',name:'Zona final',phase:ZONE_PHASES.FINAL,items:qualifiers}];
    }
    return{ready:warnings.length===0,warnings:warnings,qualifiers:qualifiers,secondStageAllocations:allocations};
  }
  function confirmZones(){
    var c=category(),f=zoneFlow(c);
    if(!c||isSingleZoneCategory(c))throw Error('Esta categoría no utiliza fase clasificatoria.');
    if(c.currentStage!==STAGES.GENERAL)throw Error('La fase clasificatoria ya fue cerrada.');
    var evalQual=evaluateZoneQualification(c);
    if(!evalQual.ready)throw Error(evalQual.warnings.join(' '));
    var qualified=evalQual.qualifiers.map(function(q){
      var entry={teamId:q.teamId,sourceZoneId:q.sourceZoneId,position:q.position,carriedStats:toCarriedStats(q.row)};
      if(q.sourceCode)entry.sourceCode=q.sourceCode;
      return entry;
    });
    var qualifiedIds=qualified.map(function(q){return q.teamId;});
    var createdZones=evalQual.secondStageAllocations.map(function(spec){
      var z={id:uid('zone'),code:spec.code,name:spec.name,phase:spec.phase,teamIds:spec.items.map(function(i){return i.teamId;})};
      if(spec.targetTeams)z.targetTeams=spec.targetTeams;
      f.zones.push(z);
      return z;
    });
    f.qualified=qualified;
    f.secondStageZoneId=createdZones[0]?createdZones[0].id:null;
    f.status=ZONE_STATUS.IN_PROGRESS;
    f.firstStageStatus='FINISHED';
    f.secondStageStatus='IN_PROGRESS';
    f.confirmedAt=new Date().toISOString();
    c.currentStage=STAGES.ZONE_FINAL;
    teams(c.id).forEach(function(t){if(qualifiedIds.indexOf(t.id)<0)t.status=STATUS.ELIMINATED;});
    qualified.forEach(function(q){var t=teamById(q.teamId);t.status=STATUS.QUALIFIED;t.stage=STAGES.ZONE_FINAL;});
    loaderDraft=null;
    saveState();
    return qualified;
  }

  // Cruces Finales (Día 3) para +50, +60 y +68
  function playoffMatches(categoryId){
    return categoryMatches(categoryId).filter(function(r){return r.stage===STAGES.PLAYOFFS||r.matchType===MATCH_TYPES.PLAYOFF;});
  }
  function findPlayoffMatch(categoryId,bracketId){
    return playoffMatches(categoryId).filter(function(r){return r.bracketId===bracketId;})[0]||null;
  }
  function makePlayoffSlot(c,def){
    var match=findPlayoffMatch(c.id,def.id);
    var ready=Boolean(def.teamA&&def.teamB&&def.teamA.id!==def.teamB.id);
    return{id:def.id,label:def.label,group:def.group,teamASource:def.teamASource,teamBSource:def.teamBSource,teamA:def.teamA||null,teamB:def.teamB||null,ready:ready,match:match,winner:match?teamById(match.winnerId):null,loser:match?teamById(match.loserId):null};
  }
  function evaluateSecondZone(c,z){
    if(!z)return{zone:null,progress:null,ranking:{rows:[],ties:[]},unresolvedTies:[],complete:false,ready:false};
    var prog=zoneProgressInfo(c,z,STAGES.ZONE_FINAL);
    var ranking=zoneRankingFull(c,z,STAGES.ZONE_FINAL);
    var unresolved=ranking.ties.filter(function(t){return!t.resolved;});
    return{zone:z,progress:prog,ranking:ranking,unresolvedTies:unresolved,complete:prog.complete,ready:prog.complete&&unresolved.length===0};
  }
  function computePlayoffs(c){
    if(!c||!hasPlayoffsFormat(c))return{applicable:false,unlocked:false,reasons:[],slots:[],placementZones:[],allComplete:false};
    if(isTorneo68(c)){
      var zU=finalZoneOf(c),eU=evaluateSecondZone(c,zU),reasons=[];
      if(!eU.zone||eU.progress.teamCount!==8)reasons.push('La Zona única requiere exactamente 8 equipos.');
      else if(!eU.progress.complete)reasons.push('Faltan '+eU.progress.missing+' de '+eU.progress.required+' partido(s) en la Zona única.');
      if(eU.unresolvedTies.length)reasons.push('Hay '+eU.unresolvedTies.length+' empate(s) sin resolver en la Zona única.');
      var unlocked=reasons.length===0,rows=unlocked?eU.ranking.rows:[];
      var t=function(idx){return rows[idx]?rows[idx].team:null;};
      var semi1=makePlayoffSlot(c,{id:'semi-1',label:'Semifinal 1',group:'Semifinales',teamASource:'1° Tabla General',teamBSource:'4° Tabla General',teamA:t(0),teamB:t(3)});
      var semi2=makePlayoffSlot(c,{id:'semi-2',label:'Semifinal 2',group:'Semifinales',teamASource:'2° Tabla General',teamBSource:'3° Tabla General',teamA:t(1),teamB:t(2)});
      var fin=makePlayoffSlot(c,{id:'final',label:'Gran Final (1° y 2° Puesto)',group:'Finales',teamASource:'Ganador Semi 1',teamBSource:'Ganador Semi 2',teamA:semi1.winner,teamB:semi2.winner});
      var third=makePlayoffSlot(c,{id:'third-place',label:'3° y 4° Puesto',group:'Finales',teamASource:'Perdedor Semi 1',teamBSource:'Perdedor Semi 2',teamA:semi1.loser,teamB:semi2.loser});
      var slots68=[semi1,semi2,fin,third];
      return{applicable:true,unlocked:unlocked,reasons:reasons,slots:slots68,placementZones:[{label:'Puestos 5° al 8° (Directo por Tabla General)',offset:5,eval:eU,sliceStart:4,sliceEnd:8}],allComplete:unlocked&&slots68.every(function(s){return Boolean(s.match);})};
    }
    if(c.currentStage===STAGES.GENERAL){
      return{applicable:true,unlocked:false,reasons:['Primero cerrá la Fase de Grupos para armar las zonas de Segunda Fase.'],slots:[],placementZones:[],allComplete:false};
    }
    var z1=zoneByCode(c,'1'),z2=zoneByCode(c,'2'),e1=evaluateSecondZone(c,z1),e2=evaluateSecondZone(c,z2),rList=[];
    if(!e1.complete)rList.push('Zona 1: faltan '+(e1.progress?e1.progress.missing:0)+' partido(s).');
    else if(e1.unresolvedTies.length)rList.push('Zona 1: hay empate(s) sin resolver.');
    if(!e2.complete)rList.push('Zona 2: faltan '+(e2.progress?e2.progress.missing:0)+' partido(s).');
    else if(e2.unresolvedTies.length)rList.push('Zona 2: hay empate(s) sin resolver.');
    var readyPO=Boolean(e1.ready&&e2.ready);
    var r1=readyPO?e1.ranking.rows:[],r2=readyPO?e2.ranking.rows:[];
    var g1=function(i){return r1[i]?r1[i].team:null;},g2=function(i){return r2[i]?r2[i].team:null;};
    var s1=makePlayoffSlot(c,{id:'semi-1',label:'Semifinal 1',group:'Semifinales',teamASource:'1° Zona 1',teamBSource:'2° Zona 2',teamA:g1(0),teamB:g2(1)});
    var s2=makePlayoffSlot(c,{id:'semi-2',label:'Semifinal 2',group:'Semifinales',teamASource:'1° Zona 2',teamBSource:'2° Zona 1',teamA:g2(0),teamB:g1(1)});
    var finP=makePlayoffSlot(c,{id:'final',label:'Final (1° y 2° Puesto)',group:'Finales',teamASource:'Ganador Semi 1',teamBSource:'Ganador Semi 2',teamA:s1.winner,teamB:s2.winner});
    var thirdP=makePlayoffSlot(c,{id:'third-place',label:'3° y 4° Puesto',group:'Finales',teamASource:'Perdedor Semi 1',teamBSource:'Perdedor Semi 2',teamA:s1.loser,teamB:s2.loser});
    var fifthP=makePlayoffSlot(c,{id:'fifth-place',label:'5° y 6° Puesto',group:'Reclasificación',teamASource:'3° Zona 1',teamBSource:'3° Zona 2',teamA:g1(2),teamB:g2(2)});
    var slots=[s1,s2,finP,thirdP,fifthP],placementZones=[];
    if(isTorneo50(c)){
      slots.push(makePlayoffSlot(c,{id:'seventh-place',label:'7° y 8° Puesto',group:'Reclasificación',teamASource:'4° Zona 1',teamBSource:'4° Zona 2',teamA:g1(3),teamB:g2(3)}));
      placementZones.push({label:'Puestos 9° al 14° (Zona 3 · Ronda Estímulo)',offset:9,eval:evaluateSecondZone(c,zoneByCode(c,'3')),sliceStart:0,sliceEnd:6});
    }else if(isTorneo60(c)){
      [{code:'3',offset:7,label:'Puestos 7° al 9° (Zona 3)'},{code:'4',offset:10,label:'Puestos 10° al 12° (Zona 4)'},{code:'5',offset:13,label:'Puestos 13° al 15° (Zona 5)'},{code:'6',offset:16,label:'Puestos 16° al 18° (Zona 6)'}].forEach(function(sp){
        placementZones.push({label:sp.label,offset:sp.offset,eval:evaluateSecondZone(c,zoneByCode(c,sp.code)),sliceStart:0,sliceEnd:3});
      });
    }
    var doneBrackets=readyPO&&slots.every(function(s){return Boolean(s.match);});
    var donePlacements=placementZones.every(function(p){return p.eval.ready;});
    return{applicable:true,unlocked:readyPO,reasons:rList,slots:slots,placementZones:placementZones,allComplete:doneBrackets&&donePlacements};
  }
  function computeFinalStandings(c){
    var po=computePlayoffs(c);
    if(!po.applicable)return[];
    var byId={};po.slots.forEach(function(s){byId[s.id]=s;});
    var out=[];
    var pushB=function(pw,pl,sid,orig){
      var s=byId[sid];
      out.push({position:pw,team:s&&s.winner?s.winner:null,origin:orig+' · Ganador',detail:s&&s.match?s.match.score.replace('-','–'):'Pendiente'});
      out.push({position:pl,team:s&&s.loser?s.loser:null,origin:orig+' · Perdedor',detail:s&&s.match?s.match.score.replace('-','–'):'Pendiente'});
    };
    pushB(1,2,'final','Final');
    pushB(3,4,'third-place','3° y 4° Puesto');
    if(isTorneo50(c)||isTorneo60(c))pushB(5,6,'fifth-place','5° y 6° Puesto');
    if(isTorneo50(c))pushB(7,8,'seventh-place','7° y 8° Puesto');
    po.placementZones.forEach(function(pz){
      var count=pz.sliceEnd-pz.sliceStart,src=pz.eval&&pz.eval.ready?pz.eval.ranking.rows.slice(pz.sliceStart,pz.sliceEnd):[];
      for(var i=0;i<count;i+=1){
        var r=src[i]||null;
        out.push({position:pz.offset+i,team:r?r.team:null,origin:pz.label,detail:r?(r.classificationPoints+' pts · DIF '+(r.difference>0?'+'+r.difference:r.difference)):'En juego / Pendiente'});
      }
    });
    return out;
  }

  function teamSetStats(teamId,categoryId,stage,zoneId){
    var targetCat=state.categories.filter(function(c){return c.id===categoryId;})[0]||category();
    var scoped=(zoneId&&targetCat&&stage)?zoneMatches(categoryId,stage,zoneId):categoryMatches(categoryId).filter(function(r){return(!stage||r.stage===stage)&&(!zoneId||r.zoneId===zoneId);});
    var stats=scoped.filter(function(r){return(r.winnerId===teamId||r.loserId===teamId)&&matchSetsFor(r).length;}).reduce(function(acc,r){var teamIsA=r.winnerId===teamId;matchSetsFor(r).forEach(function(set){acc.for+=teamIsA?set.a:set.b;acc.against+=teamIsA?set.b:set.a;});return acc;},{for:0,against:0});
    if(targetCat&&isFinalAccumulatedScope(targetCat,stage,zoneId)){
      var base=qualifiedBaselineMap(targetCat)[teamId];
      if(base){stats.for+=base.pointsFor;stats.against+=base.pointsAgainst;}
    }
    return stats;
  }
  function teamClassificationPoints(teamId,categoryId,stage,zoneId){
    var targetCat=state.categories.filter(function(c){return c.id===categoryId;})[0]||category();
    var scoped=(zoneId&&targetCat&&stage)?zoneMatches(categoryId,stage,zoneId):categoryMatches(categoryId).filter(function(r){return(!stage||r.stage===stage)&&(!zoneId||r.zoneId===zoneId);});
    var total=scoped.filter(function(r){return(r.winnerId===teamId||r.loserId===teamId);}).reduce(function(sum,r){return sum+matchPointsForTeam(r,teamId);},0);
    if(targetCat&&isFinalAccumulatedScope(targetCat,stage,zoneId)){
      var base=qualifiedBaselineMap(targetCat)[teamId];
      if(base)total+=base.classificationPoints;
    }
    return total;
  }
  function syncChampionFromPlayoffs(c){
    if(!c||!hasPlayoffsFormat(c))return;
    var fin=findPlayoffMatch(c.id,'final');
    c.championId=fin?fin.winnerId:null;
    c.runnerUpId=fin?fin.loserId:null;
  }
  function createMatchResult(winnerId,loserId,score,sets,zoneId){
    var c=category(),winner=teamById(winnerId),loser=teamById(loserId),f=zoneFlow(c);
    if(!c)throw Error('Seleccioná una categoría.');
    if(c.currentStage===STAGES.FINISHED)throw Error('El torneo ya finalizó.');
    if(!winner||!loser||winner.categoryId!==c.id||loser.categoryId!==c.id||winner.id===loser.id)throw Error('Los equipos deben pertenecer a la categoría activa y ser diferentes.');
    if(score!=='2-0'&&score!=='2-1')throw Error('El resultado debe ser 2–0 o 2–1.');
    var actualZone=zoneId||currentZoneId(c);
    var targetZoneObj=actualZone?zoneById(c,actualZone):null;
    if(f.zones.length){
      if(!targetZoneObj||targetZoneObj.teamIds.indexOf(winner.id)<0||targetZoneObj.teamIds.indexOf(loser.id)<0){
        throw Error('Ambos equipos deben pertenecer a la misma zona.');
      }
    }
    var matchStage=stageForZone(c,actualZone);
    if(categoryMatches(c.id).some(function(r){return r.matchType!==MATCH_TYPES.INTERZONAL&&r.matchType!==MATCH_TYPES.PLAYOFF&&r.stage===matchStage&&r.zoneId===actualZone&&((r.winnerId===winner.id&&r.loserId===loser.id)||(r.winnerId===loser.id&&r.loserId===winner.id));})){
      throw Error('Ese cruce ya tiene un resultado.');
    }
    var normalizedSets=typeof sets==='undefined'?[]:validateMatchSets(sets),wins=normalizedSets.length?setWinnerCount(normalizedSets):null;
    if(wins&&(wins.a!==2||score!=='2-'+wins.b))throw Error('El resultado tradicional no coincide con los marcadores.');
    var created={id:uid('match'),categoryId:c.id,winnerId:winner.id,loserId:loser.id,score:score,sets:normalizedSets,stage:matchStage,zoneId:actualZone||null,matchType:MATCH_TYPES.ZONE,createdAt:new Date().toISOString()};
    state.matchResults.push(created);
    if(matchStage===STAGES.GENERAL)syncCategoryCarriedStats(c);
    if(!saveState()){state.matchResults.pop();if(matchStage===STAGES.GENERAL)syncCategoryCarriedStats(c);throw Error('No se pudo guardar el resultado.');}
    return created;
  }
  function createMatchFromSets(teamAId,setsA,teamBId,setsB,setScores,zoneId){
    var a=Number(setsA),b=Number(setsB);
    if(!Number.isInteger(a)||!Number.isInteger(b)||a<0||b<0)throw Error('Los sets deben ser números enteros mayores o iguales a 0.');
    if(!((a===2&&(b===0||b===1))||(b===2&&(a===0||a===1))))throw Error('Ingresá un resultado válido: 2–0 o 2–1.');
    var winner=a>b?teamAId:teamBId,loser=a>b?teamBId:teamAId,score=Math.max(a,b)+'-'+Math.min(a,b);
    if(typeof setScores==='undefined')return createMatchResult(winner,loser,score,undefined,zoneId);
    var sets=Array.isArray(setScores)?setScores:[];
    if(!sets.length)throw Error('Ingresá los marcadores reales de cada set.');
    if(sets.length!==(a+b))throw Error('La cantidad de marcadores debe coincidir con los sets ganados.');
    var oriented=sets.map(function(set){var norm=normalizeSet(set);if(!norm)return set;return teamAId===winner?{a:norm.a,b:norm.b}:{a:norm.b,b:norm.a};});
    return createMatchResult(winner,loser,score,oriented,zoneId);
  }
  function orientSetsForTeams(teamAId,setsA,teamBId,setsB,setScores){
    var a=Number(setsA),b=Number(setsB);
    if(!Number.isInteger(a)||!Number.isInteger(b)||a<0||b<0)throw Error('Los sets deben ser números enteros mayores o iguales a 0.');
    if(!((a===2&&(b===0||b===1))||(b===2&&(a===0||a===1))))throw Error('Ingresá un resultado válido: 2–0 o 2–1.');
    var winner=a>b?teamAId:teamBId,loser=a>b?teamBId:teamAId,score=Math.max(a,b)+'-'+Math.min(a,b);
    var normalizedSets=[];
    if(typeof setScores!=='undefined'){
      var sets=Array.isArray(setScores)?setScores:[];
      if(!sets.length)throw Error('Ingresá los marcadores reales de cada set.');
      if(sets.length!==(a+b))throw Error('La cantidad de marcadores debe coincidir con los sets ganados.');
      var oriented=sets.map(function(set){var norm=normalizeSet(set);if(!norm)return set;return teamAId===winner?{a:norm.a,b:norm.b}:{a:norm.b,b:norm.a};});
      normalizedSets=validateMatchSets(oriented);
      var wins=setWinnerCount(normalizedSets);
      if(wins.a!==2||score!=='2-'+wins.b)throw Error('El resultado tradicional no coincide con los marcadores.');
    }
    return{winner:winner,loser:loser,score:score,sets:normalizedSets};
  }
  function createInterzonalMatchFromSets(slot,teamAId,setsA,setsB,setScores){
    var c=category();
    if(!c||!isTorneo50(c))throw Error('Los partidos Interzonales C-D solo aplican a Categoría +50.');
    if(c.currentStage===STAGES.FINISHED)throw Error('El torneo ya finalizó.');
    var slotNum=Number(slot),iz=interzonalStatus(c),slotObj=iz.slots.filter(function(s){return s.slot===slotNum;})[0];
    if(!slotObj||!slotObj.assigned)throw Error('Primero guardá ambos equipos del Enfrentamiento '+slotNum+' en Interzonal C-D.');
    if(slotObj.match)throw Error('Ese cruce Interzonal C-D ya tiene un resultado cargado.');
    if(teamAId!==slotObj.teamCId&&teamAId!==slotObj.teamDId)throw Error('El equipo indicado no pertenece a este cruce interzonal.');
    var teamBId=teamAId===slotObj.teamCId?slotObj.teamDId:slotObj.teamCId;
    var parsed=orientSetsForTeams(teamAId,setsA,teamBId,setsB,setScores);
    var created={id:uid('match'),categoryId:c.id,winnerId:parsed.winner,loserId:parsed.loser,score:parsed.score,sets:parsed.sets,stage:STAGES.GENERAL,zoneId:null,matchType:MATCH_TYPES.INTERZONAL,interzonalSlot:slotNum,createdAt:new Date().toISOString()};
    state.matchResults.push(created);
    syncCategoryCarriedStats(c);
    if(!saveState()){state.matchResults.pop();syncCategoryCarriedStats(c);throw Error('No se pudo guardar el resultado interzonal.');}
    return created;
  }
  function createPlayoffMatchFromSets(bracketId,teamAId,setsA,setsB,setScores){
    var c=category();
    if(!c||!hasPlayoffsFormat(c))throw Error('Esta categoría no tiene cruces finales.');
    if(c.currentStage===STAGES.FINISHED)throw Error('El torneo ya finalizó.');
    var po=computePlayoffs(c);
    if(!po.unlocked)throw Error(po.reasons.join(' ')||'Los cruces finales todavía no están habilitados.');
    var slot=po.slots.filter(function(s){return s.id===bracketId;})[0];
    if(!slot||!slot.ready)throw Error('Este cruce todavía espera la definición de la llave previa.');
    if(slot.match)throw Error('Este cruce ya tiene un resultado cargado.');
    if(teamAId!==slot.teamA.id&&teamAId!==slot.teamB.id)throw Error('El equipo indicado no participa de este cruce.');
    var teamBId=teamAId===slot.teamA.id?slot.teamB.id:slot.teamA.id;
    var parsed=orientSetsForTeams(teamAId,setsA,teamBId,setsB,setScores);
    var created={id:uid('match'),categoryId:c.id,winnerId:parsed.winner,loserId:parsed.loser,score:parsed.score,sets:parsed.sets,stage:STAGES.PLAYOFFS,zoneId:null,matchType:MATCH_TYPES.PLAYOFF,bracketId:slot.id,bracketLabel:slot.label,createdAt:new Date().toISOString()};
    state.matchResults.push(created);
    syncChampionFromPlayoffs(c);
    if(!saveState()){state.matchResults.pop();syncChampionFromPlayoffs(c);throw Error('No se pudo guardar el cruce final.');}
    return created;
  }
  function deleteMatchResult(matchId){
    var match=state.matchResults.filter(function(r){return r.id===matchId;})[0];
    if(!match||match.categoryId!==state.selectedCategoryId)throw Error('Resultado inválido para esta categoría.');
    var targetCat=state.categories.filter(function(c){return c.id===match.categoryId;})[0];
    var previous=state.matchResults;
    state.matchResults=state.matchResults.filter(function(r){return r.id!==matchId;});
    if(match.matchType===MATCH_TYPES.PLAYOFF&&(match.bracketId==='semi-1'||match.bracketId==='semi-2')){
      state.matchResults=state.matchResults.filter(function(r){return!(r.categoryId===match.categoryId&&r.matchType===MATCH_TYPES.PLAYOFF&&(r.bracketId==='final'||r.bracketId==='third-place'));});
    }
    if(match.stage===STAGES.GENERAL&&targetCat)syncCategoryCarriedStats(targetCat);
    if(match.matchType===MATCH_TYPES.PLAYOFF&&targetCat)syncChampionFromPlayoffs(targetCat);
    if(!saveState()){
      state.matchResults=previous;
      if(match.stage===STAGES.GENERAL&&targetCat)syncCategoryCarriedStats(targetCat);
      if(match.matchType===MATCH_TYPES.PLAYOFF&&targetCat)syncChampionFromPlayoffs(targetCat);
      throw Error('No se pudo guardar la eliminación.');
    }
  }
  function updateMatchResult(matchId,score,sets){
    var match=state.matchResults.filter(function(r){return r.id===matchId;})[0];
    if(!match||match.categoryId!==state.selectedCategoryId)throw Error('Resultado inválido para esta categoría.');
    if(score!=='2-0'&&score!=='2-1')throw Error('El resultado debe ser 2–0 o 2–1.');
    var targetCat=state.categories.filter(function(c){return c.id===match.categoryId;})[0];
    var previous={score:match.score,sets:match.sets,updatedAt:match.updatedAt};
    try{
      var nextSets=match.sets;
      if(typeof sets!=='undefined'){
        nextSets=Array.isArray(sets)&&sets.length===0?[]:validateMatchSets(sets);
        if(nextSets.length){var wins=setWinnerCount(nextSets);if(wins.a!==2||score!=='2-'+wins.b)throw Error('El resultado tradicional no coincide con los marcadores.');}
      }else if(Array.isArray(nextSets)&&nextSets.length){
        if(matchSetsFor({score:score,sets:nextSets}).length!==nextSets.length)nextSets=[];
      }
      match.score=score;match.sets=nextSets;match.updatedAt=new Date().toISOString();
      if(match.stage===STAGES.GENERAL&&targetCat)syncCategoryCarriedStats(targetCat);
    }catch(error){
      match.score=previous.score;match.sets=previous.sets;
      if(typeof previous.updatedAt==='undefined')delete match.updatedAt;else match.updatedAt=previous.updatedAt;
      if(match.stage===STAGES.GENERAL&&targetCat)syncCategoryCarriedStats(targetCat);
      throw error;
    }
    if(!saveState()){
      match.score=previous.score;match.sets=previous.sets;
      if(typeof previous.updatedAt==='undefined')delete match.updatedAt;else match.updatedAt=previous.updatedAt;
      if(match.stage===STAGES.GENERAL&&targetCat)syncCategoryCarriedStats(targetCat);
      throw Error('No se pudo guardar la corrección.');
    }
    return match;
  }
  function updateMatchFromSets(matchId,teamAId,setsA,setsB,setScores){
    var match=state.matchResults.filter(function(r){return r.id===matchId;})[0];
    if(!match||match.categoryId!==state.selectedCategoryId)throw Error('Resultado inválido para esta categoría.');
    if(teamAId!==match.winnerId&&teamAId!==match.loserId)throw Error('El equipo indicado no participa de este resultado.');
    var targetCat=state.categories.filter(function(c){return c.id===match.categoryId;})[0];
    var teamBId=teamAId===match.winnerId?match.loserId:match.winnerId;
    var parsed=orientSetsForTeams(teamAId,setsA,teamBId,setsB,typeof setScores==='undefined'?undefined:setScores);
    var nextSets=typeof setScores==='undefined'?match.sets:parsed.sets;
    if(typeof setScores==='undefined'&&Array.isArray(nextSets)&&nextSets.length){
      if(parsed.winner!==match.winnerId&&parsed.score===match.score)nextSets=nextSets.map(function(s){return{a:s.b,b:s.a};});
      if(matchSetsFor({score:parsed.score,sets:nextSets}).length!==nextSets.length)nextSets=[];
    }
    var previousResults=state.matchResults.slice();
    var previous={winnerId:match.winnerId,loserId:match.loserId,score:match.score,sets:match.sets,updatedAt:match.updatedAt};
    var winnerChanged=match.winnerId!==parsed.winner;
    match.winnerId=parsed.winner;match.loserId=parsed.loser;match.score=parsed.score;match.sets=nextSets;match.updatedAt=new Date().toISOString();
    if(match.stage===STAGES.GENERAL&&targetCat)syncCategoryCarriedStats(targetCat);
    if(match.matchType===MATCH_TYPES.PLAYOFF&&targetCat){
      if(winnerChanged&&(match.bracketId==='semi-1'||match.bracketId==='semi-2')){
        state.matchResults=state.matchResults.filter(function(r){return!(r.categoryId===match.categoryId&&r.matchType===MATCH_TYPES.PLAYOFF&&(r.bracketId==='final'||r.bracketId==='third-place'));});
      }
      syncChampionFromPlayoffs(targetCat);
    }
    if(!saveState()){
      state.matchResults=previousResults;
      match.winnerId=previous.winnerId;match.loserId=previous.loserId;match.score=previous.score;match.sets=previous.sets;
      if(typeof previous.updatedAt==='undefined')delete match.updatedAt;else match.updatedAt=previous.updatedAt;
      if(match.stage===STAGES.GENERAL&&targetCat)syncCategoryCarriedStats(targetCat);
      if(match.matchType===MATCH_TYPES.PLAYOFF&&targetCat)syncChampionFromPlayoffs(targetCat);
      throw Error('No se pudo guardar la corrección.');
    }
    return match;
  }

  // ---------------------------------------------------------------------------
  // Scoreboard Manual & Asistente de Flujo
  // ---------------------------------------------------------------------------
  function activeZonesForCategory(c){
    if(!c)return[];
    if(isSingleZoneCategory(c)){
      var fz=finalZoneOf(c);
      return fz?[fz]:[];
    }
    if(c.currentStage===STAGES.ZONE_FINAL||c.currentStage===STAGES.PLAYOFFS){
      return secondStageZonesOf(c).concat(qualifyingZonesOf(c));
    }
    return qualifyingZonesOf(c);
  }
  function zoneTeamsForLoader(c,zoneId){
    if(!c)return[];
    var z=zoneId?zoneById(c,zoneId):null;
    if(z&&z.teamIds.length)return z.teamIds.map(teamById).filter(Boolean);
    return active(c.id);
  }
  function findExistingMatch(c,zoneId,teamAId,teamBId){
    if(!c||!teamAId||!teamBId||teamAId===teamBId)return null;
    if(zoneId===INTERZONAL_LOADER_ID){
      return interzonalMatches(c.id).filter(function(r){return pairKey(r.winnerId,r.loserId)===pairKey(teamAId,teamBId);})[0]||null;
    }
    if(zoneId===PLAYOFFS_LOADER_ID)return null;
    var stage=stageForZone(c,zoneId);
    var targetZone=zoneId||null;
    return categoryMatches(c.id).filter(function(r){
      return r.matchType!==MATCH_TYPES.INTERZONAL&&r.matchType!==MATCH_TYPES.PLAYOFF&&r.stage===stage&&r.zoneId===targetZone&&((r.winnerId===teamAId&&r.loserId===teamBId)||(r.winnerId===teamBId&&r.loserId===teamAId));
    })[0]||null;
  }
  function defaultPairForZone(c,zoneId){
    var pool=zoneTeamsForLoader(c,zoneId);
    if(!pool.length)return{teamAId:'',teamBId:''};
    if(pool.length===1)return{teamAId:pool[0].id,teamBId:''};
    for(var i=0;i<pool.length;i+=1){
      for(var j=0;j<pool.length;j+=1){
        if(i!==j&&!findExistingMatch(c,zoneId,pool[i].id,pool[j].id))return{teamAId:pool[i].id,teamBId:pool[j].id};
      }
    }
    return{teamAId:pool[0].id,teamBId:pool[1].id};
  }
  function categoryProgressSummary(c){
    var f=zoneFlow(c),allZones=f.zones,allTeams=teams(c.id),played=categoryMatches(c.id).length;
    return{zonesCount:allZones.length,qualifyingZonesCount:qualifyingZonesOf(c).length,teamsCount:allTeams.length,playedCount:played};
  }
  function nextStepGuide(c){
    var prog=categoryProgressSummary(c),single=isSingleZoneCategory(c);
    if(!prog.zonesCount){
      return{step:1,tone:'guide',title:'Paso 1: Creá las zonas clasificatorias',desc:'Empezá creando cada zona clasificatoria (por ejemplo: Zona 4, Zona 5) para anotar a sus equipos.',ctaView:'zones',ctaLabel:'Crear zona'};
    }
    if(prog.teamsCount<2){
      return{step:1,tone:'guide',title:'Paso 1: Agregá al menos 2 equipos',desc:single?'Escribí el nombre de cada equipo dentro de la Zona única para jugar todos contra todos.':'Escribí el nombre de cada equipo directamente dentro de la tarjeta de su zona.',ctaView:'zones',ctaLabel:'Agregar equipos'};
    }
    if(isTorneo50(c)&&c.currentStage===STAGES.GENERAL){
      var iz=interzonalStatus(c);
      if(!iz.allAssigned)return{step:1,tone:'action',title:'Fase 1 (+50) · Completá las zonas y el Interzonal C-D',desc:'Distribuí los 14 equipos (A:4, B:4, C:3, D:3) y asigná los 3 cruces en la sección Interzonal C-D.',ctaView:'zones',ctaLabel:'Ir a Zonas e Interzonal →'};
      if(prog.playedCount===0)return{step:2,tone:'action',title:'Paso 2: Cargá los partidos de Fase 1 e Interzonal C-D',desc:'Cargá los cruces internos de A, B, C y D y los 3 partidos del Interzonal C-D.',ctaView:'results',ctaLabel:'Ir a cargar resultado →'};
      var q50=evaluateZoneQualification(c);
      if(q50.ready)return{step:1,tone:'ready',title:'Fase 1 completa · Lista para Ronda Campeonato y Estímulo',desc:'Ya podés cerrar la Fase 1 para generar Zona 1, Zona 2 y Zona 3.',ctaView:'zones',ctaLabel:'Cerrar Fase 1 →'};
      return{step:3,tone:'ready',title:'Fase 1 en curso (+50) · '+prog.playedCount+'/21 partidos cargados',desc:'Interzonal C-D: '+iz.playedCount+'/3 jugados. Seguí cargando los partidos del viernes.',ctaView:'positions',ctaLabel:'Ver posiciones →'};
    }
    if(isTorneo60(c)&&c.currentStage===STAGES.GENERAL){
      var q60=evaluateZoneQualification(c);
      if(q60.ready)return{step:1,tone:'ready',title:'Fase 1 (+60) completa · Lista para Zonas 1 a 6',desc:'Ya podés cerrar la Fase de Grupos para armar los 6 triangulares del domingo.',ctaView:'zones',ctaLabel:'Cerrar Fase 1 →'};
      return{step:2,tone:'ready',title:'Fase 1 en curso (+60) · '+prog.playedCount+'/45 partidos cargados',desc:'Cargá los 15 partidos de cada zona de 6 equipos (Zonas A, B y C).',ctaView:'results',ctaLabel:'Cargar resultado →'};
    }
    if(isTorneo68(c)){
      var po68=computePlayoffs(c);
      if(po68.allComplete)return{step:3,tone:'ready',title:'Torneo +68 definido · Clasificación final disponible',desc:'Ya se completaron la Zona única y los Cruces Finales (Semis, Final y 3°/4°).',ctaView:'positions',ctaLabel:'Ver clasificación final →'};
      if(po68.unlocked)return{step:2,tone:'action',title:'Cruces Finales (+68) habilitados',desc:'Cargá Semifinal 1 (1° vs 4°), Semifinal 2 (2° vs 3°), Gran Final y 3°/4° puesto.',ctaView:'results',ctaLabel:'Cargar Cruces Finales →'};
      return{step:2,tone:'ready',title:'Zona única (+68) en curso · '+prog.playedCount+'/28 partidos',desc:'Los 8 equipos juegan todos contra todos; los 4 primeros avanzan a Semifinales.',ctaView:'positions',ctaLabel:'Ver Tabla General →'};
    }
    if(prog.playedCount===0){
      return{step:2,tone:'action',title:'Paso 2: Cargá el resultado de un partido',desc:'Elegí la zona y los dos equipos que jugaron para anotar los puntos de cada set.',ctaView:'results',ctaLabel:'Ir a cargar resultado →'};
    }
    if(single){
      return{step:3,tone:'ready',title:'Todos contra todos en curso · '+prog.playedCount+' partido'+(prog.playedCount===1?'':'s')+' cargado'+(prog.playedCount===1?'':'s'),desc:'Seguí cargando los cruces a medida que se juegan. La tabla de la Zona única define las posiciones finales.',ctaView:'positions',ctaLabel:'Ver posiciones →'};
    }
    if(c.currentStage===STAGES.GENERAL){
      return{step:3,tone:'ready',title:'Fase clasificatoria en curso · '+prog.playedCount+' partido'+(prog.playedCount===1?'':'s')+' cargado'+(prog.playedCount===1?'':'s'),desc:'Seguí cargando resultados manualmente o cerrá las zonas clasificatorias para pasar los 2 mejores de cada zona a la Zona final.',ctaView:'positions',ctaLabel:'Ver posiciones →'};
    }
    if(hasPlayoffsFormat(c)){
      var po=computePlayoffs(c);
      if(po.allComplete)return{step:3,tone:'ready',title:'Torneo definido · Clasificación final completa',desc:'Todas las zonas y cruces finales están completos.',ctaView:'positions',ctaLabel:'Ver posiciones finales →'};
      if(po.unlocked)return{step:2,tone:'action',title:'Día 3: Cruces Finales habilitados',desc:'Ya podés cargar Semifinales, Final, 3°/4° y reclasificación mientras sigue el resto.',ctaView:'results',ctaLabel:'Cargar Cruces Finales →'};
      return{step:3,tone:'ready',title:'Segunda fase en curso',desc:'Cargá los partidos de las zonas de Segunda Fase para habilitar los Cruces Finales.',ctaView:'positions',ctaLabel:'Ver tablas →'};
    }
    return{step:3,tone:'ready',title:'Zona final en curso (todos contra todos)',desc:'Los 2 mejores de cada zona clasificatoria juegan todos contra todos. La tabla de la Zona final define las posiciones del torneo.',ctaView:'positions',ctaLabel:'Ver tabla final →'};
  }

  function initLoaderDraft(c,preferredZoneId,extra){
    var zones=activeZonesForCategory(c);
    var opts=extra||{};
    if(preferredZoneId===INTERZONAL_LOADER_ID&&isTorneo50(c)){
      var iz=interzonalStatus(c);
      var slotObj=(opts.interzonalSlot&&iz.slots.filter(function(s){return s.slot===Number(opts.interzonalSlot)&&s.assigned;})[0])||iz.slots.filter(function(s){return s.assigned&&!s.match;})[0]||iz.slots.filter(function(s){return s.assigned;})[0]||null;
      return{categoryId:c.id,editMatchId:null,zoneId:INTERZONAL_LOADER_ID,interzonalSlot:slotObj?slotObj.slot:1,bracketId:'',teamAId:slotObj?slotObj.teamCId:'',teamBId:slotObj?slotObj.teamDId:'',s1A:'',s1B:'',s2A:'',s2B:'',s3A:'',s3B:'',historyOpen:false};
    }
    if(preferredZoneId===PLAYOFFS_LOADER_ID&&hasPlayoffsFormat(c)){
      var po=computePlayoffs(c);
      var bSlot=(opts.bracketId&&po.slots.filter(function(s){return s.id===opts.bracketId&&s.ready;})[0])||po.slots.filter(function(s){return s.ready&&!s.match;})[0]||po.slots.filter(function(s){return s.ready;})[0]||null;
      return{categoryId:c.id,editMatchId:null,zoneId:PLAYOFFS_LOADER_ID,interzonalSlot:null,bracketId:bSlot?bSlot.id:'',teamAId:bSlot&&bSlot.teamA?bSlot.teamA.id:'',teamBId:bSlot&&bSlot.teamB?bSlot.teamB.id:'',s1A:'',s1B:'',s2A:'',s2B:'',s3A:'',s3B:'',historyOpen:false};
    }
    var z=(preferredZoneId&&zoneById(c,preferredZoneId))||zones[0]||null;
    var zoneId=z?z.id:'';
    var pair=defaultPairForZone(c,zoneId);
    return{categoryId:c.id,editMatchId:null,zoneId:zoneId,interzonalSlot:null,bracketId:'',teamAId:pair.teamAId,teamBId:pair.teamBId,s1A:'',s1B:'',s2A:'',s2B:'',s3A:'',s3B:'',historyOpen:false};
  }
  function ensureLoaderDraft(c){
    if(!c)return null;
    if(!loaderDraft||loaderDraft.categoryId!==c.id)loaderDraft=initLoaderDraft(c);
    return loaderDraft;
  }
  function ensureInterzonalDraft(c){
    if(!c||!isTorneo50(c))return null;
    var iz=interzonalStatus(c);
    if(!interzonalDraft||interzonalDraft.categoryId!==c.id){
      var slots={};
      iz.slots.forEach(function(s){slots[s.slot]={teamCId:s.teamCId||'',teamDId:s.teamDId||''};});
      interzonalDraft={categoryId:c.id,slots:slots};
    }else{
      iz.slots.forEach(function(s){
        var cur=interzonalDraft.slots[s.slot];
        if(!cur){interzonalDraft.slots[s.slot]={teamCId:s.teamCId||'',teamDId:s.teamDId||''};return;}
        if(cur.teamCId&&(!iz.zoneC||iz.zoneC.teamIds.indexOf(cur.teamCId)<0))cur.teamCId='';
        if(cur.teamDId&&(!iz.zoneD||iz.zoneD.teamIds.indexOf(cur.teamDId)<0))cur.teamDId='';
      });
    }
    return interzonalDraft;
  }
  function parseSetField(raw){
    var str=String(raw==null?'':raw).trim();
    if(str==='')return{empty:true,valid:false,value:null};
    var num=Number(str);
    if(!/^\d+$/.test(str)||!Number.isInteger(num)||num<0)return{empty:false,valid:false,error:'Ingresá un entero mayor o igual a 0.',value:null};
    return{empty:false,valid:true,value:num};
  }
  function evaluateSetRow(rawA,rawB,required){
    var a=parseSetField(rawA),b=parseSetField(rawB);
    if(a.empty&&b.empty)return{empty:true,complete:false,valid:!required,error:required?'Completá ambos marcadores del set.':null,winner:null,a:null,b:null};
    if(!a.empty&&!a.valid)return{empty:false,complete:false,valid:false,error:a.error,winner:null,a:null,b:null};
    if(!b.empty&&!b.valid)return{empty:false,complete:false,valid:false,error:b.error,winner:null,a:null,b:null};
    if(a.empty||b.empty)return{empty:false,complete:false,valid:false,error:'Completá el marcador de ambos equipos.',winner:null,a:a.value,b:b.value};
    if(a.value===b.value)return{empty:false,complete:true,valid:false,error:'El set no puede terminar empatado.',winner:null,a:a.value,b:b.value,tied:true};
    return{empty:false,complete:true,valid:true,error:null,winner:a.value>b.value?'A':'B',a:a.value,b:b.value};
  }
  function evaluateScoreboard(c,draft){
    var teamA=teamById(draft.teamAId),teamB=teamById(draft.teamBId),teamError=null,duplicateMatch=null;
    if(draft.zoneId===INTERZONAL_LOADER_ID){
      var iz=interzonalStatus(c),slotObj=iz.slots.filter(function(s){return s.slot===Number(draft.interzonalSlot);})[0];
      if(!slotObj||!slotObj.assigned)teamError='Seleccioná un cruce Interzonal C-D guardado.';
      else if(slotObj.match&&slotObj.match.id!==draft.editMatchId)duplicateMatch=slotObj.match;
    }else if(draft.zoneId===PLAYOFFS_LOADER_ID){
      var po=computePlayoffs(c),bSlot=po.slots.filter(function(s){return s.id===draft.bracketId;})[0];
      if(!po.unlocked)teamError=po.reasons.join(' ')||'Cruces finales aún bloqueados.';
      else if(!bSlot||!bSlot.ready)teamError='Seleccioná un cruce final habilitado.';
      else if(bSlot.match&&bSlot.match.id!==draft.editMatchId)duplicateMatch=bSlot.match;
    }else{
      if(!teamA||!teamB)teamError='Seleccioná ambos equipos.';
      else if(teamA.id===teamB.id)teamError='Elegí dos equipos distintos.';
      else if(c&&draft.zoneId){
        var z=zoneById(c,draft.zoneId);
        if(z&&z.teamIds.length&&(z.teamIds.indexOf(teamA.id)<0||z.teamIds.indexOf(teamB.id)<0))teamError='Ambos equipos deben pertenecer a '+z.name+'.';
      }
      if(!teamError&&c){
        var existing=findExistingMatch(c,draft.zoneId,teamA.id,teamB.id);
        if(existing&&existing.id!==draft.editMatchId)duplicateMatch=existing;
      }
    }
    var s1=evaluateSetRow(draft.s1A,draft.s1B,false),s2=evaluateSetRow(draft.s2A,draft.s2B,false);
    var winsA=(s1.winner==='A'?1:0)+(s2.winner==='A'?1:0),winsB=(s1.winner==='B'?1:0)+(s2.winner==='B'?1:0);
    var needsSet3=s1.valid&&s2.valid&&winsA===1&&winsB===1;
    var s3=needsSet3?evaluateSetRow(draft.s3A,draft.s3B,false):{empty:true,complete:false,valid:true,error:null,winner:null,a:null,b:null};
    if(needsSet3&&s3.winner){if(s3.winner==='A')winsA+=1;else winsB+=1;}
    var hasAnyInput=!s1.empty||!s2.empty||(needsSet3&&!s3.empty);
    var ready=(winsA===2||winsB===2)&&!teamError&&!duplicateMatch&&s1.valid&&s2.valid&&(!needsSet3||s3.valid);
    var previewText='Ingresá los puntos de Set 1 y Set 2 para calcular el ganador.';
    if(teamError)previewText=teamError;
    else if(duplicateMatch){
      var dupW=teamById(duplicateMatch.winnerId),dupL=teamById(duplicateMatch.loserId);
      previewText='Este partido ya está cargado ('+(dupW?dupW.name:'Equipo')+' '+duplicateMatch.score.replace('-','–')+' '+(dupL?dupL.name:'Equipo')+').';
    }else if(ready){
      var winnerName=winsA>winsB?(teamA?teamA.name:'Equipo 1'):(teamB?teamB.name:'Equipo 2');
      previewText=winnerName+' gana '+Math.max(winsA,winsB)+' – '+Math.min(winsA,winsB);
    }else if(needsSet3){
      previewText='Empate 1 – 1 en sets · Cargá el Set 3 para definir el ganador.';
    }else if(hasAnyInput){
      previewText='Marcador parcial en sets: '+(teamA?teamA.name:'Equipo 1')+' '+winsA+' – '+winsB+' '+(teamB?teamB.name:'Equipo 2');
    }
    var sets=[];
    if(s1.valid)sets.push({a:s1.a,b:s1.b});
    if(s2.valid)sets.push({a:s2.a,b:s2.b});
    if(needsSet3&&s3.valid)sets.push({a:s3.a,b:s3.b});
    return{teamA:teamA,teamB:teamB,teamError:teamError,duplicateMatch:duplicateMatch,s1:s1,s2:s2,s3:s3,winsA:winsA,winsB:winsB,needsSet3:needsSet3,ready:ready,previewText:previewText,sets:sets};
  }
  function saveScoreboardMatch(c,draft){
    var evalState=evaluateScoreboard(c,draft);
    if(!evalState.ready)throw Error(evalState.teamError||(evalState.duplicateMatch?'Este partido ya está cargado.':null)||evalState.s1.error||evalState.s2.error||evalState.s3.error||'Completá los sets disputados antes de guardar.');
    if(draft.editMatchId){
      var existing=state.matchResults.filter(function(r){return r.id===draft.editMatchId;})[0];
      if(!existing)throw Error('El partido a editar ya no existe.');
      var snapshot=JSON.parse(JSON.stringify(existing));
      updateMatchFromSets(existing.id,evalState.teamA.id,evalState.winsA,evalState.winsB,evalState.sets);
      toastState={kind:'update',matchId:existing.id,snapshot:snapshot,text:teamById(existing.winnerId).name+' '+existing.score.replace('-','–')+' '+teamById(existing.loserId).name+' guardado'};
      loaderDraft=initLoaderDraft(c,draft.zoneId);
      return existing;
    }
    var created;
    if(draft.zoneId===INTERZONAL_LOADER_ID){
      created=createInterzonalMatchFromSets(draft.interzonalSlot,evalState.teamA.id,evalState.winsA,evalState.winsB,evalState.sets);
    }else if(draft.zoneId===PLAYOFFS_LOADER_ID){
      created=createPlayoffMatchFromSets(draft.bracketId,evalState.teamA.id,evalState.winsA,evalState.winsB,evalState.sets);
    }else{
      created=createMatchFromSets(evalState.teamA.id,evalState.winsA,evalState.teamB.id,evalState.winsB,evalState.sets,draft.zoneId||undefined);
    }
    toastState={kind:'create',matchId:created.id,text:teamById(created.winnerId).name+' '+created.score.replace('-','–')+' '+teamById(created.loserId).name+' guardado'};
    loaderDraft=initLoaderDraft(c,draft.zoneId);
    return created;
  }

  // ---------------------------------------------------------------------------
  // Vistas de la Interfaz
  // ---------------------------------------------------------------------------
  function sidebar(){
    var c=category(),prog=c?categoryProgressSummary(c):null;
    return'<aside class="sidebar">'+
      '<div class="brand"><span class="logo">P</span><div><b>Puntaje Newcom</b><small>TORNEOS POR SETS</small></div></div>'+
      '<nav class="nav">'+
        '<div class="nav-label">INICIO</div>'+
        '<button data-view="home" class="'+(view==='home'||view==='categories'?'active':'')+'"><span>⌂</span> Mis Categorías <em>'+state.categories.length+'</em></button>'+
        (c?
          '<div class="nav-label" style="margin-top:20px">PASOS · '+esc(c.name.toUpperCase())+'</div>'+
          '<button data-view="zones" class="'+(view==='zones'||view==='teams'?'active':'')+'"><span>1</span> Zonas y Equipos <em>'+prog.teamsCount+'</em></button>'+
          '<button data-view="results" class="'+(view==='results'?'active':'')+'"><span>2</span> Cargar resultado</button>'+
          '<button data-view="positions" class="'+(view==='positions'||view==='table'?'active':'')+'"><span>3</span> Posiciones</button>'+
          '<button data-view="matches" class="'+(view==='matches'?'active':'')+'"><span>4</span> Partidos Jugados <em>'+categoryMatches(c.id).length+'</em></button>'
        :'')+
      '</nav>'+
      '<div class="sidebar-foot">'+
        '<div class="tip"><strong>¿Cómo funciona?</strong><br>1. Armá zonas y equipos<br>2. Anotá los sets jugados<br>3. Revisá las posiciones</div>'+
        '<small>Puntaje Newcom · 2026</small>'+
      '</div>'+
    '</aside>';
  }
  function shell(content){
    var c=category();
    return'<div class="app">'+sidebar()+'<div class="main"><header class="topbar"><div class="mobile-brand"><span class="logo">P</span><b>Puntaje Newcom</b></div><div class="crumb"><small>'+(c?'CATEGORÍA ACTIVA':'PANEL PRINCIPAL')+'</small><b>'+(c?esc(c.name):'Mis Categorías')+'</b></div><div class="topbar-actions">'+(state.categories.length>1?'<select class="topbar-category-select" data-action="quick-switch-category" aria-label="Cambiar categoría">'+state.categories.map(function(cat){return'<option value="'+cat.id+'" '+(cat.id===state.selectedCategoryId?'selected':'')+'>'+esc(cat.name)+'</option>';}).join('')+'</select>':'')+'<button class="theme" data-action="theme">'+(theme==='dark'?'☀ Claro':'☾ Oscuro')+'</button></div></header><main>'+content+'</main></div></div>';
  }
  function picker(){
    return'<label class="category-picker">Categoría<select data-action="select-category">'+state.categories.map(function(c){return'<option value="'+c.id+'" '+(c.id===state.selectedCategoryId?'selected':'')+'>'+esc(c.name)+'</option>';}).join('')+'</select></label>';
  }
  function home(){
    var totalZones=state.categories.reduce(function(acc,c){return acc+zoneFlow(c).zones.length;},0);
    return'<div class="heading"><div><p class="eyebrow">PANEL DE CONTROL</p><h1>Mis Categorías</h1><p class="desc">Seleccioná una categoría para armar sus zonas, cargar resultados por set y consultar las posiciones.</p></div><div class="heading-actions"><button class="primary" data-action="new-category">＋ Nueva categoría</button></div></div>'+
      '<section class="onboarding-steps">'+
        '<div class="onboard-step"><span class="onboard-num">1</span><div><b>Creá la categoría</b><small>+50 (14 eq.), +60 (18 eq.), +68 (8 eq.) o +40 genérico.</small></div></div>'+
        '<div class="onboard-step"><span class="onboard-num">2</span><div><b>Armá zonas y cruces</b><small>Cargá los equipos y administrá el Interzonal C-D en +50.</small></div></div>'+
        '<div class="onboard-step"><span class="onboard-num">3</span><div><b>Cargá sets y mirá cruces</b><small>Tablas, triangulares, semifinales y clasificación final automática.</small></div></div>'+
      '</section>'+
      '<div class="summary summary-4">'+
        '<div class="stat"><i>▦</i><div><small>CATEGORÍAS</small><b>'+state.categories.length+'</b></div></div>'+
        '<div class="stat"><i>◉</i><div><small>ZONAS</small><b>'+totalZones+'</b></div></div>'+
        '<div class="stat"><i>♙</i><div><small>EQUIPOS</small><b>'+state.teams.length+'</b></div></div>'+
        '<div class="stat"><i>▥</i><div><small>PARTIDOS CARGADOS</small><b>'+state.matchResults.length+'</b></div></div>'+
      '</div>'+
      '<div id="notice"></div>'+
      (state.categories.length?
        '<div class="category-grid">'+state.categories.map(function(c){
          var prog=categoryProgressSummary(c);
          return'<article class="category-card">'+
            '<button class="category-card-open" data-category="'+c.id+'">'+
              '<div class="category-card-top"><span class="avatar">'+initial(c.name)+'</span><span class="badge">'+esc(categoryStageLabel(c))+'</span></div>'+
              '<h3>'+esc(c.name)+'</h3>'+
              '<p class="desc" style="margin:0 0 8px;font-size:12px">'+esc(FORMAT_LABELS[c.format]||FORMAT_LABELS[FORMATS.ZONES_AND_FINAL])+'</p>'+
              '<div class="meta"><span><strong>'+prog.zonesCount+'</strong> zona'+(prog.zonesCount===1?'':'s')+'</span><span><strong>'+prog.teamsCount+'</strong> equipo'+(prog.teamsCount===1?'':'s')+'</span><span><strong>'+prog.playedCount+'</strong> partido'+(prog.playedCount===1?'':'s')+'</span></div>'+
            '</button>'+
            '<div class="actions">'+
              '<button class="link" data-category="'+c.id+'">Abrir categoría →</button>'+
              '<button class="link" data-action="edit-category" data-id="'+c.id+'">Renombrar</button>'+
              '<button class="link danger" data-action="delete-category" data-id="'+c.id+'">Eliminar</button>'+
            '</div>'+
          '</article>';
        }).join('')+'</div>'
      :
        '<section class="card empty">'+
          '<div class="big">🏐</div>'+
          '<h2>Todavía no hay categorías creadas</h2>'+
          '<p>Empezá creando tu primera categoría (<strong>Categoría +50</strong>, <strong>Categoría +60</strong>, <strong>Categoría +68</strong> o <strong>Categoría +40</strong>) para armar las zonas y cargar partidos.</p>'+
          '<button class="primary" data-action="new-category">＋ Crear mi primera categoría</button>'+
        '</section>');
  }
  function categoryHeader(c){
    var prog=categoryProgressSummary(c),guide=nextStepGuide(c);
    var activeTab=(view==='teams'?'zones':(view==='table'?'positions':view));
    return'<div class="category-top-bar">'+
        '<button type="button" class="back-home-link" data-view="home">← Todas las categorías</button>'+
        '<div class="heading-actions"><span class="badge">'+esc(categoryStageLabel(c))+'</span><button class="link" data-action="edit-category" data-id="'+c.id+'">Renombrar</button><button class="link danger delete-category-button" data-action="delete-active-category" data-id="'+c.id+'">Eliminar categoría</button></div>'+
      '</div>'+
      '<div class="heading category-main-heading"><div><h1>'+esc(c.name)+'</h1><p class="desc">'+esc(FORMAT_LABELS[c.format]||FORMAT_LABELS[FORMATS.ZONES_AND_FINAL])+' · '+prog.zonesCount+' zona'+(prog.zonesCount===1?'':'s')+' · '+prog.teamsCount+' equipo'+(prog.teamsCount===1?'':'s')+' · '+prog.playedCount+' partido'+(prog.playedCount===1?'':'s')+' cargado'+(prog.playedCount===1?'':'s')+'</p></div></div>'+
      '<div class="guide-banner '+guide.tone+'">'+
        '<div><strong>'+esc(guide.title)+'</strong><span>'+esc(guide.desc)+'</span></div>'+
        (activeTab!==guide.ctaView?'<button type="button" class="primary guide-cta" data-view="'+guide.ctaView+'">'+esc(guide.ctaLabel)+'</button>':'')+
      '</div>'+
      '<div id="notice"></div>'+
      '<nav class="workflow-stepper" aria-label="Pasos del torneo">'+
        '<button type="button" data-view="zones" class="step-tab '+(activeTab==='zones'?'active':'')+'"><span class="step-num">1</span><div><b>Zonas y Equipos</b><small>'+prog.zonesCount+' zona'+(prog.zonesCount===1?'':'s')+' · '+prog.teamsCount+' equipos</small></div></button>'+
        '<button type="button" data-view="results" class="step-tab '+(activeTab==='results'?'active':'')+'"><span class="step-num">2</span><div><b>Cargar resultado</b><small>Carga manual por sets</small></div></button>'+
        '<button type="button" data-view="positions" class="step-tab '+(activeTab==='positions'?'active':'')+'"><span class="step-num">3</span><div><b>Posiciones</b><small>Tablas y cruces</small></div></button>'+
        '<button type="button" data-view="matches" class="step-tab '+(activeTab==='matches'?'active':'')+'"><span class="step-num">4</span><div><b>Partidos Jugados</b><small>'+categoryMatches(c.id).length+' registrados</small></div></button>'+
      '</nav>';
  }

  function zoneCard(c,z){
    var f=zoneFlow(c),single=isSingleZoneCategory(c),isQual=z.phase===ZONE_PHASES.QUALIFYING;
    var editable=single?(c.currentStage!==STAGES.FINISHED):(!isQual?false:(c.currentStage===STAGES.GENERAL&&f.status!==ZONE_STATUS.FINISHED));
    var assigned=z.teamIds.map(teamById).filter(Boolean),unassigned=teams(c.id).filter(function(t){return!teamZone(c,t.id);});
    var stage=stageForZone(c,z.id),prog=zoneProgressInfo(c,z,stage);
    var target=zoneTargetTeams(c,z),isFull=Boolean(target&&assigned.length>=target);
    var fixedStructure=isTorneo50(c)||isTorneo60(c)||isTorneo68(c);
    var phaseBadge=isTorneo68(c)?'ZONA ÚNICA · 8 EQUIPOS (TODOS CONTRA TODOS)':(single?'TODOS CONTRA TODOS · ZONA ÚNICA':(ZONE_PHASE_LABELS[z.phase]||'FASE').toUpperCase()+' · TODOS CONTRA TODOS');
    var countText=target?(assigned.length+'/'+target+' equipos'):(assigned.length+' equipo'+(assigned.length===1?'':'s'));
    var matchText=prog.interzonalRequired?(prog.internalPlayed+'/'+prog.internalRequired+' internos · '+prog.interzonalPlayed+'/'+prog.interzonalRequired+' interzonales'):(prog.played+'/'+prog.required+' partido'+(prog.required===1?'':'s'));
    return'<article class="card zone-card '+(!isQual&&!single?'zone-card-final':'')+'">'+
      '<div class="card-title">'+
        '<div><p class="eyebrow">'+phaseBadge+'</p><h2>'+esc(z.name)+'</h2><p class="desc">'+countText+' · '+matchText+'</p></div>'+
        (editable&&!fixedStructure?'<div class="actions" style="margin:0;padding:0;border:0"><button class="link" data-action="rename-zone" data-id="'+z.id+'">Renombrar</button>'+(single?'':'<button class="link danger" data-action="delete-zone" data-id="'+z.id+'">Eliminar</button>')+'</div>':'')+
      '</div>'+
      (editable&&!isFull?
        '<form class="inline zone-add-team-form" data-form="quick-zone-team">'+
          '<input type="hidden" name="zoneId" value="'+z.id+'">'+
          '<input name="name" required placeholder="Nombre del nuevo equipo en '+esc(z.name)+'…">'+
          '<button class="secondary">＋ Agregar equipo</button>'+
        '</form>'+
        (unassigned.length?
          '<form class="inline zone-assign-form" data-form="assign-team" style="margin-top:8px;padding-top:8px">'+
            '<input type="hidden" name="zoneId" value="'+z.id+'">'+
            '<select name="teamId" required><option value="">O asignar equipo sin zona ('+unassigned.length+')…</option>'+unassigned.map(function(t){return'<option value="'+t.id+'">'+esc(t.name)+'</option>';}).join('')+'</select>'+
            '<button class="cancel">Asignar</button>'+
          '</form>'
        :'')
      :(editable&&isFull?'<div class="zone-full-pill">Cupo completo ('+target+'/'+target+' equipos)</div>':''))+
      '<div class="zone-teams">'+
        (assigned.length?assigned.map(function(t,idx){
          var originInfo='';
          if(!isQual&&!single){
            var qEntry=f.qualified.filter(function(q){return q.teamId===t.id;})[0];
            var srcZ=qEntry?zoneById(c,qEntry.sourceZoneId):null;
            if(srcZ)originInfo='<small style="margin-left:8px;color:var(--muted)">('+esc(srcZ.name+(qEntry.position?' · '+qEntry.position+'°':''))+')</small>';
          }
          var canRemove=editable&&!zoneHasResults(c,z.id)&&!teamHasInterzonalAssignment(c,t.id);
          return'<div class="recent-item"><span class="pos">'+(idx+1)+'</span><span><b>'+esc(t.name)+'</b>'+originInfo+'</span>'+(canRemove?'<button class="link danger" data-action="remove-team-zone" data-team-id="'+t.id+'" data-zone-id="'+z.id+'">Quitar</button>':'')+'</div>';
        }).join(''):'<div class="zone-empty-hint">Todavía no hay equipos en esta zona. Escribí el nombre arriba para agregar el primero.</div>')+
      '</div>'+
    '</article>';
  }

  function renderInterzonalSection(c){
    if(!isTorneo50(c))return'';
    var iz=interzonalStatus(c),draft=ensureInterzonalDraft(c),isOpen=c.currentStage===STAGES.GENERAL;
    var usedInDraftC={},usedInDraftD={};
    [1,2,3].forEach(function(slot){
      var d=draft.slots[slot]||{};
      if(d.teamCId)usedInDraftC[d.teamCId]=slot;
      if(d.teamDId)usedInDraftD[d.teamDId]=slot;
    });
    return'<section class="card interzonal-card" id="interzonal-section">'+
      '<div class="toolbar">'+
        '<div><p class="eyebrow">SORTEO MANUAL · ZONA C VS ZONA D</p><h2>Interzonal C-D</h2><p class="desc">Cada equipo de Zona C juega una sola vez contra un equipo de Zona D para completar 3 partidos el viernes.</p></div>'+
        '<span class="badge">'+(iz.playedCount)+'/3 jugados · '+(iz.assignedCount)+'/3 asignados</span>'+
      '</div>'+
      (iz.teamsC.length<3||iz.teamsD.length<3?
        '<div class="qual-warning-list" style="margin-top:12px"><strong>Faltan equipos para habilitar el sorteo completo:</strong><ul>'+
          (iz.teamsC.length<3?'<li>Zona C tiene '+iz.teamsC.length+'/3 equipos.</li>':'')+
          (iz.teamsD.length<3?'<li>Zona D tiene '+iz.teamsD.length+'/3 equipos.</li>':'')+
        '</ul></div>'
      :'')+
      '<div class="table-wrap" style="margin-top:14px"><table class="table interzonal-table"><thead><tr><th>Enfrentamiento</th><th>Zona C</th><th>Zona D</th><th>Estado</th><th>Gestión</th></tr></thead><tbody>'+
      [1,2,3].map(function(slot){
        var savedSlot=iz.slots[slot-1],dSlot=draft.slots[slot]||{teamCId:'',teamDId:''};
        var availC=iz.teamsC.filter(function(t){return t.id===dSlot.teamCId||!usedInDraftC[t.id]||usedInDraftC[t.id]===slot;});
        var availD=iz.teamsD.filter(function(t){return t.id===dSlot.teamDId||!usedInDraftD[t.id]||usedInDraftD[t.id]===slot;});
        var isDirty=savedSlot.assigned&&(dSlot.teamCId!==savedSlot.teamCId||dSlot.teamDId!==savedSlot.teamDId);
        var stateLabel=savedSlot.match?('Cargado · '+savedSlot.match.score.replace('-','–')):(savedSlot.assigned?'Asignado':'Pendiente');
        var stateClass=savedSlot.match?'loaded':(savedSlot.assigned?'assigned':'pending');
        return'<tr data-interzonal-slot="'+slot+'">'+
          '<td><strong>'+slot+'</strong></td>'+
          '<td><select data-action="interzonal-select-c" data-slot="'+slot+'" '+(isOpen?'':'disabled')+'><option value="">Elegir equipo Zona C…</option>'+availC.map(function(t){return'<option value="'+t.id+'" '+(t.id===dSlot.teamCId?'selected':'')+'>'+esc(t.name)+'</option>';}).join('')+'</select></td>'+
          '<td><select data-action="interzonal-select-d" data-slot="'+slot+'" '+(isOpen?'':'disabled')+'><option value="">Elegir equipo Zona D…</option>'+availD.map(function(t){return'<option value="'+t.id+'" '+(t.id===dSlot.teamDId?'selected':'')+'>'+esc(t.name)+'</option>';}).join('')+'</select></td>'+
          '<td><span class="iz-pill '+stateClass+'">'+esc(stateLabel)+'</span></td>'+
          '<td class="iz-actions">'+
            (isOpen?'<button type="button" class="secondary iz-btn" data-action="save-interzonal" data-slot="'+slot+'">'+(isDirty?'Actualizar cruce':'Guardar cruce')+'</button>':'')+
            (savedSlot.assigned&&!savedSlot.match?'<button type="button" class="primary iz-btn" data-action="load-interzonal-match" data-slot="'+slot+'">Cargar resultado</button>':'')+
            (savedSlot.match?'<button type="button" class="link" data-action="edit-match" data-id="'+savedSlot.match.id+'">Editar resultado</button>':'')+
            (isOpen&&(savedSlot.assigned||dSlot.teamCId||dSlot.teamDId)?'<button type="button" class="link danger" data-action="clear-interzonal" data-slot="'+slot+'">Limpiar</button>':'')+
          '</td>'+
        '</tr>';
      }).join('')+
      '</tbody></table></div>'+
      '<div class="interzonal-status-grid">'+
        '<div class="iz-summary-box"><strong>Zona C · Asignados ('+iz.assignedC.length+'/3)</strong><span>'+(iz.assignedC.length?iz.assignedC.map(function(t){return esc(t.name);}).join(', '):'Ninguno')+'</span><small>Pendientes: '+(iz.pendingC.length?iz.pendingC.map(function(t){return esc(t.name);}).join(', '):'Todos asignados')+'</small></div>'+
        '<div class="iz-summary-box"><strong>Zona D · Asignados ('+iz.assignedD.length+'/3)</strong><span>'+(iz.assignedD.length?iz.assignedD.map(function(t){return esc(t.name);}).join(', '):'Ninguno')+'</span><small>Pendientes: '+(iz.pendingD.length?iz.pendingD.map(function(t){return esc(t.name);}).join(', '):'Todos asignados')+'</small></div>'+
      '</div>'+
      '<div class="interzonal-list-wrap"><h3>Partidos Interzonales C-D Registrados</h3>'+
        (iz.slots.some(function(s){return s.assigned;})?
          '<div class="interzonal-match-list">'+iz.slots.filter(function(s){return s.assigned;}).map(function(s){
            var sets=s.match?matchSetsFor(s.match):[];
            var resText=s.match?(esc(teamById(s.match.winnerId).name)+' '+s.match.score.replace('-','–')+' '+esc(teamById(s.match.loserId).name)+(sets.length?' ('+sets.map(function(x){return x.a+'–'+x.b;}).join(', ')+')':'')):'Pendiente de resultado';
            return'<div class="recent-item"><span class="pos">'+s.slot+'</span><span><b>'+esc(s.teamC.name)+' vs '+esc(s.teamD.name)+'</b><small>'+resText+'</small></span><div class="recent-actions">'+(s.match?'<button type="button" class="link" data-action="edit-match" data-id="'+s.match.id+'">Editar</button>':'<button type="button" class="secondary" data-action="load-interzonal-match" data-slot="'+s.slot+'">Cargar resultado</button>')+'</div></div>';
          }).join('')+'</div>'
        :'<p class="desc">Todavía no hay enfrentamientos interzonales guardados.</p>')+
      '</div>'+
    '</section>';
  }

  function zonesPage(){
    var c=category(),f=zoneFlow(c),single=isSingleZoneCategory(c);
    if(single){
      var singleZ=finalZoneOf(c)||f.zones[0];
      return'<section class="card zone-creator-bar">'+
          '<div class="toolbar">'+
            '<div><p class="eyebrow">'+(isTorneo68(c)?'PASO 1 · CATEGORÍA +68 (8 EQUIPOS · ZONA ÚNICA)':'PASO 1 · FORMATO TODOS CONTRA TODOS (ZONA ÚNICA)')+'</p><h2>Equipos de la Categoría</h2><p class="desc">'+(isTorneo68(c)?'Los 8 equipos juegan todos contra todos (7 partidos por equipo). Del 1° al 4° pasan a Semifinales; 5° al 8° definen directo por tabla.':'Todos los equipos juegan todos contra todos en una única zona.')+'</p></div>'+
            (isTorneo68(c)&&singleZ&&singleZ.teamIds.length===0?'<button type="button" class="secondary" data-action="preload-teams-68">Precargar 8 equipos confirmados</button>':'')+
          '</div>'+
        '</section>'+
        (singleZ?'<div class="zone-grid">'+zoneCard(c,singleZ)+'</div>':'');
    }
    var qualZones=qualifyingZonesOf(c),secondZones=secondStageZonesOf(c);
    var evalQual=c.currentStage===STAGES.GENERAL&&qualZones.length?evaluateZoneQualification(c):null;
    var preview=f.qualified.map(function(q){
      var t=teamById(q.teamId),z=zoneById(c,q.sourceZoneId);
      return t?'<div class="playoff-team"><strong>'+esc(t.name)+'</strong><span>'+esc((z?z.name:'Zona')+(q.position?' · '+q.position+'° puesto':''))+'</span></div>':'';
    }).join('');
    var headerEyebrow=isTorneo50(c)?'PASO 1 · CATEGORÍA +50 (14 EQUIPOS · VIERNES)':(isTorneo60(c)?'PASO 1 · CATEGORÍA +60 (18 EQUIPOS · DÍAS 1 Y 2)':'PASO 1 · ZONAS CLASIFICATORIAS Y ZONA FINAL');
    var headerDesc=isTorneo50(c)?'Zona A (4), Zona B (4), Zona C (3 + Interzonal) y Zona D (3 + Interzonal). Todos juegan 3 partidos en la Fase 1.':(isTorneo60(c)?'3 zonas de 6 equipos (Zonas A, B y C) todos contra todos (5 partidos por equipo).':'Cada zona clasificatoria se juega todos contra todos.');
    var confirmBtnLabel=isTorneo50(c)?'Cerrar Fase 1 y armar Zonas 1, 2 y 3 →':(isTorneo60(c)?'Cerrar Fase 1 y armar Zonas 1 a 6 →':'Cerrar zonas y clasificar Top 2 →');
    var confirmDesc=isTorneo50(c)?'1° y 2° pasan a Ronda Campeonato (Zonas 1 y 2); 3° y 4° pasan a Ronda Estímulo (Zona 3), conservando estadísticas de Fase 1.':(isTorneo60(c)?'1° y 2° pasan a Campeonato (Zonas 1 y 2); 3° a Zona 3, 4° a Zona 4, 5° a Zona 5 y 6° a Zona 6, conservando estadísticas.':'Pasan automáticamente los 2 mejores equipos de cada zona clasificatoria a una única Zona final todos contra todos.');
    return'<section class="card zone-creator-bar">'+
        '<div class="toolbar">'+
          '<div><p class="eyebrow">'+headerEyebrow+'</p><h2>Zonas y Equipos</h2><p class="desc">'+headerDesc+'</p></div>'+
          (c.currentStage===STAGES.GENERAL&&!isTorneo50(c)&&!isTorneo60(c)?'<form class="inline zone-create-inline" data-form="zone"><input id="new-zone-input" name="name" required placeholder="Ej: Zona 4 o Zona A"><button class="primary">＋ Crear zona</button></form>':'')+
        '</div>'+
      '</section>'+
      (c.currentStage!==STAGES.GENERAL&&secondZones.length?
        '<section class="card playoff-board" style="margin-bottom:16px"><p class="eyebrow">SEGUNDA FASE ACTIVA</p><h2>Zonas de Segunda Fase</h2><p class="desc" style="margin-bottom:12px">Equipos clasificados desde la Fase de Grupos con arrastre de puntos y tantos.</p><div class="playoff-grid">'+preview+'</div></section>'+
        '<div class="zone-grid" style="margin-bottom:20px">'+secondZones.map(function(z){return zoneCard(c,z);}).join('')+'</div>'
      :'')+
      (qualZones.length?
        '<div class="zone-grid">'+qualZones.map(function(z){return zoneCard(c,z);}).join('')+'</div>'
      :
        '<section class="card empty" style="margin-top:16px"><h2>Empezá creando la primera zona clasificatoria</h2><p>Usá el campo de arriba (por ejemplo: <strong>Zona 4</strong> o <strong>Zona A</strong>) y presioná “Crear zona”.</p></section>'
      )+
      renderInterzonalSection(c)+
      (c.currentStage===STAGES.GENERAL&&qualZones.length?
        '<section class="card zone-confirm">'+
          '<div>'+
            '<p class="eyebrow">CIERRE DE FASE DE GRUPOS</p>'+
            '<h2>Cerrar Fase 1 y generar Segunda Fase</h2>'+
            '<p class="desc">'+confirmDesc+'</p>'+
            (evalQual&&!evalQual.ready?'<div class="qual-warning-list" role="status"><strong>Atención antes de cerrar la fase:</strong><ul>'+evalQual.warnings.map(function(w){return'<li>'+esc(w)+'</li>';}).join('')+'</ul></div>':'')+
          '</div>'+
          '<button class="primary" data-action="preview-zones">'+confirmBtnLabel+'</button>'+
        '</section>'
      :'');
  }

  function formatRatioComma(num,den,zeroWhenNoLosses){
    if(den===0)return zeroWhenNoLosses?'0,00':(num>0?'MAX':'0,00');
    return(num/den).toFixed(2).replace('.',',');
  }
  function destinationBadgeForRow(c,z,index,stage){
    if(isTorneo50(c)){
      if(stage===STAGES.GENERAL){
        if(z.code==='A'||z.code==='B')return index===0?'Zona 1':(index===1?'Zona 2':'Zona 3');
        if(z.code==='C'||z.code==='D')return index===0?'Zona 2':(index===1?'Zona 1':'Zona 3');
      }else{
        if(z.code==='1'||z.code==='2')return index<2?'Semifinales':(index===2?'5° / 6°':'7° / 8°');
        if(z.code==='3')return(9+index)+'° Puesto';
      }
      return'';
    }
    if(isTorneo60(c)){
      if(stage===STAGES.GENERAL){
        if(z.code==='A'||z.code==='C')return index===0?'Zona 1':(index===1?'Zona 2':'Zona '+(index+1));
        if(z.code==='B')return index===0?'Zona 2':(index===1?'Zona 1':'Zona '+(index+1));
      }else{
        if(z.code==='1'||z.code==='2')return index<2?'Semifinales':'5° / 6°';
        if(z.code==='3')return(7+index)+'° Puesto';
        if(z.code==='4')return(10+index)+'° Puesto';
        if(z.code==='5')return(13+index)+'° Puesto';
        if(z.code==='6')return(16+index)+'° Puesto';
      }
      return'';
    }
    if(isTorneo68(c))return index<4?'Semifinales':((index+1)+'° Puesto');
    return(stage===STAGES.GENERAL&&index<2)?'Clasifica':'';
  }
  function positionRow(c,z,row,index,stage){
    var wins=typeof row.wins==='number'?row.wins:0,losses=typeof row.losses==='number'?row.losses:0;
    var r20=typeof row.won20==='number'?row.won20:0,r21=typeof row.won21==='number'?row.won21:0,r02=typeof row.lost02==='number'?row.lost02:0,r12=typeof row.lost12==='number'?row.lost12:0;
    var badgeLabel=destinationBadgeForRow(c,z,index,stage);
    var isQualifying=Boolean(badgeLabel)&&(stage===STAGES.GENERAL&&!isTorneo50(c)&&!isTorneo60(c)?index<2:(isTorneo68(c)?index<4:(z.code==='1'||z.code==='2'?index<2:(isTorneo50(c)||isTorneo60(c)?index<2:false))));
    var difSign=row.difference>0?'+'+row.difference:String(row.difference),difClass=row.difference>0?'dif-plus':row.difference<0?'dif-minus':'';
    return'<tr class="'+(isQualifying?'row-qualifying':'')+'">'+
      '<td class="col-pos '+(isQualifying?'pos-qualifying':'')+'">'+(index+1)+'</td>'+
      '<td class="col-team"><strong>'+esc(row.team.name)+'</strong>'+(badgeLabel?'<span class="qualify-badge">'+esc(badgeLabel)+'</span>':'')+'</td>'+
      '<td class="col-pts"><b>'+row.classificationPoints+'</b></td>'+
      '<td>'+row.resultCount+'</td><td>'+wins+'</td><td>'+losses+'</td>'+
      '<td>'+row.setWins+'</td><td>'+row.setLosses+'</td>'+
      '<td>'+row.pointsFor+'</td><td>'+row.pointsAgainst+'</td><td class="col-dif '+difClass+'"><b>'+difSign+'</b></td>'+
      '<td class="col-res">'+r20+'</td><td class="col-res">'+r21+'</td><td class="col-res">'+r02+'</td><td class="col-res">'+r12+'</td>'+
      '<td class="col-coc">'+formatRatioComma(row.setWins,row.setLosses,false)+'</td>'+
      '<td class="col-coc">'+formatRatioComma(row.pointsFor,row.pointsAgainst,false)+'</td>'+
      '<td class="col-coc">0</td>'+
    '</tr>';
  }
  function renderZoneStandingsSheet(c,z,stage){
    var ranking=zoneRankingFull(c,z,stage),rows=ranking.rows,single=isSingleZoneCategory(c);
    var phaseTag=isTorneo68(c)?'ZONA ÚNICA · 1° AL 4° SEMIFINALES · 5° AL 8° DIRECTO':(single?'FASE ÚNICA · TODOS CONTRA TODOS':((ZONE_PHASE_LABELS[z.phase]||'FASE').toUpperCase()+' · TODOS CONTRA TODOS'));
    var headerTitle=(c.name.toUpperCase().indexOf('+50')>=0?'+50 ':c.name.toUpperCase().indexOf('+60')>=0?'+60 ':c.name.toUpperCase().indexOf('+68')>=0?'+68 ':'')+z.name.toUpperCase();
    var unresolved=ranking.ties.filter(function(t){return!t.resolved;});
    return'<section class="card official-sheet-card">'+
      '<div class="sheet-zone-heading">'+
        '<span class="sheet-category-tag">'+esc(c.name.toUpperCase()+' · '+phaseTag)+'</span>'+
        '<h2>'+esc(z.name.toUpperCase())+'</h2>'+
      '</div>'+
      (unresolved.length?
        '<div class="tie-alert-bar"><span><strong>Empate sin definir:</strong> hay empate absoluto en puntos, diferencia, tantos y cruce directo.</span><div class="tie-alert-actions">'+unresolved.map(function(t){
          var names=t.teamIds.map(function(id){var tm=teamById(id);return tm?tm.name:id;}).join(' / ');
          return'<button type="button" class="secondary" data-action="open-tie-modal" data-scope="'+esc(ranking.scope)+'" data-teams="'+esc(t.teamIds.join(','))+'">Resolver empate ('+esc(names)+')</button>';
        }).join('')+'</div></div>'
      :'')+
      '<div class="table-wrap">'+
        '<table class="table official-positions-table">'+
          '<thead>'+
            '<tr class="thead-group-row">'+
              '<th colspan="2" rowspan="2" class="th-zone-title">'+esc(headerTitle)+'</th>'+
              '<th rowspan="2" class="th-pts">PUNTOS</th>'+
              '<th colspan="3" class="th-block">PARTIDOS</th>'+
              '<th colspan="2" class="th-block">SET</th>'+
              '<th colspan="3" class="th-block">TANTOS</th>'+
              '<th colspan="4" class="th-block th-res-group">RESULTADOS</th>'+
              '<th colspan="3" class="th-block th-coc-group">COCIENTES</th>'+
            '</tr>'+
            '<tr class="thead-sub-row">'+
              '<th>J</th><th>G</th><th>P</th>'+
              '<th>SF</th><th>SE</th>'+
              '<th>PG</th><th>PP</th><th>DIF</th>'+
              '<th class="th-res-sub">2-0</th><th class="th-res-sub">2-1</th><th class="th-res-sub">0-2</th><th class="th-res-sub">1-2</th>'+
              '<th class="th-coc-sub">SET</th><th class="th-coc-sub">PTOS</th><th class="th-coc-sub">P.</th>'+
            '</tr>'+
          '</thead>'+
          '<tbody>'+
            (rows.length?rows.map(function(row,i){return positionRow(c,z,row,i,stage);}).join(''):'<tr><td colspan="18" class="empty-cell">Sin equipos asignados en esta zona.</td></tr>')+
          '</tbody>'+
        '</table>'+
      '</div>'+
    '</section>';
  }
  function renderPlayoffsBoard(c){
    if(!hasPlayoffsFormat(c))return'';
    var po=computePlayoffs(c),finalTable=computeFinalStandings(c);
    return'<section class="card playoff-stage-card">'+
      '<div class="toolbar"><div><p class="eyebrow">DÍA 3 · DEFINICIÓN Y PODIO</p><h2>Cruces Finales</h2><p class="desc">'+(po.unlocked?'Cruces definidos por posiciones de la fase anterior. Cargá cada resultado desde aquí.':'Cruces en espera hasta completar los partidos y eventuales empates de las zonas clasificatorias.')+'</p></div></div>'+
      (!po.unlocked?'<div class="qual-warning-list" style="margin-top:12px"><strong>Para habilitar los Cruces Finales:</strong><ul>'+po.reasons.map(function(r){return'<li>'+esc(r)+'</li>';}).join('')+'</ul></div>':
        '<div class="playoff-slots-grid">'+po.slots.map(function(s){
          var aName=s.teamA?s.teamA.name:s.teamASource,bName=s.teamB?s.teamB.name:s.teamBSource;
          var sets=s.match?matchSetsFor(s.match):[];
          var resStr=s.match?(teamById(s.match.winnerId).name+' '+s.match.score.replace('-','–')+' '+teamById(s.match.loserId).name+(sets.length?' ('+sets.map(function(x){return x.a+'–'+x.b;}).join(', ')+')':'')):(s.ready?'Listo para jugar':'Esperando llave previa');
          return'<article class="playoff-match-box '+(s.match?'is-played':(s.ready?'is-ready':'is-waiting'))+'">'+
            '<div class="pm-head"><span class="eyebrow" style="margin:0">'+esc(s.group)+'</span><strong>'+esc(s.label)+'</strong></div>'+
            '<div class="pm-teams"><div><small>'+esc(s.teamASource)+'</small><b>'+esc(aName)+'</b></div><span class="pm-vs">VS</span><div><small>'+esc(s.teamBSource)+'</small><b>'+esc(bName)+'</b></div></div>'+
            '<div class="pm-foot"><span>'+esc(resStr)+'</span>'+
              (s.match?'<button type="button" class="link" data-action="edit-match" data-id="'+s.match.id+'">Editar</button>':(s.ready?'<button type="button" class="secondary" data-action="load-playoff-match" data-bracket="'+s.id+'">Cargar resultado</button>':''))+
            '</div>'+
          '</article>';
        }).join('')+'</div>'
      )+
      (finalTable.length?
        '<div class="final-standings-wrap"><h3>Clasificación Final del Torneo</h3><div class="table-wrap"><table class="table final-rank-table"><thead><tr><th>Puesto</th><th>Equipo</th><th>Instancia</th><th>Detalle</th></tr></thead><tbody>'+
        finalTable.map(function(r){
          return'<tr class="'+(r.position<=3&&r.team?'row-podium':'')+'"><td><strong>'+r.position+'°</strong></td><td style="text-align:left"><strong>'+esc(r.team?r.team.name:'Por definir')+'</strong></td><td style="text-align:left">'+esc(r.origin)+'</td><td>'+esc(r.detail)+'</td></tr>';
        }).join('')+
        '</tbody></table></div></div>'
      :'')+
    '</section>';
  }
  function positionsPage(){
    var c=category(),f=zoneFlow(c),single=isSingleZoneCategory(c);
    var qualZones=qualifyingZonesOf(c),secondZones=secondStageZonesOf(c);
    var hasTeams=f.zones.some(function(z){return z.teamIds.length;});
    if(!hasTeams){
      return'<section class="card empty"><h2>Todavía no hay equipos en las zonas</h2><p>Primero agregá las zonas y sus equipos en el Paso 1 para ver la tabla de posiciones.</p><button class="primary" data-view="zones">Ir a Paso 1: Zonas y Equipos →</button></section>';
    }
    var rulesDesc='Puntaje: 3 pts al ganador (2–0 o 2–1), 2 pts al perdedor (1–2) y 1 pt al perdedor (0–2). Desempates: 1° DIF (PF - PC), 2° PF, 3° Menor PC, 4° Enfrentamiento directo.';
    if(single){
      var singleZ=finalZoneOf(c)||f.zones[0];
      return'<div class="toolbar"><div><p class="eyebrow">PASO 3 · PLANILLA OFICIAL DE POSICIONES</p><h2>Tabla de Posiciones · '+(isTorneo68(c)?'Zona Única (+68)':'Todos contra todos')+'</h2><p class="desc">'+rulesDesc+'</p></div><button class="primary" data-view="results">＋ Cargar partido</button></div>'+
        (singleZ?renderZoneStandingsSheet(c,singleZ,stageForZone(c,singleZ.id)):'')+
        renderPlayoffsBoard(c);
    }
    return'<div class="toolbar"><div><p class="eyebrow">PASO 3 · PLANILLA OFICIAL DE POSICIONES</p><h2>Tabla de Posiciones por Zona</h2><p class="desc">'+rulesDesc+'</p></div><button class="primary" data-view="results">＋ Cargar partido</button></div>'+
      renderPlayoffsBoard(c)+
      (secondZones.length?'<div class="positions-stack" style="margin-bottom:24px">'+secondZones.map(function(z){return renderZoneStandingsSheet(c,z,STAGES.ZONE_FINAL);}).join('')+'</div>':'')+
      '<div class="positions-stack">'+qualZones.map(function(z){return renderZoneStandingsSheet(c,z,STAGES.GENERAL);}).join('')+'</div>';
  }

  function matchStageLabel(c,match){
    if(match.matchType===MATCH_TYPES.INTERZONAL)return'Fase de grupos · Cruce #'+(match.interzonalSlot||'');
    if(match.matchType===MATCH_TYPES.PLAYOFF)return'Cruces finales · Día 3';
    if(c&&isSingleZoneCategory(c))return'Todos contra todos';
    return match.stage===STAGES.ZONE_FINAL?(isTorneo50(c)||isTorneo60(c)?'Segunda fase':'Fase final'):'Fase de grupos';
  }
  function matchZoneLabel(c,match){
    if(match.matchType===MATCH_TYPES.INTERZONAL)return'Interzonal C-D';
    if(match.matchType===MATCH_TYPES.PLAYOFF)return match.bracketLabel||'Cruce final';
    var z=match.zoneId?zoneById(c,match.zoneId):null;return z?z.name:'—';
  }
  function matchesPage(){
    var c=category(),single=isSingleZoneCategory(c),hasPO=hasPlayoffsFormat(c);
    var stageWeight=function(m){return m.stage===STAGES.PLAYOFFS?2:(m.stage===STAGES.ZONE_FINAL?1:0);};
    var baseOrder=categoryMatches(c.id);
    var all=baseOrder.slice().sort(function(a,b){return stageWeight(a)-stageWeight(b)||(baseOrder.indexOf(a)-baseOrder.indexOf(b));});
    var matchNumbers={};
    all.forEach(function(match,index){matchNumbers[match.id]=index+1;});
    var zones=zoneFlow(c).zones;
    var rows=all.filter(function(match){
      var matchPhase=match.stage===STAGES.PLAYOFFS?STAGES.PLAYOFFS:(match.stage===STAGES.ZONE_FINAL?ZONE_PHASES.FINAL:ZONE_PHASES.QUALIFYING);
      var phaseOk=matchPhaseFilter==='ALL'||match.stage===matchPhaseFilter||matchPhase===matchPhaseFilter;
      var zoneOk=matchZoneFilter==='ALL'||(matchZoneFilter===INTERZONAL_LOADER_ID&&match.matchType===MATCH_TYPES.INTERZONAL)||(matchZoneFilter===PLAYOFFS_LOADER_ID&&match.matchType===MATCH_TYPES.PLAYOFF)||match.zoneId===matchZoneFilter;
      return phaseOk&&zoneOk;
    });
    var showPhaseFilter=!single||hasPO;
    return'<div class="toolbar"><div><p class="eyebrow">PASO 4 · PLANILLA DE RESULTADOS</p><h2>Partidos Jugados</h2><p class="desc">Detalle de cada partido por sets. Podés filtrar por fase y por zona.</p></div><button class="primary" data-view="results">＋ Cargar partido</button></div>'+
      '<section class="card match-filters">'+
        (showPhaseFilter?'<label>Fase<select data-action="match-phase-filter"><option value="ALL">Todas las fases</option>'+(!single?'<option value="'+STAGES.GENERAL+'" '+(matchPhaseFilter===STAGES.GENERAL?'selected':'')+'>Fase de grupos</option>':'')+'<option value="'+STAGES.ZONE_FINAL+'" '+(matchPhaseFilter===STAGES.ZONE_FINAL?'selected':'')+'>'+(single?'Zona única':'Segunda fase')+'</option>'+(hasPO?'<option value="'+STAGES.PLAYOFFS+'" '+(matchPhaseFilter===STAGES.PLAYOFFS?'selected':'')+'>Cruces finales (Día 3)</option>':'')+'</select></label>':'')+
        '<label>Zona<select data-action="match-zone-filter"><option value="ALL">Todas las zonas</option>'+zones.map(function(z){return'<option value="'+z.id+'" '+(matchZoneFilter===z.id?'selected':'')+'>'+esc(z.name)+'</option>';}).join('')+(isTorneo50(c)?'<option value="'+INTERZONAL_LOADER_ID+'" '+(matchZoneFilter===INTERZONAL_LOADER_ID?'selected':'')+'>Interzonal C-D</option>':'')+(hasPO?'<option value="'+PLAYOFFS_LOADER_ID+'" '+(matchZoneFilter===PLAYOFFS_LOADER_ID?'selected':'')+'>Cruces finales (Día 3)</option>':'')+'</select></label>'+
        '<strong>'+rows.length+' partido'+(rows.length===1?'':'s')+'</strong>'+
      '</section>'+
      '<section class="card match-board"><div class="table-wrap"><table class="table official-matches-table"><thead><tr><th>P</th><th>ZONA / FASE</th><th>EQUIPO</th><th>RES.</th><th>SET 1</th><th>SET 2</th><th>SET 3</th></tr></thead><tbody>'+
      (rows.length?rows.map(function(match){
        var w=teamById(match.winnerId),l=teamById(match.loserId),sets=matchSetsFor(match);
        var wSets=2,lSets=match.score==='2-1'?1:0;
        var s1w=sets[0]?sets[0].a:0,s1l=sets[0]?sets[0].b:0;
        var s2w=sets[1]?sets[1].a:0,s2l=sets[1]?sets[1].b:0;
        var s3w=sets[2]?sets[2].a:0,s3l=sets[2]?sets[2].b:0;
        return'<tr class="match-row-winner" data-match-id="'+esc(match.id)+'">'+
            '<td rowspan="2" class="match-p-cell"><strong>'+matchNumbers[match.id]+'</strong></td>'+
            '<td rowspan="2" class="match-zone-cell"><strong>'+esc(matchZoneLabel(c,match))+'</strong><small>'+esc(matchStageLabel(c,match))+'</small></td>'+
            '<td class="match-team-cell is-winner"><strong>'+esc(w?w.name:'Equipo')+'</strong></td>'+
            '<td class="match-res-cell is-winner"><b>'+wSets+'</b></td>'+
            '<td>'+s1w+'</td><td>'+s2w+'</td><td>'+s3w+'</td>'+
          '</tr>'+
          '<tr class="match-row-loser">'+
            '<td class="match-team-cell">'+esc(l?l.name:'Equipo')+'</td>'+
            '<td class="match-res-cell">'+lSets+'</td>'+
            '<td>'+s1l+'</td><td>'+s2l+'</td><td>'+s3l+'</td>'+
          '</tr>';
      }).join(''):'<tr><td colspan="7"><div class="empty"><p>Todavía no hay partidos cargados para este filtro.</p></div></td></tr>')+
      '</tbody></table></div></section>';
  }

  function resultsPage(){
    var c=category();
    if(!c)return'<section class="card empty"><h2>Seleccioná una categoría</h2></section>';
    if(c.currentStage===STAGES.FINISHED)return'<section class="card empty"><h2>El torneo finalizó</h2><p>Ya no se pueden cargar nuevos resultados en esta categoría.</p></section>';
    var list=active(c.id);
    if(list.length<2)return'<section class="card empty"><h2>Primero agregá al menos 2 equipos</h2><p>Andá al Paso 1 (Zonas y Equipos) para crear una zona y cargar sus equipos.</p><button class="primary" data-view="zones">Ir a Paso 1: Zonas y Equipos →</button></section>';
    var draft=ensureLoaderDraft(c);
    var zones=activeZonesForCategory(c);
    var iz=isTorneo50(c)?interzonalStatus(c):null;
    var po=hasPlayoffsFormat(c)?computePlayoffs(c):null;
    var hasIzOptions=Boolean(iz&&iz.slots.some(function(s){return s.assigned;}));
    var hasPoOptions=Boolean(po&&po.unlocked&&po.slots.some(function(s){return s.ready;}));
    var isIzMode=draft.zoneId===INTERZONAL_LOADER_ID;
    var isPoMode=draft.zoneId===PLAYOFFS_LOADER_ID;
    var currentZone=(!isIzMode&&!isPoMode)?(draft.zoneId?zoneById(c,draft.zoneId):(zones[0]||null)):null;
    var zoneTeamsList=zoneTeamsForLoader(c,currentZone?currentZone.id:'');
    var teamBOptions=zoneTeamsList.filter(function(t){return t.id!==draft.teamAId;});
    if(!isIzMode&&!isPoMode&&teamBOptions.length&&!teamBOptions.some(function(t){return t.id===draft.teamBId;})){
      draft.teamBId=teamBOptions[0].id;
    }
    var evalState=evaluateScoreboard(c,draft);
    var recentMatches=categoryMatches(c.id).slice().reverse();
    var dupMatch=evalState.duplicateMatch;
    var dupWinner=dupMatch?teamById(dupMatch.winnerId):null,dupLoser=dupMatch?teamById(dupMatch.loserId):null,dupSets=dupMatch?matchSetsFor(dupMatch):[];
    var headLabelA=isIzMode?'ZONA C':(isPoMode?'CRUCE FINAL':(currentZone?currentZone.name:'EQUIPO 1'));
    var headLabelB=isIzMode?'ZONA D':(isPoMode?'CRUCE FINAL':(currentZone?currentZone.name:'EQUIPO 2'));
    return(toastState?'<div class="toast-undo" role="status" aria-live="polite"><span>✓ <strong>'+esc(toastState.text)+' · </strong><button type="button" class="toast-undo-btn" data-action="undo-last-match" data-id="'+esc(toastState.matchId)+'">Deshacer</button></span><div class="toast-actions"><button type="button" class="toast-close-btn" data-action="dismiss-toast" aria-label="Cerrar aviso">✕</button></div></div>':'')+
      '<section class="card result-loader-card"><form class="scoreboard-form" data-form="scoreboard-match" novalidate>'+
      '<div class="loader-selectors-grid">'+
      '<div class="loader-field">'+picker()+'</div>'+
      '<label class="loader-field">Zona / Instancia<select id="loader-zone" name="zoneId" data-action="loader-zone">'+
        zones.map(function(z){return'<option value="'+z.id+'" '+(!isIzMode&&!isPoMode&&z.id===(currentZone?currentZone.id:'')?'selected':'')+'>'+esc(z.name)+'</option>';}).join('')+
        (hasIzOptions?'<option value="'+INTERZONAL_LOADER_ID+'" '+(isIzMode?'selected':'')+'>Interzonal C-D (Sorteados)</option>':'')+
        (hasPoOptions?'<option value="'+PLAYOFFS_LOADER_ID+'" '+(isPoMode?'selected':'')+'>Cruces Finales (Día 3)</option>':'')+
      '</select></label>'+
      (isIzMode?
        '<label class="loader-field" style="grid-column:span 2">Cruce Interzonal C-D<select id="loader-iz-slot" data-action="loader-iz-slot">'+
          iz.slots.filter(function(s){return s.assigned;}).map(function(s){return'<option value="'+s.slot+'" '+(Number(draft.interzonalSlot)===s.slot?'selected':'')+'>Enfrentamiento '+s.slot+': '+esc(s.teamC.name)+' vs '+esc(s.teamD.name)+(s.match?' ('+s.match.score.replace('-','–')+')':'')+'</option>';}).join('')+
        '</select></label>'
      :(isPoMode?
        '<label class="loader-field" style="grid-column:span 2">Cruce Final (Día 3)<select id="loader-bracket" data-action="loader-bracket">'+
          po.slots.filter(function(s){return s.ready;}).map(function(s){return'<option value="'+s.id+'" '+(draft.bracketId===s.id?'selected':'')+'>'+esc(s.label)+': '+esc(s.teamA.name)+' vs '+esc(s.teamB.name)+(s.match?' ('+s.match.score.replace('-','–')+')':'')+'</option>';}).join('')+
        '</select></label>'
      :
        '<label class="loader-field">Equipo 1<select id="loader-team-a" name="teamAId" data-action="loader-team-a">'+zoneTeamsList.map(function(t){return'<option value="'+t.id+'" '+(t.id===draft.teamAId?'selected':'')+'>'+esc(t.name)+'</option>';}).join('')+'</select></label>'+
        '<label class="loader-field">Equipo 2<select id="loader-team-b" name="teamBId" data-action="loader-team-b">'+(teamBOptions.length?teamBOptions.map(function(t){return'<option value="'+t.id+'" '+(t.id===draft.teamBId?'selected':'')+'>'+esc(t.name)+'</option>';}).join(''):'<option value="">Agregá al menos 2 equipos en la zona</option>')+'</select></label>'
      ))+
      '</div>'+
      (dupMatch?
        '<div class="duplicate-match-banner" id="duplicate-match-banner" role="alert">'+
          '<div><strong>Este partido ya está cargado</strong><span>'+(dupWinner?esc(dupWinner.name):'Equipo')+' '+esc(dupMatch.score.replace('-','–'))+' '+(dupLoser?esc(dupLoser.name):'Equipo')+(dupSets.length?' · Sets: '+esc(dupSets.map(function(s){return s.a+'–'+s.b;}).join(', ')):'')+'</span></div>'+
          '<button type="button" class="secondary" data-action="edit-match" data-id="'+esc(dupMatch.id)+'">Editar este partido</button>'+
        '</div>'
      :'')+
      '<div class="field-error" id="team-error" '+(evalState.teamError?'':'hidden')+'>'+esc(evalState.teamError||'')+'</div>'+
      '<div class="scoreboard" id="scoreboard-box">'+
      '<div class="scoreboard-head">'+
      '<div class="scoreboard-team team-a '+(evalState.winsA>evalState.winsB&&evalState.ready?'is-winner':'')+'"><small>'+esc(headLabelA)+'</small><strong id="label-team-a">'+esc(evalState.teamA?evalState.teamA.name:'Equipo 1')+'</strong><span class="team-sets-badge" id="badge-sets-a">'+evalState.winsA+'</span></div>'+
      '<div class="scoreboard-vs">SETS</div>'+
      '<div class="scoreboard-team team-b '+(evalState.winsB>evalState.winsA&&evalState.ready?'is-winner':'')+'"><small>'+esc(headLabelB)+'</small><strong id="label-team-b">'+esc(evalState.teamB?evalState.teamB.name:'Equipo 2')+'</strong><span class="team-sets-badge" id="badge-sets-b">'+evalState.winsB+'</span></div>'+
      '</div>'+
      [1,2,3].map(function(n){
        var rowEval=evalState['s'+n],hiddenRow=n===3&&!evalState.needsSet3;
        return'<div class="set-block" id="set-block-'+n+'" '+(hiddenRow?'hidden':'')+'>'+
          '<div class="set-row '+(rowEval.winner==='A'?'win-a':rowEval.winner==='B'?'win-b':'')+' '+(rowEval.error&&!rowEval.empty?'has-error':'')+'" id="set-row-'+n+'">'+
          '<div class="set-cell cell-a '+(rowEval.winner==='A'?'set-winner':'')+'"><input type="number" inputmode="numeric" min="0" step="1" name="s'+n+'A" data-set-input="s'+n+'A" value="'+esc(draft['s'+n+'A'])+'" placeholder="0" aria-label="Puntos Set '+n+' '+esc(evalState.teamA?evalState.teamA.name:'Equipo 1')+'"></div>'+
          '<div class="set-label"><span>SET '+n+'</span>'+(n===3?'<small>Desempate</small>':'')+'</div>'+
          '<div class="set-cell cell-b '+(rowEval.winner==='B'?'set-winner':'')+'"><input type="number" inputmode="numeric" min="0" step="1" name="s'+n+'B" data-set-input="s'+n+'B" value="'+esc(draft['s'+n+'B'])+'" placeholder="0" aria-label="Puntos Set '+n+' '+esc(evalState.teamB?evalState.teamB.name:'Equipo 2')+'"></div>'+
          '</div>'+
          '<div class="field-error" id="set-error-'+n+'" '+(rowEval.error&&!rowEval.empty?'':'hidden')+'>'+esc(rowEval.error||'')+'</div>'+
          '</div>';
      }).join('')+
      '</div>'+
      '<div class="live-preview-banner '+(evalState.ready?'is-ready':(evalState.teamError||evalState.duplicateMatch)?'is-error':'')+'" id="live-preview-banner" aria-live="polite">'+
      '<span class="preview-kicker">'+(draft.editMatchId?'EDITANDO PARTIDO':'RESULTADO CALCULADO')+'</span>'+
      '<strong id="live-preview-text">'+esc(evalState.previewText)+'</strong>'+
      '</div>'+
      '<div class="sticky-save-bar">'+
      (draft.editMatchId?'<button type="button" class="cancel" data-action="cancel-edit-match">Cancelar edición</button>':'')+
      '<button type="submit" class="primary save-result-btn" id="save-result-btn" '+(evalState.ready?'':'disabled')+'>'+(draft.editMatchId?'Guardar cambios del partido':'Guardar resultado')+'</button>'+
      '</div></form></section>'+
      '<details class="card recent-collapse" '+(draft.historyOpen?'open':'')+' data-action="toggle-history">'+
      '<summary class="recent-collapse-summary"><div><span class="eyebrow">HISTORIAL RECIENTE</span><h2>Últimas cargas ('+recentMatches.length+')</h2></div><span class="collapse-chevron">▾</span></summary>'+
      '<div class="recent-collapse-body">'+(recentMatches.length?recentMatches.slice(0,10).map(function(r){
        var w=teamById(r.winnerId),l=teamById(r.loserId),sets=matchSetsFor(r),lbl=matchZoneLabel(c,r);
        return'<div class="recent-item"><span class="match-status-pill loaded">Cargado</span><span><b>'+esc(w?w.name:'Equipo')+' '+r.score.replace('-','–')+' '+esc(l?l.name:'Equipo')+'</b><small>'+esc(lbl)+' · '+(sets.length?'Sets: '+sets.map(function(s){return s.a+'–'+s.b;}).join(', '):matchStageLabel(c,r))+'</small></span><div class="recent-actions"><button type="button" class="link" data-action="edit-match" data-id="'+r.id+'">Editar</button><button type="button" class="link danger" data-action="delete-match" data-id="'+r.id+'">Deshacer</button></div></div>';
      }).join(''):'<p class="desc">Todavía no hay partidos cargados en esta categoría.</p>')+'</div></details>';
  }

  function syncScoreboardDOM(c){
    var draft=ensureLoaderDraft(c);
    if(!draft)return;
    var evalState=evaluateScoreboard(c,draft);
    var teamErr=document.getElementById('team-error');
    if(teamErr){teamErr.hidden=!evalState.teamError;teamErr.textContent=evalState.teamError||'';}
    var badgeA=document.getElementById('badge-sets-a'),badgeB=document.getElementById('badge-sets-b');
    if(badgeA)badgeA.textContent=String(evalState.winsA);
    if(badgeB)badgeB.textContent=String(evalState.winsB);
    var headTeams=app.querySelectorAll('.scoreboard-team');
    if(headTeams[0])headTeams[0].classList.toggle('is-winner',evalState.ready&&evalState.winsA>evalState.winsB);
    if(headTeams[1])headTeams[1].classList.toggle('is-winner',evalState.ready&&evalState.winsB>evalState.winsA);
    [1,2,3].forEach(function(n){
      var block=document.getElementById('set-block-'+n),row=document.getElementById('set-row-'+n),err=document.getElementById('set-error-'+n),rowEval=evalState['s'+n];
      if(block){
        var wasHidden=block.hidden;
        block.hidden=(n===3&&!evalState.needsSet3);
        if(n===3&&!wasHidden&&block.hidden){draft.s3A='';draft.s3B='';var i3a=block.querySelector('[name="s3A"]'),i3b=block.querySelector('[name="s3B"]');if(i3a)i3a.value='';if(i3b)i3b.value='';}
      }
      if(row){
        row.className='set-row '+(rowEval.winner==='A'?'win-a':rowEval.winner==='B'?'win-b':'')+' '+(rowEval.error&&!rowEval.empty?'has-error':'');
        var cellA=row.querySelector('.cell-a'),cellB=row.querySelector('.cell-b');
        if(cellA)cellA.classList.toggle('set-winner',rowEval.winner==='A');
        if(cellB)cellB.classList.toggle('set-winner',rowEval.winner==='B');
      }
      if(err){
        var showErr=Boolean(rowEval.error&&!rowEval.empty);
        err.hidden=!showErr;err.textContent=showErr?rowEval.error:'';
      }
    });
    var banner=document.getElementById('live-preview-banner'),previewText=document.getElementById('live-preview-text');
    if(banner)banner.className='live-preview-banner '+(evalState.ready?'is-ready':(evalState.teamError||evalState.duplicateMatch)?'is-error':'');
    if(previewText)previewText.textContent=evalState.previewText;
    var saveBtn=document.getElementById('save-result-btn');
    if(saveBtn)saveBtn.disabled=!evalState.ready;
  }

  function categoryPage(){
    var c=category();
    var body=view==='matches'?matchesPage():view==='positions'||view==='table'?positionsPage():view==='results'?resultsPage():zonesPage();
    return categoryHeader(c)+body;
  }
  function render(){
    try{
      var content=category()&&view!=='home'&&view!=='categories'?categoryPage():home();
      app.innerHTML=shell(content);
      bind();
    }catch(e){
      console.error(e);
      app.innerHTML=shell('<section class="card empty"><h2>No se pudo cargar esta sección</h2><p>Volvé al inicio para continuar.</p><button class="primary" data-view="home">Ir al inicio</button></section>');
      bind();
    }
  }

  function notice(message,ok){var n=document.getElementById('notice');if(n){n.className='notice '+(ok?'success':'error');n.textContent=message;}}
  function run(action,message){try{var value=action();render();notice(typeof message==='function'?message(value):message,true);}catch(e){notice(e.message||'No se pudo completar la operación.');}}
  function openModal(kind){
    modal.hidden=false;
    if(kind==='category'){
      modal.innerHTML='<div class="modal-box"><h2>Nueva categoría</h2><form class="form" data-form="modal-category">'+
        '<label>Nombre de la categoría<input id="modal-category-name" name="name" required autofocus placeholder="Ej: Categoría +50, +60, +68 o +40"></label>'+
        '<label>Formato del torneo<select id="modal-category-format" name="format">'+
          '<option value="'+FORMATS.TORNEO_50+'">Categoría +50 · 14 equipos (4 zonas + Interzonal C-D + Cruces)</option>'+
          '<option value="'+FORMATS.TORNEO_60+'">Categoría +60 · 18 equipos (3 zonas de 6 + Zonas 1–6 + Cruces)</option>'+
          '<option value="'+FORMATS.TORNEO_68+'">Categoría +68 · 8 equipos (Zona única + Semis y Final)</option>'+
          '<option value="'+FORMATS.ZONES_AND_FINAL+'">Zonas clasificatorias + Zona final (+40 / Genérico)</option>'+
          '<option value="'+FORMATS.ROUND_ROBIN+'">Todos contra todos en zona única (Genérico)</option>'+
        '</select></label>'+
        '<label class="modal-check" id="preload-68-wrap" hidden><input type="checkbox" name="preloadTeams68" value="1" checked> Precargar los 8 equipos confirmados (+68)</label>'+
        '<div class="modal-actions"><button type="button" class="cancel" data-action="close">Cancelar</button><button class="primary">Crear categoría</button></div></form></div>';
      var nameInp=document.getElementById('modal-category-name'),fmtSel=document.getElementById('modal-category-format'),pre68=document.getElementById('preload-68-wrap');
      var sync68=function(){if(pre68&&fmtSel)pre68.hidden=fmtSel.value!==FORMATS.TORNEO_68;};
      if(fmtSel)fmtSel.onchange=sync68;
      if(nameInp&&fmtSel){
        nameInp.oninput=function(){
          var v=nameInp.value;
          if(/68/.test(v))fmtSel.value=FORMATS.TORNEO_68;
          else if(/60/.test(v))fmtSel.value=FORMATS.TORNEO_60;
          else if(/50/.test(v))fmtSel.value=FORMATS.TORNEO_50;
          else if(/40/.test(v))fmtSel.value=FORMATS.ZONES_AND_FINAL;
          sync68();
        };
      }
      sync68();
    }else{
      modal.innerHTML='<div class="modal-box"><h2>Nuevo equipo</h2><form class="form" data-form="modal-team"><label>Nombre<input name="name" required autofocus placeholder="Ej: CEDEFYS"></label><div class="modal-actions"><button type="button" class="cancel" data-action="close">Cancelar</button><button class="primary">Guardar</button></div></form></div>';
    }
    var inp=modal.querySelector('input');
    if(inp)inp.focus();
  }
  function openTieModal(scope,teamIds){
    var teamsList=teamIds.map(teamById).filter(Boolean);
    modal.hidden=false;
    modal.innerHTML='<div class="modal-box"><h2>Resolver empate manualmente</h2><p class="modal-warning">Los siguientes equipos empataron en todos los criterios deportivos. Elegí qué equipo ocupa cada posición en este grupo:</p><form class="form" data-form="resolve-tie"><input type="hidden" name="scope" value="'+esc(scope)+'">'+
      teamsList.map(function(t,idx){
        return'<label>'+(idx+1)+'° puesto del grupo empatado<select name="pos_'+idx+'" required>'+teamsList.map(function(opt,oIdx){return'<option value="'+opt.id+'" '+(oIdx===idx?'selected':'')+'>'+esc(opt.name)+'</option>';}).join('')+'</select></label>';
      }).join('')+
      '<div class="modal-actions"><button type="button" class="cancel" data-action="close">Cancelar</button><button class="primary">Guardar desempate</button></div></form></div>';
  }
  function openDeleteCategory(c,returnView){modal.hidden=false;modal.innerHTML='<div class="modal-box danger-modal"><h2>¿Eliminar '+esc(c.name)+'?</h2><p class="modal-warning">Se borrarán sus zonas, sus '+teams(c.id).length+' equipos y sus '+categoryMatches(c.id).length+' partidos cargados. Esta acción no se puede deshacer.</p><div class="modal-actions"><button type="button" class="cancel" data-action="close">Cancelar</button><button type="button" class="primary modal-delete-confirm" data-action="confirm-delete-category" data-id="'+c.id+'" data-return-view="'+returnView+'">Sí, eliminar categoría</button></div></div>';}
  function openZonePreview(){
    var c=category(),evalQual=evaluateZoneQualification(c);
    if(!evalQual.ready){notice(evalQual.warnings.join(' '),false);return;}
    modal.hidden=false;
    var previewHtml=evalQual.secondStageAllocations.map(function(spec){
      return'<div style="margin-top:10px"><strong>'+esc(spec.name)+'</strong><div class="playoff-grid" style="margin-top:6px">'+spec.items.map(function(item){
        return'<div class="playoff-team"><strong>'+esc(item.team.name)+'</strong><span>'+esc(item.zone.name+' · '+item.position+'°')+'</span></div>';
      }).join('')+'</div></div>';
    }).join('');
    modal.innerHTML='<div class="modal-box" style="width:min(560px,100%);max-height:85vh;overflow-y:auto"><h2>Confirmar cierre de Fase 1</h2><p class="modal-warning">Se generarán las zonas de Segunda Fase conservando puntos y estadísticas acumuladas:</p>'+previewHtml+'<div class="modal-actions"><button type="button" class="cancel" data-action="close">Cancelar</button><button type="button" class="primary" data-action="confirm-zones">Confirmar y pasar a Segunda Fase</button></div></div>';
  }
  function closeModal(){modal.hidden=true;modal.innerHTML='';}

  function bind(){
    app.querySelectorAll('[data-view]').forEach(function(e){e.onclick=function(){view=e.getAttribute('data-view');render();};});
    app.querySelectorAll('[data-category]').forEach(function(e){e.onclick=function(){selectCategory(e.getAttribute('data-category'),'zones');};});
    app.querySelectorAll('[data-action="select-category"]').forEach(function(e){e.onchange=function(){selectCategory(e.value,'results');};});
    app.querySelectorAll('[data-action="quick-switch-category"]').forEach(function(e){e.onchange=function(){selectCategory(e.value,view==='home'?'zones':view);};});
    app.querySelectorAll('[data-action="match-phase-filter"]').forEach(function(e){e.onchange=function(){matchPhaseFilter=e.value;render();};});
    app.querySelectorAll('[data-action="match-zone-filter"]').forEach(function(e){e.onchange=function(){matchZoneFilter=e.value;render();};});
    app.querySelectorAll('[data-action="theme"]').forEach(function(e){e.onclick=function(){theme=theme==='dark'?'light':'dark';state.theme=theme;document.documentElement.setAttribute('data-theme',theme);saveState();render();};});
    app.querySelectorAll('[data-action="new-category"]').forEach(function(e){e.onclick=function(){openModal('category');};});
    app.querySelectorAll('[data-action="preload-teams-68"]').forEach(function(e){e.onclick=function(){run(function(){preloadTeams68();},'Se cargaron los 8 equipos confirmados de Categoría +68.');};});
    app.querySelectorAll('[data-action="preview-zones"]').forEach(function(e){e.onclick=openZonePreview;});
    app.querySelectorAll('[data-action="open-tie-modal"]').forEach(function(e){e.onclick=function(){openTieModal(e.getAttribute('data-scope'),String(e.getAttribute('data-teams')||'').split(',').filter(Boolean));};});
    app.querySelectorAll('[data-action="rename-zone"]').forEach(function(e){e.onclick=function(){var z=zoneById(category(),e.getAttribute('data-id')),name=prompt('Nuevo nombre de zona:',z?z.name:'');if(name!==null)run(function(){renameZone(e.getAttribute('data-id'),name);},'Zona actualizada.');};});
    app.querySelectorAll('[data-action="delete-zone"]').forEach(function(e){e.onclick=function(){var c=category(),z=zoneById(c,e.getAttribute('data-id'));if(!z)return;var results=categoryMatches(c.id).filter(function(r){return r.zoneId===z.id;}).length,warning='¿Eliminar '+z.name+'?'+(results?' También se eliminarán '+results+' partidos cargados en esta zona.':'');if(confirm(warning))run(function(){return deleteZone(z.id);},'Zona eliminada.');};});
    app.querySelectorAll('[data-action="remove-team-zone"]').forEach(function(e){e.onclick=function(){if(confirm('¿Quitar este equipo de la zona?'))run(function(){removeTeamFromZone(e.getAttribute('data-team-id'),e.getAttribute('data-zone-id'));},'Equipo quitado de la zona.');};});
    app.querySelectorAll('[data-action="edit-category"]').forEach(function(e){e.onclick=function(){var c=state.categories.filter(function(x){return x.id===e.getAttribute('data-id');})[0],name=prompt('Nuevo nombre de categoría:',c?c.name:'');if(c&&name!==null)run(function(){editCategory(c.id,name);},'Categoría actualizada.');};});
    app.querySelectorAll('[data-action="delete-category"],[data-action="delete-active-category"]').forEach(function(e){e.onclick=function(){var c=state.categories.filter(function(x){return x.id===e.getAttribute('data-id');})[0];if(c)openDeleteCategory(c,'home');};});

    // Interzonal C-D handlers
    app.querySelectorAll('[data-action="interzonal-select-c"]').forEach(function(e){e.onchange=function(){var c=category(),draft=ensureInterzonalDraft(c),slot=Number(e.getAttribute('data-slot'));if(draft&&draft.slots[slot])draft.slots[slot].teamCId=e.value;render();};});
    app.querySelectorAll('[data-action="interzonal-select-d"]').forEach(function(e){e.onchange=function(){var c=category(),draft=ensureInterzonalDraft(c),slot=Number(e.getAttribute('data-slot'));if(draft&&draft.slots[slot])draft.slots[slot].teamDId=e.value;render();};});
    app.querySelectorAll('[data-action="save-interzonal"]').forEach(function(e){e.onclick=function(){
      var c=category(),draft=ensureInterzonalDraft(c),slot=Number(e.getAttribute('data-slot')),row=draft&&draft.slots[slot];
      try{
        setInterzonalPair(slot,row?row.teamCId:'',row?row.teamDId:'');
        render();
        notice('Enfrentamiento Interzonal '+slot+' guardado correctamente.',true);
      }catch(err){
        if(err.message==='INTERZONAL_CONFIRM_NEEDED'){
          if(confirm('Este enfrentamiento ya tiene un resultado cargado. Si lo modificás, se eliminará el resultado anterior y se recalcularán las tablas. ¿Continuar?')){
            run(function(){setInterzonalPair(slot,row.teamCId,row.teamDId,{force:true});},'Enfrentamiento Interzonal '+slot+' actualizado.');
          }
        }else{
          notice(err.message||'No se pudo guardar el cruce.');
        }
      }
    };});
    app.querySelectorAll('[data-action="clear-interzonal"]').forEach(function(e){e.onclick=function(){
      var c=category(),slot=Number(e.getAttribute('data-slot'));
      try{
        clearInterzonalPair(slot);
        render();
        notice('Enfrentamiento '+slot+' limpiado.',true);
      }catch(err){
        if(err.message==='INTERZONAL_CONFIRM_NEEDED'){
          if(confirm('Este enfrentamiento ya tiene un resultado cargado. ¿Limpiar el cruce y eliminar su resultado?')){
            run(function(){clearInterzonalPair(slot,{force:true});},'Enfrentamiento '+slot+' limpiado y resultado eliminado.');
          }
        }else{
          notice(err.message||'No se pudo limpiar el cruce.');
        }
      }
    };});
    app.querySelectorAll('[data-action="load-interzonal-match"]').forEach(function(e){e.onclick=function(){
      var c=category(),slot=Number(e.getAttribute('data-slot'));
      loaderDraft=initLoaderDraft(c,INTERZONAL_LOADER_ID,{interzonalSlot:slot});
      view='results';render();
      var firstInput=app.querySelector('[data-set-input="s1A"]');if(firstInput)firstInput.focus();
    };});
    app.querySelectorAll('[data-action="load-playoff-match"]').forEach(function(e){e.onclick=function(){
      var c=category(),bId=e.getAttribute('data-bracket');
      loaderDraft=initLoaderDraft(c,PLAYOFFS_LOADER_ID,{bracketId:bId});
      view='results';render();
      var firstInput=app.querySelector('[data-set-input="s1A"]');if(firstInput)firstInput.focus();
    };});

    app.querySelectorAll('[data-action="delete-match"]').forEach(function(e){e.onclick=function(){var matchId=e.getAttribute('data-id'),match=state.matchResults.filter(function(r){return r.id===matchId;})[0],warning=match&&match.stage===STAGES.GENERAL&&category().currentStage===STAGES.ZONE_FINAL?'Este resultado pertenece a la fase de grupos. ¿Continuar?':(match&&match.matchType===MATCH_TYPES.PLAYOFF&&(match.bracketId==='semi-1'||match.bracketId==='semi-2')?'Si eliminás una semifinal también se eliminarán Final / 3° y 4° puesto si ya estaban cargados. ¿Continuar?':'¿Deshacer y eliminar este resultado?');if(confirm(warning)){if(toastState&&toastState.matchId===matchId)toastState=null;if(loaderDraft&&loaderDraft.editMatchId===matchId)loaderDraft=initLoaderDraft(category(),match?match.zoneId:undefined);run(function(){deleteMatchResult(matchId);},'Resultado deshecho y tabla recalculada.');}};});
    app.querySelectorAll('[data-action="edit-match"]').forEach(function(e){e.onclick=function(){var c=category(),match=state.matchResults.filter(function(r){return r.id===e.getAttribute('data-id');})[0];if(!c||!match)return;var sets=matchSetsFor(match);var zId=match.matchType===MATCH_TYPES.INTERZONAL?INTERZONAL_LOADER_ID:(match.matchType===MATCH_TYPES.PLAYOFF?PLAYOFFS_LOADER_ID:(match.zoneId||''));loaderDraft={categoryId:c.id,editMatchId:match.id,zoneId:zId,interzonalSlot:match.interzonalSlot||null,bracketId:match.bracketId||'',teamAId:match.winnerId,teamBId:match.loserId,s1A:sets[0]?String(sets[0].a):'',s1B:sets[0]?String(sets[0].b):'',s2A:sets[1]?String(sets[1].a):'',s2B:sets[1]?String(sets[1].b):'',s3A:sets[2]?String(sets[2].a):'',s3B:sets[2]?String(sets[2].b):'',historyOpen:true};view='results';render();var firstInput=app.querySelector('[data-set-input="s1A"]');if(firstInput)firstInput.focus();};});
    app.querySelectorAll('[data-action="cancel-edit-match"]').forEach(function(e){e.onclick=function(){var currentZoneId=loaderDraft?loaderDraft.zoneId:undefined;loaderDraft=initLoaderDraft(category(),currentZoneId);render();var sel=document.getElementById('loader-team-a');if(sel)sel.focus();};});
    app.querySelectorAll('[data-action="undo-last-match"]').forEach(function(e){e.onclick=function(){if(!toastState)return;var currentToast=toastState,currentZoneId=loaderDraft?loaderDraft.zoneId:undefined;toastState=null;run(function(){if(currentToast.kind==='update'&&currentToast.snapshot){var target=state.matchResults.filter(function(r){return r.id===currentToast.matchId;})[0];if(target){Object.assign(target,currentToast.snapshot);if(target.stage===STAGES.GENERAL)syncCategoryCarriedStats(category());if(target.matchType===MATCH_TYPES.PLAYOFF)syncChampionFromPlayoffs(category());saveState();}}else{deleteMatchResult(currentToast.matchId);}loaderDraft=initLoaderDraft(category(),currentZoneId);},'Carga deshecha y posiciones recalculadas.');var sel=document.getElementById('loader-team-a');if(sel)sel.focus();};});
    app.querySelectorAll('[data-action="dismiss-toast"]').forEach(function(e){e.onclick=function(){toastState=null;render();};});
    app.querySelectorAll('[data-action="toggle-history"]').forEach(function(e){e.ontoggle=function(){if(loaderDraft)loaderDraft.historyOpen=e.open;};});
    app.querySelectorAll('[data-action="loader-zone"]').forEach(function(e){e.onchange=function(){var c=category();loaderDraft=initLoaderDraft(c,e.value);render();var sel=document.getElementById('loader-zone');if(sel)sel.focus();};});
    app.querySelectorAll('[data-action="loader-iz-slot"]').forEach(function(e){e.onchange=function(){var c=category();loaderDraft=initLoaderDraft(c,INTERZONAL_LOADER_ID,{interzonalSlot:Number(e.value)});render();};});
    app.querySelectorAll('[data-action="loader-bracket"]').forEach(function(e){e.onchange=function(){var c=category();loaderDraft=initLoaderDraft(c,PLAYOFFS_LOADER_ID,{bracketId:e.value});render();};});
    app.querySelectorAll('[data-action="loader-team-a"]').forEach(function(e){e.onchange=function(){var c=category(),draft=ensureLoaderDraft(c),pool=zoneTeamsForLoader(c,draft.zoneId);draft.teamAId=e.value;draft.editMatchId=null;var availableB=pool.filter(function(t){return t.id!==draft.teamAId;});if(!availableB.some(function(t){return t.id===draft.teamBId;})){draft.teamBId=availableB[0]?availableB[0].id:'';}render();var sel=document.getElementById('loader-team-a');if(sel)sel.focus();};});
    app.querySelectorAll('[data-action="loader-team-b"]').forEach(function(e){e.onchange=function(){var c=category(),draft=ensureLoaderDraft(c);draft.teamBId=e.value;draft.editMatchId=null;render();var sel=document.getElementById('loader-team-b');if(sel)sel.focus();};});
    app.querySelectorAll('[data-set-input]').forEach(function(input){
      input.oninput=function(){var c=category(),draft=ensureLoaderDraft(c),key=input.getAttribute('data-set-input');draft[key]=input.value;syncScoreboardDOM(c);};
      input.onkeydown=function(ev){
        if(ev.key!=='Enter')return;
        ev.preventDefault();
        var visibleInputs=Array.prototype.slice.call(app.querySelectorAll('[data-set-input]')).filter(function(el){return!el.closest('[hidden]');});
        var idx=visibleInputs.indexOf(input);
        if(idx>=0&&idx+1<visibleInputs.length){visibleInputs[idx+1].focus();visibleInputs[idx+1].select();}
        else{var saveBtn=document.getElementById('save-result-btn');if(saveBtn&&!saveBtn.disabled){saveBtn.click();}}
      };
    });
    app.querySelectorAll('[data-form="scoreboard-match"]').forEach(function(f){f.onsubmit=function(ev){ev.preventDefault();try{saveScoreboardMatch(category(),ensureLoaderDraft(category()));render();var sel=document.getElementById('loader-team-a')||document.getElementById('loader-zone');if(sel)sel.focus();}catch(error){notice(error.message||'No se pudo guardar el partido.');}};});
    app.querySelectorAll('[data-form="zone"]').forEach(function(f){f.onsubmit=function(ev){ev.preventDefault();run(function(){createZone(new FormData(f).get('name'));},'Zona creada. Ahora agregá sus equipos adentro de la tarjeta.');};});
    app.querySelectorAll('[data-form="quick-zone-team"]').forEach(function(f){f.onsubmit=function(ev){ev.preventDefault();var d=new FormData(f);run(function(){createTeam(d.get('name'),d.get('zoneId'));},'Equipo agregado a la zona.');};});
    app.querySelectorAll('[data-form="assign-team"]').forEach(function(f){f.onsubmit=function(ev){ev.preventDefault();run(function(){var d=new FormData(f);assignTeamToZone(d.get('teamId'),d.get('zoneId'));},'Equipo asignado a la zona.');};});
  }

  modal.onclick=function(e){if(e.target===modal||e.target.closest('[data-action="close"]')){closeModal();return;}var confirmButton=e.target.closest('[data-action="confirm-delete-category"]');if(confirmButton){var c=state.categories.filter(function(x){return x.id===confirmButton.getAttribute('data-id');})[0],name=c?c.name:'Categoría';deleteCategory(confirmButton.getAttribute('data-id'));closeModal();view='home';render();notice(name+' eliminada correctamente.',true);}};
  modal.addEventListener('click',function(e){var button=e.target.closest('[data-action="confirm-zones"]');if(!button)return;try{confirmZones();loaderDraft=initLoaderDraft(category());closeModal();view='positions';render();notice('Fase 1 cerrada: se generaron las zonas de Segunda Fase.',true);}catch(error){button.disabled=false;notice(error.message||'No se pudo confirmar la clasificación.');}});
  modal.onsubmit=function(e){
    e.preventDefault();
    var f=e.target;
    try{
      var fd=new FormData(f),name=fd.get('name');
      if(f.getAttribute('data-form')==='modal-category'){
        var created=createCategory(name,fd.get('format'),{preloadTeams68:Boolean(fd.get('preloadTeams68'))});
        view='zones';closeModal();render();
        notice(isTorneo50(created)?'Categoría +50 creada con Zonas A, B, C, D e Interzonal C-D.':(isTorneo60(created)?'Categoría +60 creada con Zonas A, B y C.':(isTorneo68(created)?'Categoría +68 creada con Zona única.':(isSingleZoneCategory(created)?'Categoría creada con Zona única.':'Categoría creada. Creá las zonas clasificatorias.'))),true);
        var zInput=document.getElementById('new-zone-input')||app.querySelector('[data-form="quick-zone-team"] input[name="name"]');
        if(zInput)zInput.focus();
      }else if(f.getAttribute('data-form')==='resolve-tie'){
        var scope=fd.get('scope'),order=[],idx=0;
        while(fd.get('pos_'+idx)!==null){order.push(fd.get('pos_'+idx));idx+=1;}
        resolveTie(scope,order);
        closeModal();render();notice('Desempate registrado y tabla actualizada.',true);
      }else{
        createTeam(name);closeModal();render();notice('Equipo creado.',true);
      }
    }catch(error){
      var input=f.querySelector('input, select');
      if(input&&input.setCustomValidity){input.setCustomValidity(error.message);input.reportValidity();input.setCustomValidity('');}
      else{notice(error.message||'No se pudo completar la operación.');}
    }
  };

  state=loadState();theme=state.theme==='dark'?'dark':'light';document.documentElement.setAttribute('data-theme',theme);
  if(canUseDiskApi()&&typeof window.addEventListener==='function'){
    var flushBeforeExit=function(){try{if(state)pushDiskState(state,'unload');}catch(ignored){}};
    window.addEventListener('pagehide',flushBeforeExit);
    window.addEventListener('beforeunload',flushBeforeExit);
  }
  window.PuntajeNewcom={
    getState:function(){return JSON.parse(JSON.stringify(state));},
    FORMATS:FORMATS,ZONE_PHASES:ZONE_PHASES,MATCH_TYPES:MATCH_TYPES,SCORE_POINTS:SCORE_POINTS,DEFAULT_TEAMS_68:DEFAULT_TEAMS_68,
    resultPoints:resultPoints,matchPointsForTeam:matchPointsForTeam,calculateTeamTotal:calculateTeamTotal,calculateTeamStageTotal:calculateTeamStageTotal,
    calculateTeamSetStats:function(id,stage,zoneId){var t=teamById(id);return t?teamSetStats(id,t.categoryId,stage,zoneId):{for:0,against:0};},
    createCategory:createCategory,deleteCategory:deleteCategory,preloadTeams68:preloadTeams68,
    createTeam:createTeam,createZone:createZone,renameZone:renameZone,deleteZone:deleteZone,assignTeamToZone:assignTeamToZone,removeTeamFromZone:removeTeamFromZone,
    interzonalStatus:function(){var c=category();return interzonalStatus(c);},setInterzonalPair:setInterzonalPair,clearInterzonalPair:clearInterzonalPair,
    evaluateZoneQualification:evaluateZoneQualification,confirmZones:confirmZones,
    computePlayoffs:function(){return computePlayoffs(category());},computeFinalStandings:function(){return computeFinalStandings(category());},
    resolveTie:resolveTie,clearTieResolution:clearTieResolution,
    addResult:createScoreEntry,addScore:createScoreEntry,addTraditionalResult:createMatchResult,addMatchResult:createMatchResult,
    addMatchFromSets:createMatchFromSets,addInterzonalMatchFromSets:createInterzonalMatchFromSets,addPlayoffMatchFromSets:createPlayoffMatchFromSets,
    updateMatchResult:updateMatchResult,updateMatchFromSets:updateMatchFromSets,deleteMatchResult:deleteMatchResult,
    addQuickResults:addQuickScores,deleteScoreEntry:deleteScoreEntry,
    calculateStandings:standings,
    calculateClassificationPoints:function(id,stage,zoneId){var t=teamById(id);return t?teamClassificationPoints(id,t.categoryId,stage,zoneId):0;},
    calculateTeamPoints:function(id){var t=teamById(id);return t?calculateTeamTotal(t):0;},
    createBackup:createDiskBackup,listBackups:listDiskBackups,restoreBackup:restoreDiskBackup,
    loadState:loadState,saveState:saveState
  };
  render();
}());
