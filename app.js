(function(){
  'use strict';
  var STAGES={GENERAL:'GENERAL',TOP_16:'TOP_16',TOP_8:'TOP_8',TOP_4:'TOP_4',SEMIFINAL:'SEMIFINAL',FINAL:'FINAL',ZONE_FINAL:'ZONE_FINAL',FINISHED:'FINISHED'},
      LABELS={GENERAL:'Primera etapa · Fase de zonas',TOP_16:'Top 16',TOP_8:'Top 8',TOP_4:'Top 4',SEMIFINAL:'Semifinales',FINAL:'Final',ZONE_FINAL:'Segunda etapa · Zona única',FINISHED:'Torneo finalizado'},
      STATUS={ACTIVE:'ACTIVE',QUALIFIED:'QUALIFIED',ELIMINATED:'ELIMINATED',CHAMPION:'CHAMPION',RUNNER_UP:'RUNNER_UP'},
      STATUS_LABELS={ACTIVE:'Activo',QUALIFIED:'Clasificado',ELIMINATED:'Eliminado',CHAMPION:'Campeón',RUNNER_UP:'Subcampeón'},
      ZONE_STATUS={CONFIGURING:'CONFIGURING',IN_PROGRESS:'IN_PROGRESS',PENDING_CLOSE:'PENDING_CLOSE',FINISHED:'FINISHED'},
      ZONE_STATUS_LABELS={CONFIGURING:'Configurando zonas',IN_PROGRESS:'En juego',PENDING_CLOSE:'Lista para cerrar',FINISHED:'Finalizada'},
      KEY='puntaje-newcom-state';

  var app=document.getElementById('app'),modal=document.getElementById('modal'),state,view='home',theme='light',matchPhaseFilter='ALL',matchZoneFilter='ALL',toastState=null,loaderDraft=null;

  function empty(){return{categories:[],teams:[],matchResults:[],selectedCategoryId:null,theme:'light'};}
  function uid(prefix){return prefix+'-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8);}
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'})[c];});}
  function initial(v){return(String(v||'').trim().charAt(0)||'?').toUpperCase();}
  function isStage(v){return Object.keys(STAGES).some(function(k){return STAGES[k]===v;});}
  function isStatus(v){return Object.keys(STATUS).some(function(k){return STATUS[k]===v;});}
  function calculateTeamTotal(team){return team.scoreEntries.reduce(function(total,entry){return total+entry.points;},0);}
  function calculateTeamStageTotal(team,stage){return team.scoreEntries.filter(function(entry){return !stage||entry.stage===stage;}).reduce(function(total,entry){return total+entry.points;},0);}
  function normalizeEntry(entry,fallbackStage){var points=Number(entry&&entry.points);if(!Number.isInteger(points)||points<0)return null;return{id:typeof entry.id==='string'&&entry.id?entry.id:uid('score'),points:points,createdAt:typeof entry.createdAt==='string'?entry.createdAt:new Date().toISOString(),stage:isStage(entry.stage)?entry.stage:fallbackStage};}
  function normalizeSet(set){var a=Number(set&&set.a),b=Number(set&&set.b);if(!Number.isInteger(a)||!Number.isInteger(b)||a<0||b<0||a===b)return null;return{a:a,b:b};}
  function normalizeSets(sets){return Array.isArray(sets)?sets.map(normalizeSet).filter(Boolean):[];}
  function setWinnerCount(sets){return sets.reduce(function(count,set){return{a:count.a+(set.a>set.b?1:0),b:count.b+(set.b>set.a?1:0)};},{a:0,b:0});}
  function matchSetsFor(match){var sets=normalizeSets(match&&match.sets),wins=setWinnerCount(sets);if((match&&match.score==='2-0'&&sets.length!==2)||(match&&match.score==='2-1'&&sets.length!==3)||wins.a!==2||wins.b!==(match&&match.score==='2-1'?1:0))return[];return sets;}
  function validateMatchSets(sets){var normalized=normalizeSets(sets),wins=setWinnerCount(normalized);if(!(normalized.length===2||normalized.length===3))throw Error('Ingresá 2 sets para un 2–0 o 3 sets para un 2–1.');if(wins.a===wins.b||Math.max(wins.a,wins.b)!==2||Math.min(wins.a,wins.b)>(normalized.length===2?0:1))throw Error('Los marcadores no coinciden con un resultado válido 2–0 o 2–1.');return normalized;}

  function normalize(raw){
    if(!raw||typeof raw!=='object')return empty();
    var categories=Array.isArray(raw.categories)?raw.categories:[],categoryIds={};
    // Filtra categorías corruptas y purga automáticamente el antiguo torneo demo ("demo-cat-50")
    categories=categories.filter(function(c){
      if(!c||typeof c.id!=='string'||!c.id||c.id==='demo-cat-50'||typeof c.name!=='string'||!c.name.trim()||categoryIds[c.id])return false;
      categoryIds[c.id]=true;
      return true;
    }).map(function(c){
      return{id:c.id,name:c.name.trim(),currentStage:isStage(c.currentStage)?c.currentStage:STAGES.GENERAL,championId:typeof c.championId==='string'?c.championId:null,runnerUpId:typeof c.runnerUpId==='string'?c.runnerUpId:null,zoneTournament:c.zoneTournament||null};
    });
    var seen={},sourceTeams=Array.isArray(raw.teams)?raw.teams:[],legacyResults=Array.isArray(raw.results)?raw.results:[],sourceMatches=Array.isArray(raw.matchResults)?raw.matchResults:[];
    var teams=sourceTeams.filter(function(t){return t&&typeof t.id==='string'&&t.id&&!seen[t.id]&&typeof t.name==='string'&&t.name.trim()&&typeof t.categoryId==='string'&&categoryIds[t.categoryId];}).map(function(t){
      seen[t.id]=true;var stage=isStage(t.stage)?t.stage:(isStage(t.currentStage)?t.currentStage:STAGES.GENERAL),sourceEntries=Array.isArray(t.scoreEntries)?t.scoreEntries:legacyResults.filter(function(r){return r&&r.teamId===t.id;});
      return{id:t.id,name:t.name.trim(),categoryId:t.categoryId,status:isStatus(t.status)?t.status:STATUS.ACTIVE,stage:stage,scoreEntries:sourceEntries.map(function(e){return normalizeEntry(e,stage);}).filter(Boolean)};
    });
    var selected=typeof raw.selectedCategoryId==='string'&&categoryIds[raw.selectedCategoryId]?raw.selectedCategoryId:(categories[0]?categories[0].id:null);
    var teamIds=seen,matchIds={};
    var matchResults=sourceMatches.filter(function(r){return r&&typeof r.id==='string'&&r.id&&!matchIds[r.id]&&categoryIds[r.categoryId]&&teamIds[r.winnerId]&&teamIds[r.loserId]&&r.winnerId!==r.loserId&&(r.score==='2-0'||r.score==='2-1');}).map(function(r){matchIds[r.id]=true;var sets=normalizeSets(r.sets);return{id:r.id,categoryId:r.categoryId,winnerId:r.winnerId,loserId:r.loserId,score:r.score,sets:sets.length?sets:[],stage:isStage(r.stage)?r.stage:STAGES.GENERAL,zoneId:typeof r.zoneId==='string'?r.zoneId:null,createdAt:typeof r.createdAt==='string'?r.createdAt:new Date().toISOString()};});
    var normalizedCategories=categories.map(function(c){var source=c.zoneTournament||{},zones=Array.isArray(source.zones)?source.zones.filter(function(z){return z&&typeof z.id==='string'&&z.id&&typeof z.name==='string'&&z.name.trim();}).map(function(z){return{id:z.id,name:z.name.trim(),teamIds:Array.isArray(z.teamIds)?z.teamIds.filter(function(id){return teamIds[id];}):[]};}):[],secondStageId=typeof source.secondStageZoneId==='string'?source.secondStageZoneId:null;return Object.assign(c,{zoneTournament:{status:Object.keys(ZONE_STATUS).some(function(k){return ZONE_STATUS[k]===source.status;})?source.status:(zones.length?ZONE_STATUS.IN_PROGRESS:ZONE_STATUS.CONFIGURING),firstStageStatus:source.firstStageStatus==='FINISHED'||secondStageId?'FINISHED':(source.firstStageStatus||'CONFIGURING'),secondStageStatus:source.secondStageStatus==='IN_PROGRESS'||secondStageId?'IN_PROGRESS':(source.secondStageStatus||null),zones:zones,secondStageZoneId:secondStageId,qualified:Array.isArray(source.qualified)?source.qualified.filter(function(q){return q&&teamIds[q.teamId]&&typeof q.sourceZoneId==='string';}):[],confirmedAt:source.confirmedAt||null}});});
    normalizedCategories.forEach(function(c){
      var f=c.zoneTournament;
      f.zones=f.zones.map(function(z){return Object.assign(z,{teamIds:z.teamIds.filter(function(id){return teams.some(function(t){return t.id===id&&t.categoryId===c.id;});})});});
      var initialZones=f.zones.filter(function(z){return z.id!==f.secondStageZoneId;});
      if(c.currentStage===STAGES.GENERAL&&initialZones.length===1){
        var onlyZone=initialZones[0];
        teams.filter(function(t){return t.categoryId===c.id;}).forEach(function(t){
          if(onlyZone.teamIds.indexOf(t.id)<0)onlyZone.teamIds.push(t.id);
        });
      }
    });
    return{categories:normalizedCategories,teams:teams,matchResults:matchResults,selectedCategoryId:selected,theme:raw.theme==='dark'?'dark':'light'};
  }

  function loadState(){
    try{
      var raw=localStorage.getItem(KEY);
      if(!raw)return empty();
      var parsed=JSON.parse(raw),normalized=normalize(parsed);
      if(JSON.stringify(parsed)!==JSON.stringify(normalized))localStorage.setItem(KEY,JSON.stringify(normalized));
      return normalized;
    }catch(e){
      console.warn('No se pudo leer localStorage; se inició vacío.',e);
      return empty();
    }
  }
  function saveState(){try{localStorage.setItem(KEY,JSON.stringify(state));return true;}catch(e){console.warn('No se pudo guardar localStorage.',e);return false;}}
  function category(){return state.categories.filter(function(c){return c.id===state.selectedCategoryId;})[0]||null;}
  function teams(categoryId){return state.teams.filter(function(t){return t.categoryId===categoryId;});}
  function teamById(id){return state.teams.filter(function(t){return t.id===id;})[0]||null;}
  function active(categoryId){return teams(categoryId).filter(function(t){return t.status===STATUS.ACTIVE||t.status===STATUS.QUALIFIED;});}
  function categoryEntries(categoryId){return teams(categoryId).reduce(function(all,team){return all.concat(team.scoreEntries.map(function(entry){return{team:team,entry:entry};}));},[]);}

  function selectCategory(id,next){
    if(!state.categories.some(function(c){return c.id===id;}))throw Error('Categoría inexistente.');
    state.selectedCategoryId=id;
    loaderDraft=null;
    toastState=null;
    saveState();
    if(next)view=next;
    render();
  }
  function createCategory(name){
    name=String(name||'').trim();
    if(!name)throw Error('La categoría necesita un nombre.');
    var c={id:uid('cat'),name:name,currentStage:STAGES.GENERAL,championId:null,runnerUpId:null,zoneTournament:{status:ZONE_STATUS.CONFIGURING,firstStageStatus:'CONFIGURING',secondStageStatus:null,zones:[],secondStageZoneId:null,qualified:[],confirmedAt:null}};
    state.categories.push(c);
    state.selectedCategoryId=c.id;
    loaderDraft=null;
    saveState();
    return c;
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
    toastState=null;
    saveState();
  }
  function createTeam(name,zoneId){
    var c=category();
    name=String(name||'').trim();
    if(!c)throw Error('Seleccioná una categoría.');
    var initialZones=zoneFlow(c).zones.filter(function(z){return z.id!==zoneFlow(c).secondStageZoneId;});
    if(!initialZones.length)throw Error('Primero tenés que crear al menos una zona.');
    if(c.currentStage!==STAGES.GENERAL)throw Error('No se pueden agregar equipos después de cerrar la fase de zonas.');
    if(!name)throw Error('El equipo necesita un nombre.');
    if(teams(c.id).some(function(t){return t.name.toLowerCase()===name.toLowerCase();}))throw Error('Ya existe un equipo con ese nombre en esta categoría.');
    var targetZone=zoneId?zoneById(c,zoneId):(initialZones.length===1?initialZones[0]:null);
    if(zoneId&&!targetZone)throw Error('La zona seleccionada no existe.');
    var team={id:uid('team'),name:name,categoryId:c.id,status:STATUS.ACTIVE,stage:STAGES.GENERAL,scoreEntries:[]};
    state.teams.push(team);
    if(targetZone&&targetZone.teamIds.indexOf(team.id)<0)targetZone.teamIds.push(team.id);
    loaderDraft=null;
    saveState();
    return team;
  }
  function validateTeamForCurrent(teamId){var c=category(),team=teamById(teamId);if(!c||!team||team.categoryId!==c.id)throw Error('Equipo inválido para esta categoría.');if([STATUS.ELIMINATED,STATUS.CHAMPION,STATUS.RUNNER_UP].indexOf(team.status)>=0)throw Error('Este equipo no puede recibir puntajes.');if(c.currentStage===STAGES.FINISHED)throw Error('El torneo ya finalizó.');return{category:c,team:team};}
  function createScoreEntry(teamId,value){var found=validateTeamForCurrent(teamId),points=Number(value);if(!Number.isInteger(points)||points<0)throw Error('El puntaje debe ser un número entero mayor o igual a 0.');found.team.scoreEntries.push({id:uid('score'),points:points,createdAt:new Date().toISOString(),stage:found.category.currentStage});saveState();}
  function addQuickScores(entries){var c=category();if(!c)throw Error('Seleccioná una categoría.');var pending=[];entries.forEach(function(item){if(item.value===''||item.value===null||typeof item.value==='undefined')return;var team=validateTeamForCurrent(item.teamId),points=Number(item.value);if(!Number.isInteger(points)||points<0)throw Error('Cada puntaje debe ser un número entero mayor o igual a 0.');pending.push({team:team.team,entry:{id:uid('score'),points:points,createdAt:new Date().toISOString(),stage:c.currentStage}});});if(!pending.length)throw Error('Ingresá al menos un puntaje para guardar.');pending.forEach(function(item){item.team.scoreEntries.push(item.entry);});saveState();return pending.length;}
  function deleteScoreEntry(teamId,entryId){var team=teamById(teamId);if(!team||team.categoryId!==state.selectedCategoryId)throw Error('Carga inválida para esta categoría.');var index=team.scoreEntries.findIndex(function(entry){return entry.id===entryId;});if(index<0)throw Error('La carga seleccionada no existe.');var removed=team.scoreEntries.splice(index,1)[0];if(!saveState()){team.scoreEntries.splice(index,0,removed);throw Error('No se pudo guardar la eliminación. La carga permanece intacta.');}return removed;}
  function resultPoints(score){return score==='2-0'?{winner:3,loser:0}:{winner:2,loser:1};}
  function categoryMatches(categoryId){return state.matchResults.filter(function(r){return r.categoryId===categoryId;});}
  function zoneFlow(c){return c&&c.zoneTournament?c.zoneTournament:{status:ZONE_STATUS.CONFIGURING,firstStageStatus:'CONFIGURING',secondStageStatus:null,zones:[],secondStageZoneId:null,qualified:[],confirmedAt:null};}
  function zoneById(c,id){return zoneFlow(c).zones.filter(function(z){return z.id===id;})[0]||null;}
  function teamZone(c,teamId){return zoneFlow(c).zones.filter(function(z){return z.id!==zoneFlow(c).secondStageZoneId&&z.teamIds.indexOf(teamId)>=0;})[0]||null;}
  function currentZoneId(c){var f=zoneFlow(c);return c.currentStage===STAGES.ZONE_FINAL?f.secondStageZoneId:null;}
  function zoneMatches(categoryId,stage,zoneId){return categoryMatches(categoryId).filter(function(r){return r.stage===stage&&r.zoneId===zoneId;});}
  function createZone(name){
    var c=category();
    name=String(name||'').trim();
    if(!c)throw Error('Seleccioná una categoría.');
    if(c.currentStage!==STAGES.GENERAL||zoneFlow(c).status===ZONE_STATUS.FINISHED)throw Error('La primera etapa ya fue cerrada.');
    if(!name)throw Error('La zona necesita un nombre.');
    if(zoneFlow(c).zones.some(function(z){return z.name.toLowerCase()===name.toLowerCase();}))throw Error('Ya existe una zona con ese nombre.');
    var z={id:uid('zone'),name:name,teamIds:[]};
    zoneFlow(c).zones.push(z);
    zoneFlow(c).status=ZONE_STATUS.IN_PROGRESS;
    zoneFlow(c).firstStageStatus='IN_PROGRESS';
    loaderDraft=null;
    saveState();
    return z;
  }
  function renameZone(id,name){var c=category(),z=zoneById(c,id);name=String(name||'').trim();if(!z)throw Error('Zona inexistente.');if(!name)throw Error('La zona necesita un nombre.');if(zoneFlow(c).zones.some(function(other){return other.id!==id&&other.name.toLowerCase()===name.toLowerCase();}))throw Error('Ya existe una zona con ese nombre.');z.name=name;saveState();}
  function zoneHasResults(c,zoneId){return categoryMatches(c.id).some(function(r){return r.zoneId===zoneId;});}
  function assignTeamToZone(teamId,zoneId){var c=category(),team=teamById(teamId),z=zoneById(c,zoneId);if(!c||!team||team.categoryId!==c.id||!z)throw Error('Equipo o zona inválidos.');if(c.currentStage!==STAGES.GENERAL||zoneFlow(c).status===ZONE_STATUS.FINISHED)throw Error('La distribución ya fue cerrada.');var existing=teamZone(c,teamId);if(existing&&existing.id!==zoneId){if(zoneHasResults(c,existing.id)||zoneHasResults(c,zoneId))throw Error('No se puede mover el equipo después de registrar resultados en la zona.');existing.teamIds=existing.teamIds.filter(function(id){return id!==teamId;});}if(z.teamIds.indexOf(teamId)<0)z.teamIds.push(teamId);loaderDraft=null;saveState();}
  function removeTeamFromZone(teamId,zoneId){var c=category(),z=zoneById(c,zoneId);if(!z)throw Error('Zona inexistente.');if(c.currentStage!==STAGES.GENERAL)throw Error('No se puede modificar una etapa cerrada.');if(zoneHasResults(c,zoneId))throw Error('No se puede quitar un equipo de una zona con resultados cargados.');z.teamIds=z.teamIds.filter(function(id){return id!==teamId;});loaderDraft=null;saveState();}
  function deleteZone(id){var c=category(),f=zoneFlow(c),z=zoneById(c,id);if(!z||id===f.secondStageZoneId)throw Error('No se puede eliminar esta zona.');if(c.currentStage!==STAGES.GENERAL||f.status===ZONE_STATUS.FINISHED)throw Error('La primera etapa ya fue cerrada.');var affected=categoryMatches(c.id).filter(function(r){return r.zoneId===id;});f.zones=f.zones.filter(function(item){return item.id!==id;});state.matchResults=state.matchResults.filter(function(r){return r.zoneId!==id;});f.status=f.zones.length?ZONE_STATUS.IN_PROGRESS:ZONE_STATUS.CONFIGURING;loaderDraft=null;saveState();return{teams:z.teamIds.length,results:affected.length};}
  function zoneRows(c,z,stage){return standings(c.id,stage,z.id);}
  function sameRanking(a,b){return a.classificationPoints===b.classificationPoints&&a.pointsFor===b.pointsFor&&a.pointsAgainst===b.pointsAgainst;}
  function confirmZones(){var c=category(),f=zoneFlow(c),initial=f.zones.filter(function(z){return z.id!==f.secondStageZoneId;});if(!c||c.currentStage!==STAGES.GENERAL)throw Error('La primera etapa ya fue cerrada.');if(!initial.length)throw Error('Creá al menos una zona.');var assigned={};initial.forEach(function(z){if(z.teamIds.length<2)throw Error('Cada zona necesita al menos dos equipos.');z.teamIds.forEach(function(id){assigned[id]=(assigned[id]||0)+1;});});if(Object.keys(assigned).some(function(id){return assigned[id]>1;}))throw Error('Un equipo no puede estar en más de una zona.');var missing=teams(c.id).filter(function(t){return!assigned[t.id];});if(missing.length)throw Error('Hay equipos sin zona: '+missing.map(function(t){return t.name;}).join(', ')+'.');var withoutMatches=initial.filter(function(z){return!zoneHasResults(c,z.id);});if(withoutMatches.length)throw Error('Cargá al menos un resultado en: '+withoutMatches.map(function(z){return z.name;}).join(', ')+'.');var qualified=[];initial.forEach(function(z){var rows=zoneRows(c,z,STAGES.GENERAL);if(rows.length<2||sameRanking(rows[0],rows[1]))throw Error('No se puede resolver el empate que afecta la clasificación en '+z.name+'.');rows.slice(0,2).forEach(function(row){qualified.push({teamId:row.team.id,sourceZoneId:z.id});});});var qualifiedIds=qualified.map(function(q){return q.teamId;}),second={id:uid('zone'),name:'Zona única · Segunda etapa',teamIds:qualifiedIds};f.qualified=qualified;f.zones.push(second);f.secondStageZoneId=second.id;f.status=ZONE_STATUS.IN_PROGRESS;f.firstStageStatus='FINISHED';f.secondStageStatus='IN_PROGRESS';f.confirmedAt=new Date().toISOString();c.currentStage=STAGES.ZONE_FINAL;teams(c.id).forEach(function(t){if(qualifiedIds.indexOf(t.id)<0)t.status=STATUS.ELIMINATED;});qualified.forEach(function(q){var t=teamById(q.teamId);t.status=STATUS.QUALIFIED;t.stage=STAGES.ZONE_FINAL;});loaderDraft=null;saveState();return qualified;}
  function teamSetStats(teamId,categoryId,stage,zoneId){return categoryMatches(categoryId).filter(function(r){return(!stage||r.stage===stage)&&(!zoneId||r.zoneId===zoneId)&&(r.winnerId===teamId||r.loserId===teamId)&&matchSetsFor(r).length;}).reduce(function(stats,r){var teamIsA=r.winnerId===teamId;matchSetsFor(r).forEach(function(set){stats.for+=teamIsA?set.a:set.b;stats.against+=teamIsA?set.b:set.a;});return stats;},{for:0,against:0});}
  function teamClassificationPoints(teamId,categoryId,stage){return categoryMatches(categoryId).filter(function(r){return(!stage||r.stage===stage)&&(r.winnerId===teamId||r.loserId===teamId);}).reduce(function(total,r){var p=resultPoints(r.score);return total+(r.winnerId===teamId?p.winner:p.loser);},0);}
  function createMatchResult(winnerId,loserId,score,sets,zoneId){var c=category(),winner=teamById(winnerId),loser=teamById(loserId),f=zoneFlow(c);if(!c)throw Error('Seleccioná una categoría.');if(c.currentStage===STAGES.FINISHED)throw Error('El torneo ya finalizó.');if(!winner||!loser||winner.categoryId!==c.id||loser.categoryId!==c.id||winner.id===loser.id)throw Error('Los equipos deben pertenecer a la categoría activa y ser diferentes.');if([STATUS.ELIMINATED,STATUS.CHAMPION,STATUS.RUNNER_UP].indexOf(winner.status)>=0||[STATUS.ELIMINATED,STATUS.CHAMPION,STATUS.RUNNER_UP].indexOf(loser.status)>=0)throw Error('Solo pueden registrar resultados los equipos activos.');if(score!=='2-0'&&score!=='2-1')throw Error('El resultado debe ser 2–0 o 2–1.');var actualZone=zoneId||currentZoneId(c);if(c.currentStage===STAGES.GENERAL&&f.zones.length){if(!actualZone||!zoneById(c,actualZone)||teamZone(c,winner.id)!==zoneById(c,actualZone)||teamZone(c,loser.id)!==zoneById(c,actualZone))throw Error('Ambos equipos deben pertenecer a la misma zona.');}if(c.currentStage===STAGES.ZONE_FINAL&&actualZone!==f.secondStageZoneId)throw Error('El resultado debe pertenecer a la zona única de la segunda etapa.');if(categoryMatches(c.id).some(function(r){return r.stage===c.currentStage&&r.zoneId===actualZone&&((r.winnerId===winner.id&&r.loserId===loser.id)||(r.winnerId===loser.id&&r.loserId===winner.id));}))throw Error('Ese cruce ya tiene un resultado.');var normalizedSets=typeof sets==='undefined'?[]:validateMatchSets(sets),wins=normalizedSets.length?setWinnerCount(normalizedSets):null;if(wins&&(wins.a!==2||score!=='2-'+wins.b))throw Error('El resultado tradicional no coincide con los marcadores.');state.matchResults.push({id:uid('match'),categoryId:c.id,winnerId:winner.id,loserId:loser.id,score:score,sets:normalizedSets,stage:c.currentStage,zoneId:actualZone||null,createdAt:new Date().toISOString()});if(!saveState()){state.matchResults.pop();throw Error('No se pudo guardar el resultado.');}}
  function createMatchFromSets(teamAId,setsA,teamBId,setsB,setScores,zoneId){var a=Number(setsA),b=Number(setsB);if(!Number.isInteger(a)||!Number.isInteger(b)||a<0||b<0)throw Error('Los sets deben ser números enteros mayores o iguales a 0.');if(!((a===2&&(b===0||b===1))||(b===2&&(a===0||a===1))))throw Error('Ingresá un resultado válido: 2–0 o 2–1.');var winner=a>b?teamAId:teamBId,loser=a>b?teamBId:teamAId,score=Math.max(a,b)+'-'+Math.min(a,b);if(typeof setScores==='undefined')return createMatchResult(winner,loser,score,undefined,zoneId);var sets=Array.isArray(setScores)?setScores:[];if(!sets.length)throw Error('Ingresá los marcadores reales de cada set.');if(sets.length!==(a+b))throw Error('La cantidad de marcadores debe coincidir con los sets ganados.');var oriented=sets.map(function(set){var x=Number(set.a),y=Number(set.b);return teamAId===winner?{a:x,b:y}:{a:y,b:x};});return createMatchResult(winner,loser,score,oriented,zoneId);}
  function deleteMatchResult(matchId){var match=state.matchResults.filter(function(r){return r.id===matchId;})[0];if(!match||match.categoryId!==state.selectedCategoryId)throw Error('Resultado inválido para esta categoría.');var previous=state.matchResults;state.matchResults=state.matchResults.filter(function(r){return r.id!==matchId;});if(!saveState()){state.matchResults=previous;throw Error('No se pudo guardar la eliminación.');}}
  function updateMatchResult(matchId,score,sets){var match=state.matchResults.filter(function(r){return r.id===matchId;})[0];if(!match||match.categoryId!==state.selectedCategoryId)throw Error('Resultado inválido para esta categoría.');if(score!=='2-0'&&score!=='2-1')throw Error('El resultado debe ser 2–0 o 2–1.');var previous={score:match.score,sets:match.sets};try{match.score=score;if(typeof sets!=='undefined'){match.sets=validateMatchSets(sets);var wins=setWinnerCount(match.sets);if(wins.a!==2||score!=='2-'+wins.b)throw Error('El resultado tradicional no coincide con los marcadores.');}}catch(error){match.score=previous.score;match.sets=previous.sets;throw error;}if(!saveState()){match.score=previous.score;match.sets=previous.sets;throw Error('No se pudo guardar la corrección.');}}

  function standings(categoryId,stage,zoneId){
    return teams(categoryId).filter(function(team){
      return !zoneId||zoneById(category(),zoneId)&&zoneById(category(),zoneId).teamIds.indexOf(team.id)>=0;
    }).map(function(team){
      var scoped=categoryMatches(categoryId).filter(function(r){return(!stage||r.stage===stage)&&(!zoneId||r.zoneId===zoneId)&&(r.winnerId===team.id||r.loserId===team.id);});
      var classificationPoints=scoped.reduce(function(total,r){var p=resultPoints(r.score);return total+(r.winnerId===team.id?p.winner:p.loser);},0);
      var setStats=teamSetStats(team.id,categoryId,stage,zoneId);
      var setWins=scoped.reduce(function(total,m){return total+(m.winnerId===team.id?2:(m.score==='2-1'?1:0));},0);
      var setLosses=scoped.reduce(function(total,m){return total+(m.winnerId===team.id?(m.score==='2-1'?1:0):2);},0);
      var setRatio=setLosses>0?(setWins/setLosses):(setWins>0?1000+setWins:0);
      var ptosRatio=setStats.against>0?(setStats.for/setStats.against):(setStats.for>0?1000+setStats.for:0);
      return{team:team,resultCount:scoped.length,stagePoints:classificationPoints,classificationPoints:classificationPoints,scorePoints:calculateTeamStageTotal(team,stage),totalPoints:calculateTeamTotal(team),pointsFor:setStats.for,pointsAgainst:setStats.against,difference:setStats.for-setStats.against,setWins:setWins,setLosses:setLosses,setRatio:setRatio,ptosRatio:ptosRatio};
    }).sort(function(a,b){
      return b.classificationPoints-a.classificationPoints||b.setRatio-a.setRatio||b.ptosRatio-a.ptosRatio||b.pointsFor-a.pointsFor||a.pointsAgainst-b.pointsAgainst||a.team.name.localeCompare(b.team.name);
    });
  }

  function advance(target,limit){var c=category();if(!c)throw Error('Seleccioná una categoría.');var list=active(c.id);if(list.length<2)throw Error('Se necesitan al menos 2 equipos activos.');var ranking=standings(c.id,c.currentStage).filter(function(row){return list.some(function(t){return t.id===row.team.id;});}),keep=ranking.slice(0,Math.min(limit,list.length)).map(function(row){return row.team.id;});list.forEach(function(t){if(keep.indexOf(t.id)>=0){t.status=STATUS.QUALIFIED;t.stage=target;}else t.status=STATUS.ELIMINATED;});c.currentStage=target;saveState();}
  function generateTop16(){var c=category();if(!c||c.currentStage!==STAGES.GENERAL)throw Error('La etapa actual no es clasificación general.');advance(STAGES.TOP_16,16);}
  function generateTop8(){var c=category();if(!c||c.currentStage!==STAGES.TOP_16)throw Error('La etapa actual no es Top 16.');advance(STAGES.TOP_8,8);}
  function generateTop4(){var c=category();if(!c||c.currentStage!==STAGES.TOP_8)throw Error('La etapa actual no es Top 8.');advance(STAGES.TOP_4,4);}
  function advanceToSemifinals(){var c=category();if(!c||c.currentStage!==STAGES.TOP_4)throw Error('La etapa actual no es Top 4.');advance(STAGES.SEMIFINAL,4);}
  function advanceToFinal(){var c=category();if(!c||c.currentStage!==STAGES.SEMIFINAL)throw Error('La etapa actual no es semifinales.');advance(STAGES.FINAL,2);}
  function finishTournament(){var c=category();if(!c||c.currentStage!==STAGES.FINAL)throw Error('La categoría no está en la final.');var rows=standings(c.id,STAGES.FINAL).filter(function(r){return r.team.status===STATUS.ACTIVE||r.team.status===STATUS.QUALIFIED;});if(rows.length<2||!rows[0].stagePoints||!rows[1].stagePoints)throw Error('Cargá un puntaje para cada finalista.');c.championId=rows[0].team.id;c.runnerUpId=rows[1].team.id;c.currentStage=STAGES.FINISHED;rows[0].team.status=STATUS.CHAMPION;rows[1].team.status=STATUS.RUNNER_UP;saveState();}

  // ---------------------------------------------------------------------------
  // Scoreboard Manual & Asistente de Flujo (sin generación de fixture)
  // ---------------------------------------------------------------------------
  function activeZonesForCategory(c){
    if(!c)return[];
    var f=zoneFlow(c);
    return c.currentStage===STAGES.ZONE_FINAL?[zoneById(c,f.secondStageZoneId)].filter(Boolean):f.zones.filter(function(z){return z.id!==f.secondStageZoneId;});
  }

  function zoneTeamsForLoader(c,zoneId){
    if(!c)return[];
    var z=zoneId?zoneById(c,zoneId):null;
    if(z&&z.teamIds.length)return z.teamIds.map(teamById).filter(Boolean);
    return active(c.id);
  }

  function findExistingMatch(c,zoneId,teamAId,teamBId){
    if(!c||!teamAId||!teamBId||teamAId===teamBId)return null;
    var stage=c.currentStage===STAGES.ZONE_FINAL?STAGES.ZONE_FINAL:STAGES.GENERAL;
    var targetZone=zoneId||null;
    return categoryMatches(c.id).filter(function(r){
      return r.stage===stage&&r.zoneId===targetZone&&((r.winnerId===teamAId&&r.loserId===teamBId)||(r.winnerId===teamBId&&r.loserId===teamAId));
    })[0]||null;
  }

  function defaultPairForZone(c,zoneId){
    var pool=zoneTeamsForLoader(c,zoneId);
    if(!pool.length)return{teamAId:'',teamBId:''};
    if(pool.length===1)return{teamAId:pool[0].id,teamBId:''};
    for(var i=0;i<pool.length;i+=1){
      for(var j=0;j<pool.length;j+=1){
        if(i!==j&&!findExistingMatch(c,zoneId,pool[i].id,pool[j].id)){
          return{teamAId:pool[i].id,teamBId:pool[j].id};
        }
      }
    }
    return{teamAId:pool[0].id,teamBId:pool[1].id};
  }

  function categoryProgressSummary(c){
    var f=zoneFlow(c),initialZones=f.zones.filter(function(z){return z.id!==f.secondStageZoneId;}),allTeams=teams(c.id),played=categoryMatches(c.id).length;
    return{zonesCount:initialZones.length,teamsCount:allTeams.length,playedCount:played};
  }

  function nextStepGuide(c){
    var prog=categoryProgressSummary(c);
    if(!prog.zonesCount){
      return{step:1,tone:'guide',title:'Paso 1: Creá las zonas del torneo',desc:'Empezá creando al menos una zona (por ejemplo: Zona A o Zona 4) para poder anotar a los equipos.',ctaView:'zones',ctaLabel:'Crear zona'};
    }
    if(prog.teamsCount<2){
      return{step:1,tone:'guide',title:'Paso 1: Agregá al menos 2 equipos en una zona',desc:'Escribí el nombre de cada equipo directamente dentro de la tarjeta de su zona.',ctaView:'zones',ctaLabel:'Agregar equipos'};
    }
    if(prog.playedCount===0){
      return{step:2,tone:'action',title:'Paso 2: Cargá el resultado de un partido',desc:'Elegí la zona y los dos equipos que jugaron para anotar los puntos de cada set.',ctaView:'results',ctaLabel:'Ir a cargar resultado →'};
    }
    if(c.currentStage===STAGES.GENERAL){
      return{step:3,tone:'ready',title:'Fase de zonas en curso · '+prog.playedCount+' partido'+(prog.playedCount===1?'':'s')+' cargado'+(prog.playedCount===1?'':'s'),desc:'Seguí cargando resultados manualmente o consultá la tabla de posiciones por zona.',ctaView:'positions',ctaLabel:'Ver posiciones →'};
    }
    return{step:3,tone:'ready',title:'Segunda etapa en curso',desc:'Revisá las posiciones actualizadas o el historial de partidos.',ctaView:'positions',ctaLabel:'Ver tabla →'};
  }

  function initLoaderDraft(c,preferredZoneId){
    var zones=activeZonesForCategory(c);
    var z=(preferredZoneId&&zoneById(c,preferredZoneId))||zones[0]||null;
    var zoneId=z?z.id:'';
    var pair=defaultPairForZone(c,zoneId);
    return{categoryId:c.id,editMatchId:null,zoneId:zoneId,teamAId:pair.teamAId,teamBId:pair.teamBId,s1A:'',s1B:'',s2A:'',s2B:'',s3A:'',s3B:'',historyOpen:false};
  }
  function ensureLoaderDraft(c){
    if(!c)return null;
    if(!loaderDraft||loaderDraft.categoryId!==c.id)loaderDraft=initLoaderDraft(c);
    return loaderDraft;
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
    if(!teamA||!teamB)teamError='Seleccioná ambos equipos.';
    else if(teamA.id===teamB.id)teamError='Elegí dos equipos distintos.';
    else if(c&&c.currentStage===STAGES.GENERAL&&draft.zoneId){
      var z=zoneById(c,draft.zoneId);
      if(z&&z.teamIds.length&&(z.teamIds.indexOf(teamA.id)<0||z.teamIds.indexOf(teamB.id)<0))teamError='Ambos equipos deben pertenecer a '+z.name+'.';
    }
    if(!teamError&&c){
      var existing=findExistingMatch(c,draft.zoneId,teamA.id,teamB.id);
      if(existing&&existing.id!==draft.editMatchId){
        duplicateMatch=existing;
      }
    }
    var s1=evaluateSetRow(draft.s1A,draft.s1B,false);
    var s2=evaluateSetRow(draft.s2A,draft.s2B,false);
    var winsA=(s1.winner==='A'?1:0)+(s2.winner==='A'?1:0);
    var winsB=(s1.winner==='B'?1:0)+(s2.winner==='B'?1:0);
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
    var teamAWins=evalState.winsA>evalState.winsB;
    var winnerId=teamAWins?evalState.teamA.id:evalState.teamB.id;
    var loserId=teamAWins?evalState.teamB.id:evalState.teamA.id;
    var score=Math.max(evalState.winsA,evalState.winsB)+'-'+Math.min(evalState.winsA,evalState.winsB);
    var oriented=evalState.sets.map(function(s){return teamAWins?{a:s.a,b:s.b}:{a:s.b,b:s.a};});
    if(draft.editMatchId){
      var existing=state.matchResults.filter(function(r){return r.id===draft.editMatchId;})[0];
      if(!existing)throw Error('El partido a editar ya no existe.');
      var snapshot=JSON.parse(JSON.stringify(existing));
      existing.winnerId=winnerId;
      existing.loserId=loserId;
      existing.score=score;
      existing.sets=validateMatchSets(oriented);
      if(!saveState()){Object.assign(existing,snapshot);throw Error('No se pudo guardar la edición.');}
      toastState={kind:'update',matchId:existing.id,snapshot:snapshot,text:teamById(winnerId).name+' '+score.replace('-','–')+' '+teamById(loserId).name+' guardado'};
      loaderDraft=initLoaderDraft(c,draft.zoneId);
      return existing;
    }
    createMatchFromSets(evalState.teamA.id,evalState.winsA,evalState.teamB.id,evalState.winsB,evalState.sets,draft.zoneId||undefined);
    var created=state.matchResults[state.matchResults.length-1];
    toastState={kind:'create',matchId:created.id,text:teamById(created.winnerId).name+' '+created.score.replace('-','–')+' '+teamById(created.loserId).name+' guardado'};
    loaderDraft=initLoaderDraft(c,draft.zoneId);
    return created;
  }

  // ---------------------------------------------------------------------------
  // Vistas de la Interfaz
  // ---------------------------------------------------------------------------
  function sidebar(){
    var c=category();
    var prog=c?categoryProgressSummary(c):null;
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
        '<div class="tip"><strong>¿Cómo funciona?</strong><br>1. Creá zonas y equipos<br>2. Anotá los sets<br>3. Revisá las posiciones</div>'+
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
    var totalZones=state.categories.reduce(function(acc,c){return acc+zoneFlow(c).zones.filter(function(z){return z.id!==zoneFlow(c).secondStageZoneId;}).length;},0);
    return'<div class="heading"><div><p class="eyebrow">PANEL DE CONTROL</p><h1>Mis Categorías</h1><p class="desc">Seleccioná una categoría para armar sus zonas, cargar resultados por set y consultar las posiciones.</p></div><div class="heading-actions"><button class="primary" data-action="new-category">＋ Nueva categoría</button></div></div>'+
      '<section class="onboarding-steps">'+
        '<div class="onboard-step"><span class="onboard-num">1</span><div><b>Creá la categoría</b><small>Ej: Categoría +50, +60 o Mixto.</small></div></div>'+
        '<div class="onboard-step"><span class="onboard-num">2</span><div><b>Armá zonas y equipos</b><small>Creá cada zona y agregá sus equipos ahí mismo.</small></div></div>'+
        '<div class="onboard-step"><span class="onboard-num">3</span><div><b>Cargá sets y mirá la tabla</b><small>Anotá los puntos de cada set y la posición se calcula sola.</small></div></div>'+
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
              '<div class="category-card-top"><span class="avatar">'+initial(c.name)+'</span><span class="badge">'+LABELS[c.currentStage]+'</span></div>'+
              '<h3>'+esc(c.name)+'</h3>'+
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
          '<p>Empezá creando tu primera categoría (por ejemplo: <strong>Categoría +50</strong>) para armar las zonas y cargar partidos.</p>'+
          '<button class="primary" data-action="new-category">＋ Crear mi primera categoría</button>'+
        '</section>');
  }

  function categoryHeader(c){
    var prog=categoryProgressSummary(c),guide=nextStepGuide(c);
    var activeTab=(view==='teams'?'zones':(view==='table'?'positions':view));
    return'<div class="category-top-bar">'+
        '<button type="button" class="back-home-link" data-view="home">← Todas las categorías</button>'+
        '<div class="heading-actions"><span class="badge">'+LABELS[c.currentStage]+'</span><button class="link" data-action="edit-category" data-id="'+c.id+'">Renombrar</button><button class="link danger delete-category-button" data-action="delete-active-category" data-id="'+c.id+'">Eliminar categoría</button></div>'+
      '</div>'+
      '<div class="heading category-main-heading"><div><h1>'+esc(c.name)+'</h1><p class="desc">'+prog.zonesCount+' zona'+(prog.zonesCount===1?'':'s')+' · '+prog.teamsCount+' equipo'+(prog.teamsCount===1?'':'s')+' · '+prog.playedCount+' partido'+(prog.playedCount===1?'':'s')+' cargado'+(prog.playedCount===1?'':'s')+'</p></div></div>'+
      '<div class="guide-banner '+guide.tone+'">'+
        '<div><strong>'+esc(guide.title)+'</strong><span>'+esc(guide.desc)+'</span></div>'+
        (activeTab!==guide.ctaView?'<button type="button" class="primary guide-cta" data-view="'+guide.ctaView+'">'+esc(guide.ctaLabel)+'</button>':'')+
      '</div>'+
      '<div id="notice"></div>'+
      '<nav class="workflow-stepper" aria-label="Pasos del torneo">'+
        '<button type="button" data-view="zones" class="step-tab '+(activeTab==='zones'?'active':'')+'"><span class="step-num">1</span><div><b>Zonas y Equipos</b><small>'+prog.zonesCount+' zonas · '+prog.teamsCount+' equipos</small></div></button>'+
        '<button type="button" data-view="results" class="step-tab '+(activeTab==='results'?'active':'')+'"><span class="step-num">2</span><div><b>Cargar resultado</b><small>Carga manual por sets</small></div></button>'+
        '<button type="button" data-view="positions" class="step-tab '+(activeTab==='positions'?'active':'')+'"><span class="step-num">3</span><div><b>Posiciones</b><small>Tablas por zona</small></div></button>'+
        '<button type="button" data-view="matches" class="step-tab '+(activeTab==='matches'?'active':'')+'"><span class="step-num">4</span><div><b>Partidos Jugados</b><small>'+categoryMatches(c.id).length+' registrados</small></div></button>'+
      '</nav>';
  }

  function zoneCard(c,z){
    var f=zoneFlow(c),editable=c.currentStage===STAGES.GENERAL&&f.status!==ZONE_STATUS.FINISHED,assigned=z.teamIds.map(teamById).filter(Boolean),unassigned=teams(c.id).filter(function(t){return!teamZone(c,t.id);});
    var scopedMatches=zoneMatches(c.id,STAGES.GENERAL,z.id);
    return'<article class="card zone-card">'+
      '<div class="card-title">'+
        '<div><p class="eyebrow">ZONA</p><h2>'+esc(z.name)+'</h2><p class="desc">'+assigned.length+' equipo'+(assigned.length===1?'':'s')+' · '+scopedMatches.length+' partido'+(scopedMatches.length===1?'':'s')+' cargado'+(scopedMatches.length===1?'':'s')+'</p></div>'+
        (editable?'<div class="actions" style="margin:0;padding:0;border:0"><button class="link" data-action="rename-zone" data-id="'+z.id+'">Renombrar</button><button class="link danger" data-action="delete-zone" data-id="'+z.id+'">Eliminar</button></div>':'')+
      '</div>'+
      (editable?
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
      :'')+
      '<div class="zone-teams">'+
        (assigned.length?assigned.map(function(t,idx){
          return'<div class="recent-item"><span class="pos">'+(idx+1)+'</span><span><b>'+esc(t.name)+'</b></span>'+(editable&&!zoneHasResults(c,z.id)?'<button class="link danger" data-action="remove-team-zone" data-team-id="'+t.id+'" data-zone-id="'+z.id+'">Quitar</button>':'')+'</div>';
        }).join(''):'<div class="zone-empty-hint">Todavía no hay equipos en esta zona. Escribí el nombre arriba para agregar el primero.</div>')+
      '</div>'+
    '</article>';
  }

  function zonesPage(){
    var c=category(),f=zoneFlow(c),initialZones=f.zones.filter(function(z){return z.id!==f.secondStageZoneId;});
    var preview=f.qualified.map(function(q){
      var t=teamById(q.teamId),z=zoneById(c,q.sourceZoneId);
      return t?'<div class="playoff-team"><strong>'+esc(t.name)+'</strong><span>'+esc(z?z.name:'Zona de origen')+'</span></div>':'';
    }).join('');
    return'<section class="card zone-creator-bar">'+
        '<div class="toolbar">'+
          '<div><p class="eyebrow">PASO 1 · ESTRUCTURA DEL TORNEO</p><h2>Zonas y Equipos</h2><p class="desc">Creá cada zona a la derecha y después agregá los equipos directamente dentro de su tarjeta.</p></div>'+
          (c.currentStage===STAGES.GENERAL?'<form class="inline zone-create-inline" data-form="zone"><input id="new-zone-input" name="name" required placeholder="Ej: Zona 4 o Zona A"><button class="primary">＋ Crear zona</button></form>':'')+
        '</div>'+
      '</section>'+
      (initialZones.length?
        '<div class="zone-grid">'+initialZones.map(function(z){return zoneCard(c,z);}).join('')+'</div>'
      :
        '<section class="card empty" style="margin-top:16px"><h2>Empezá creando la primera zona</h2><p>Usá el campo de arriba (por ejemplo: <strong>Zona 4</strong> o <strong>Zona A</strong>) y presioná “Crear zona”.</p></section>'
      )+
      (c.currentStage===STAGES.GENERAL&&initialZones.length?
        '<section class="card zone-confirm"><div><p class="eyebrow">CIERRE DE PRIMERA ETAPA</p><h2>Clasificar 2 equipos por zona a la Segunda Etapa</h2><p class="desc">Una vez cargados todos los partidos de cada zona, podés confirmar los clasificados para armar la Zona Única.</p></div><button class="primary" data-action="preview-zones">Revisar clasificados →</button></section>'
      :'')+
      (c.currentStage===STAGES.ZONE_FINAL?
        '<section class="card playoff-board"><p class="eyebrow">CLASIFICADOS CONFIRMADOS</p><h2>Zona única · Segunda etapa</h2><div class="playoff-grid">'+preview+'</div></section>'
      :'');
  }

  function formatRatioComma(num,den,zeroWhenNoLosses){
    if(den===0)return zeroWhenNoLosses?'0,00':(num>0?'MAX':'0,00');
    return(num/den).toFixed(2).replace('.',',');
  }

  function positionRow(c,z,row,index,stage){
    var scoped=categoryMatches(c.id).filter(function(m){return m.stage===stage&&m.zoneId===z.id&&(m.winnerId===row.team.id||m.loserId===row.team.id);});
    var wins=scoped.filter(function(m){return m.winnerId===row.team.id;}).length;
    var losses=scoped.length-wins;
    var r20=0,r21=0,r02=0,r12=0;
    scoped.forEach(function(m){
      var isWinner=m.winnerId===row.team.id;
      if(isWinner&&m.score==='2-0')r20+=1;
      else if(isWinner&&m.score==='2-1')r21+=1;
      else if(!isWinner&&m.score==='2-0')r02+=1;
      else if(!isWinner&&m.score==='2-1')r12+=1;
    });
    return'<tr>'+
      '<td class="col-pos">'+(index+1)+'</td>'+
      '<td class="col-team"><strong>'+esc(row.team.name)+'</strong></td>'+
      '<td class="col-pts"><b>'+row.classificationPoints+'</b></td>'+
      '<td>'+row.resultCount+'</td><td>'+wins+'</td><td>'+losses+'</td>'+
      '<td>'+row.setWins+'</td><td>'+row.setLosses+'</td>'+
      '<td>'+row.pointsFor+'</td><td>'+row.pointsAgainst+'</td>'+
      '<td class="col-res">'+r20+'</td><td class="col-res">'+r21+'</td><td class="col-res">'+r02+'</td><td class="col-res">'+r12+'</td>'+
      '<td class="col-coc">'+formatRatioComma(row.setWins,row.setLosses,false)+'</td>'+
      '<td class="col-coc">'+formatRatioComma(row.pointsFor,row.pointsAgainst,false)+'</td>'+
      '<td class="col-coc">0</td>'+
    '</tr>';
  }

  function renderZoneStandingsSheet(c,z,stage){
    var rows=zoneRows(c,z,stage);
    var headerTitle=(c.name.toUpperCase().indexOf('+50')>=0?'+50 ':'')+z.name.toUpperCase();
    return'<section class="card official-sheet-card">'+
      '<div class="sheet-zone-heading">'+
        '<span class="sheet-category-tag">'+esc(c.name.toUpperCase())+'</span>'+
        '<h2>'+esc(z.name.toUpperCase())+'</h2>'+
      '</div>'+
      '<div class="table-wrap">'+
        '<table class="table official-positions-table">'+
          '<thead>'+
            '<tr class="thead-group-row">'+
              '<th colspan="2" rowspan="2" class="th-zone-title">'+esc(headerTitle)+'</th>'+
              '<th rowspan="2" class="th-pts">PUNTOS</th>'+
              '<th colspan="3" class="th-block">PARTIDOS</th>'+
              '<th colspan="2" class="th-block">SET</th>'+
              '<th colspan="2" class="th-block">TANTOS</th>'+
              '<th colspan="4" class="th-block th-res-group">RESULTADOS</th>'+
              '<th colspan="3" class="th-block th-coc-group">COCIENTES</th>'+
            '</tr>'+
            '<tr class="thead-sub-row">'+
              '<th>J</th><th>G</th><th>P</th>'+
              '<th>SF</th><th>SE</th>'+
              '<th>PG</th><th>PP</th>'+
              '<th class="th-res-sub">2-0</th><th class="th-res-sub">2-1</th><th class="th-res-sub">0-2</th><th class="th-res-sub">1-2</th>'+
              '<th class="th-coc-sub">SET</th><th class="th-coc-sub">PTOS</th><th class="th-coc-sub">P.</th>'+
            '</tr>'+
          '</thead>'+
          '<tbody>'+
            (rows.length?rows.map(function(row,i){return positionRow(c,z,row,i,stage);}).join(''):'<tr><td colspan="17" class="empty-cell">Sin equipos asignados en esta zona.</td></tr>')+
          '</tbody>'+
        '</table>'+
      '</div>'+
    '</section>';
  }

  function positionsPage(){
    var c=category(),f=zoneFlow(c),initialZones=f.zones.filter(function(z){return z.id!==f.secondStageZoneId;}),secondZone=f.secondStageZoneId?zoneById(c,f.secondStageZoneId):null;
    var hasTeams=initialZones.some(function(z){return z.teamIds.length;});
    if(!hasTeams){
      return'<section class="card empty"><h2>Todavía no hay equipos en las zonas</h2><p>Primero agregá las zonas y sus equipos en el Paso 1 para ver la tabla de posiciones.</p><button class="primary" data-view="zones">Ir a Paso 1: Zonas y Equipos →</button></section>';
    }
    return'<div class="toolbar"><div><p class="eyebrow">PASO 3 · PLANILLA OFICIAL DE POSICIONES</p><h2>Tabla de Posiciones por Zona</h2><p class="desc">Se calcula automáticamente a partir de los sets cargados. Orden: PUNTOS, cociente de SET y cociente de PTOS.</p></div><button class="primary" data-view="results">＋ Cargar partido</button></div>'+
      (secondZone?renderZoneStandingsSheet(c,secondZone,STAGES.ZONE_FINAL):'')+
      '<div class="positions-stack">'+initialZones.map(function(z){return renderZoneStandingsSheet(c,z,STAGES.GENERAL);}).join('')+'</div>';
  }

  function matchStageLabel(match){return match.stage===STAGES.GENERAL?'Fase de zonas':(match.stage===STAGES.ZONE_FINAL?'Segunda etapa · Zona única':(match.stage===STAGES.FINAL?'Cruces finales':LABELS[match.stage]||match.stage));}
  function matchZoneLabel(c,match){var z=match.zoneId?zoneById(c,match.zoneId):null;return z?z.name:'—';}

  function matchesPage(){
    var c=category(),all=categoryMatches(c.id).slice().sort(function(a,b){return (a.stage===STAGES.FINAL?1:0)-(b.stage===STAGES.FINAL?1:0)||a.id.localeCompare(b.id);});
    var zones=zoneFlow(c).zones.filter(function(z){return z.id!==zoneFlow(c).secondStageZoneId;});
    var rows=all.filter(function(match){return(matchPhaseFilter==='ALL'||match.stage===matchPhaseFilter)&&(matchZoneFilter==='ALL'||match.zoneId===matchZoneFilter);});
    return'<div class="toolbar"><div><p class="eyebrow">PASO 4 · PLANILLA DE RESULTADOS</p><h2>Partidos Jugados</h2><p class="desc">Detalle de cada partido por sets. Podés editar o deshacer cualquier carga.</p></div><button class="primary" data-view="results">＋ Cargar partido</button></div>'+
      '<section class="card match-filters">'+
        '<label>Fase<select data-action="match-phase-filter"><option value="ALL">Todas las fases</option><option value="'+STAGES.GENERAL+'" '+(matchPhaseFilter===STAGES.GENERAL?'selected':'')+'>Fase de zonas</option><option value="'+STAGES.ZONE_FINAL+'" '+(matchPhaseFilter===STAGES.ZONE_FINAL?'selected':'')+'>Segunda etapa</option></select></label>'+
        '<label>Zona<select data-action="match-zone-filter"><option value="ALL">Todas las zonas</option>'+zones.map(function(z){return'<option value="'+z.id+'" '+(matchZoneFilter===z.id?'selected':'')+'>'+esc(z.name)+'</option>';}).join('')+'</select></label>'+
        '<strong>'+rows.length+' partido'+(rows.length===1?'':'s')+'</strong>'+
      '</section>'+
      '<section class="card match-board"><div class="table-wrap"><table class="table official-matches-table"><thead><tr><th>P</th><th>ZONA / FASE</th><th>EQUIPO</th><th>RES.</th><th>SET 1</th><th>SET 2</th><th>SET 3</th><th>ACCIONES</th></tr></thead><tbody>'+
      (rows.length?rows.map(function(match,index){
        var w=teamById(match.winnerId),l=teamById(match.loserId),sets=matchSetsFor(match);
        var wSets=2,lSets=match.score==='2-1'?1:0;
        var s1w=sets[0]?sets[0].a:0,s1l=sets[0]?sets[0].b:0;
        var s2w=sets[1]?sets[1].a:0,s2l=sets[1]?sets[1].b:0;
        var s3w=sets[2]?sets[2].a:0,s3l=sets[2]?sets[2].b:0;
        return'<tr class="match-row-winner">'+
            '<td rowspan="2" class="match-p-cell"><strong>P'+(index+1)+'</strong></td>'+
            '<td rowspan="2" class="match-zone-cell"><strong>'+esc(matchZoneLabel(c,match))+'</strong><small>'+esc(matchStageLabel(match))+'</small></td>'+
            '<td class="match-team-cell is-winner"><strong>'+esc(w?w.name:'Equipo')+'</strong></td>'+
            '<td class="match-res-cell is-winner"><b>'+wSets+'</b></td>'+
            '<td>'+s1w+'</td><td>'+s2w+'</td><td>'+s3w+'</td>'+
            '<td rowspan="2" class="match-actions-cell"><button type="button" class="link" data-action="edit-match" data-id="'+match.id+'">Editar</button><button type="button" class="link danger" data-action="delete-match" data-id="'+match.id+'">Deshacer</button></td>'+
          '</tr>'+
          '<tr class="match-row-loser">'+
            '<td class="match-team-cell">'+esc(l?l.name:'Equipo')+'</td>'+
            '<td class="match-res-cell">'+lSets+'</td>'+
            '<td>'+s1l+'</td><td>'+s2l+'</td><td>'+s3l+'</td>'+
          '</tr>';
      }).join(''):'<tr><td colspan="8"><div class="empty"><p>Todavía no hay partidos cargados para este filtro.</p></div></td></tr>')+
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
    var currentZone=draft.zoneId?zoneById(c,draft.zoneId):(zones[0]||null);
    var zoneTeamsList=zoneTeamsForLoader(c,currentZone?currentZone.id:'');
    var teamBOptions=zoneTeamsList.filter(function(t){return t.id!==draft.teamAId;});
    if(teamBOptions.length&&!teamBOptions.some(function(t){return t.id===draft.teamBId;})){
      draft.teamBId=teamBOptions[0].id;
    }
    var evalState=evaluateScoreboard(c,draft);
    var recentMatches=categoryMatches(c.id).slice().reverse();
    var dupMatch=evalState.duplicateMatch;
    var dupWinner=dupMatch?teamById(dupMatch.winnerId):null,dupLoser=dupMatch?teamById(dupMatch.loserId):null,dupSets=dupMatch?matchSetsFor(dupMatch):[];
    return(toastState?'<div class="toast-undo" role="status" aria-live="polite"><span>✓ <strong>'+esc(toastState.text)+' · </strong><button type="button" class="toast-undo-btn" data-action="undo-last-match" data-id="'+esc(toastState.matchId)+'">Deshacer</button></span><div class="toast-actions"><button type="button" class="toast-close-btn" data-action="dismiss-toast" aria-label="Cerrar aviso">✕</button></div></div>':'')+
      '<section class="card result-loader-card"><form class="scoreboard-form" data-form="scoreboard-match" novalidate>'+
      '<div class="loader-selectors-grid">'+
      '<div class="loader-field">'+picker()+'</div>'+
      (zones.length?'<label class="loader-field">Zona<select id="loader-zone" name="zoneId" data-action="loader-zone">'+zones.map(function(z){return'<option value="'+z.id+'" '+(z.id===(currentZone?currentZone.id:'')?'selected':'')+'>'+esc(z.name)+'</option>';}).join('')+'</select></label>':'')+
      '<label class="loader-field">Equipo 1<select id="loader-team-a" name="teamAId" data-action="loader-team-a">'+zoneTeamsList.map(function(t){return'<option value="'+t.id+'" '+(t.id===draft.teamAId?'selected':'')+'>'+esc(t.name)+'</option>';}).join('')+'</select></label>'+
      '<label class="loader-field">Equipo 2<select id="loader-team-b" name="teamBId" data-action="loader-team-b">'+(teamBOptions.length?teamBOptions.map(function(t){return'<option value="'+t.id+'" '+(t.id===draft.teamBId?'selected':'')+'>'+esc(t.name)+'</option>';}).join(''):'<option value="">Agregá al menos 2 equipos en la zona</option>')+'</select></label>'+
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
      '<div class="scoreboard-team team-a '+(evalState.winsA>evalState.winsB&&evalState.ready?'is-winner':'')+'"><small>'+(currentZone?esc(currentZone.name):'EQUIPO 1')+'</small><strong id="label-team-a">'+esc(evalState.teamA?evalState.teamA.name:'Equipo 1')+'</strong><span class="team-sets-badge" id="badge-sets-a">'+evalState.winsA+'</span></div>'+
      '<div class="scoreboard-vs">SETS</div>'+
      '<div class="scoreboard-team team-b '+(evalState.winsB>evalState.winsA&&evalState.ready?'is-winner':'')+'"><small>'+(currentZone?esc(currentZone.name):'EQUIPO 2')+'</small><strong id="label-team-b">'+esc(evalState.teamB?evalState.teamB.name:'Equipo 2')+'</strong><span class="team-sets-badge" id="badge-sets-b">'+evalState.winsB+'</span></div>'+
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
        var w=teamById(r.winnerId),l=teamById(r.loserId),z=r.zoneId?zoneById(c,r.zoneId):null,sets=matchSetsFor(r);
        return'<div class="recent-item"><span class="match-status-pill loaded">Cargado</span><span><b>'+esc(w?w.name:'Equipo')+' '+r.score.replace('-','–')+' '+esc(l?l.name:'Equipo')+'</b><small>'+(z?esc(z.name)+' · ':'')+(sets.length?'Sets: '+sets.map(function(s){return s.a+'–'+s.b;}).join(', '):LABELS[r.stage])+'</small></span><div class="recent-actions"><button type="button" class="link" data-action="edit-match" data-id="'+r.id+'">Editar</button><button type="button" class="link danger" data-action="delete-match" data-id="'+r.id+'">Deshacer</button></div></div>';
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
        err.hidden=!showErr;
        err.textContent=showErr?rowEval.error:'';
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
  function openModal(kind){modal.hidden=false;modal.innerHTML='<div class="modal-box"><h2>'+(kind==='category'?'Nueva categoría':'Nuevo equipo')+'</h2><form class="form" data-form="modal-'+kind+'"><label>Nombre<input name="name" required autofocus placeholder="'+(kind==='category'?'Ej: Categoría +50':'Ej: CEDEFYS')+'"></label><div class="modal-actions"><button type="button" class="cancel" data-action="close">Cancelar</button><button class="primary">Guardar</button></div></form></div>';var inp=modal.querySelector('input');if(inp)inp.focus();}
  function openDeleteCategory(c,returnView){modal.hidden=false;modal.innerHTML='<div class="modal-box danger-modal"><h2>¿Eliminar '+esc(c.name)+'?</h2><p class="modal-warning">Se borrarán sus zonas, sus '+teams(c.id).length+' equipos y sus '+categoryMatches(c.id).length+' partidos cargados. Esta acción no se puede deshacer.</p><div class="modal-actions"><button type="button" class="cancel" data-action="close">Cancelar</button><button type="button" class="primary modal-delete-confirm" data-action="confirm-delete-category" data-id="'+c.id+'" data-return-view="'+returnView+'">Sí, eliminar categoría</button></div></div>';}
  function openZonePreview(){var c=category(),f=zoneFlow(c),invalid=f.zones.filter(function(z){return z.id!==f.secondStageZoneId&&(!zoneHasResults(c,z.id)||z.teamIds.length<2);}),preview=[];if(invalid.length){notice('Todavía faltan equipos o resultados por cargar en: '+invalid.map(function(z){return z.name;}).join(', '));return;}f.zones.filter(function(z){return z.id!==f.secondStageZoneId;}).forEach(function(z){zoneRows(c,z,STAGES.GENERAL).slice(0,2).forEach(function(row){preview.push({team:row.team,zone:z});});});modal.hidden=false;modal.innerHTML='<div class="modal-box"><h2>Confirmar clasificados a Segunda Etapa</h2><p class="modal-warning">Pasarán los 2 mejores equipos de cada zona a la Zona Única. La primera etapa quedará guardada para consulta.</p><div class="playoff-grid">'+preview.map(function(item){return'<div class="playoff-team"><strong>'+esc(item.team.name)+'</strong><span>'+esc(item.zone.name)+'</span></div>';}).join('')+'</div><div class="modal-actions"><button type="button" class="cancel" data-action="close">Cancelar</button><button type="button" class="primary" data-action="confirm-zones">Confirmar clasificación</button></div></div>';}
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
    app.querySelectorAll('[data-action="preview-zones"]').forEach(function(e){e.onclick=openZonePreview;});
    app.querySelectorAll('[data-action="rename-zone"]').forEach(function(e){e.onclick=function(){var z=zoneById(category(),e.getAttribute('data-id')),name=prompt('Nuevo nombre de zona:',z?z.name:'');if(name!==null)run(function(){renameZone(e.getAttribute('data-id'),name);},'Zona actualizada.');};});
    app.querySelectorAll('[data-action="delete-zone"]').forEach(function(e){e.onclick=function(){var c=category(),z=zoneById(c,e.getAttribute('data-id'));if(!z)return;var results=categoryMatches(c.id).filter(function(r){return r.zoneId===z.id;}).length,warning='¿Eliminar '+z.name+'?'+(results?' También se eliminarán '+results+' partidos cargados en esta zona.':'');if(confirm(warning))run(function(){return deleteZone(z.id);},'Zona eliminada.');};});
    app.querySelectorAll('[data-action="remove-team-zone"]').forEach(function(e){e.onclick=function(){if(confirm('¿Quitar este equipo de la zona?'))run(function(){removeTeamFromZone(e.getAttribute('data-team-id'),e.getAttribute('data-zone-id'));},'Equipo quitado de la zona.');};});
    app.querySelectorAll('[data-action="edit-category"]').forEach(function(e){e.onclick=function(){var c=state.categories.filter(function(x){return x.id===e.getAttribute('data-id');})[0],name=prompt('Nuevo nombre de categoría:',c?c.name:'');if(c&&name!==null)run(function(){editCategory(c.id,name);},'Categoría actualizada.');};});
    app.querySelectorAll('[data-action="delete-category"],[data-action="delete-active-category"]').forEach(function(e){e.onclick=function(){var c=state.categories.filter(function(x){return x.id===e.getAttribute('data-id');})[0];if(c)openDeleteCategory(c,'home');};});
    app.querySelectorAll('[data-action="delete-match"]').forEach(function(e){e.onclick=function(){var matchId=e.getAttribute('data-id'),match=state.matchResults.filter(function(r){return r.id===matchId;})[0],warning=match&&match.stage===STAGES.GENERAL&&category().currentStage===STAGES.ZONE_FINAL?'Este resultado pertenece a la primera etapa. ¿Continuar?':'¿Deshacer y eliminar este resultado?';if(confirm(warning)){if(toastState&&toastState.matchId===matchId)toastState=null;if(loaderDraft&&loaderDraft.editMatchId===matchId)loaderDraft=initLoaderDraft(category(),match?match.zoneId:undefined);run(function(){deleteMatchResult(matchId);},'Resultado deshecho y tabla recalculada.');}};});
    app.querySelectorAll('[data-action="edit-match"]').forEach(function(e){e.onclick=function(){var c=category(),match=state.matchResults.filter(function(r){return r.id===e.getAttribute('data-id');})[0];if(!c||!match)return;var sets=matchSetsFor(match);loaderDraft={categoryId:c.id,editMatchId:match.id,zoneId:match.zoneId||'',teamAId:match.winnerId,teamBId:match.loserId,s1A:sets[0]?String(sets[0].a):'',s1B:sets[0]?String(sets[0].b):'',s2A:sets[1]?String(sets[1].a):'',s2B:sets[1]?String(sets[1].b):'',s3A:sets[2]?String(sets[2].a):'',s3B:sets[2]?String(sets[2].b):'',historyOpen:true};view='results';render();var firstInput=app.querySelector('[data-set-input="s1A"]');if(firstInput)firstInput.focus();};});
    app.querySelectorAll('[data-action="cancel-edit-match"]').forEach(function(e){e.onclick=function(){var currentZoneId=loaderDraft?loaderDraft.zoneId:undefined;loaderDraft=initLoaderDraft(category(),currentZoneId);render();var sel=document.getElementById('loader-team-a');if(sel)sel.focus();};});
    app.querySelectorAll('[data-action="undo-last-match"]').forEach(function(e){e.onclick=function(){if(!toastState)return;var currentToast=toastState,currentZoneId=loaderDraft?loaderDraft.zoneId:undefined;toastState=null;run(function(){if(currentToast.kind==='update'&&currentToast.snapshot){var target=state.matchResults.filter(function(r){return r.id===currentToast.matchId;})[0];if(target){Object.assign(target,currentToast.snapshot);saveState();}}else{deleteMatchResult(currentToast.matchId);}loaderDraft=initLoaderDraft(category(),currentZoneId);},'Carga deshecha y posiciones recalculadas.');var sel=document.getElementById('loader-team-a');if(sel)sel.focus();};});
    app.querySelectorAll('[data-action="dismiss-toast"]').forEach(function(e){e.onclick=function(){toastState=null;render();};});
    app.querySelectorAll('[data-action="toggle-history"]').forEach(function(e){e.ontoggle=function(){if(loaderDraft)loaderDraft.historyOpen=e.open;};});
    app.querySelectorAll('[data-action="loader-zone"]').forEach(function(e){e.onchange=function(){var c=category(),draft=ensureLoaderDraft(c),pair=defaultPairForZone(c,e.value);draft.zoneId=e.value;draft.editMatchId=null;draft.teamAId=pair.teamAId;draft.teamBId=pair.teamBId;draft.s1A='';draft.s1B='';draft.s2A='';draft.s2B='';draft.s3A='';draft.s3B='';render();var sel=document.getElementById('loader-zone');if(sel)sel.focus();};});
    app.querySelectorAll('[data-action="loader-team-a"]').forEach(function(e){e.onchange=function(){var c=category(),draft=ensureLoaderDraft(c),pool=zoneTeamsForLoader(c,draft.zoneId);draft.teamAId=e.value;draft.editMatchId=null;var availableB=pool.filter(function(t){return t.id!==draft.teamAId;});if(!availableB.some(function(t){return t.id===draft.teamBId;})){draft.teamBId=availableB[0]?availableB[0].id:'';}render();var sel=document.getElementById('loader-team-a');if(sel)sel.focus();};});
    app.querySelectorAll('[data-action="loader-team-b"]').forEach(function(e){e.onchange=function(){var c=category(),draft=ensureLoaderDraft(c);draft.teamBId=e.value;draft.editMatchId=null;render();var sel=document.getElementById('loader-team-b');if(sel)sel.focus();};});
    app.querySelectorAll('[data-set-input]').forEach(function(input){
      input.oninput=function(){var c=category(),draft=ensureLoaderDraft(c),key=input.getAttribute('data-set-input');draft[key]=input.value;syncScoreboardDOM(c);};
      input.onkeydown=function(ev){
        if(ev.key!=='Enter')return;
        ev.preventDefault();
        var visibleInputs=Array.prototype.slice.call(app.querySelectorAll('[data-set-input]')).filter(function(el){return !el.closest('[hidden]');});
        var idx=visibleInputs.indexOf(input);
        if(idx>=0&&idx+1<visibleInputs.length){visibleInputs[idx+1].focus();visibleInputs[idx+1].select();}
        else{var saveBtn=document.getElementById('save-result-btn');if(saveBtn&&!saveBtn.disabled){saveBtn.click();}}
      };
    });
    app.querySelectorAll('[data-form="scoreboard-match"]').forEach(function(f){f.onsubmit=function(ev){ev.preventDefault();try{saveScoreboardMatch(category(),ensureLoaderDraft(category()));render();var sel=document.getElementById('loader-team-a');if(sel)sel.focus();}catch(error){notice(error.message||'No se pudo guardar el partido.');}};});
    app.querySelectorAll('[data-form="zone"]').forEach(function(f){f.onsubmit=function(ev){ev.preventDefault();run(function(){createZone(new FormData(f).get('name'));},'Zona creada. Ahora agregá sus equipos adentro de la tarjeta.');};});
    app.querySelectorAll('[data-form="quick-zone-team"]').forEach(function(f){f.onsubmit=function(ev){ev.preventDefault();var d=new FormData(f);run(function(){createTeam(d.get('name'),d.get('zoneId'));},'Equipo agregado a la zona.');};});
    app.querySelectorAll('[data-form="assign-team"]').forEach(function(f){f.onsubmit=function(ev){ev.preventDefault();run(function(){var d=new FormData(f);assignTeamToZone(d.get('teamId'),d.get('zoneId'));},'Equipo asignado a la zona.');};});
  }

  modal.onclick=function(e){if(e.target===modal||e.target.closest('[data-action="close"]')){closeModal();return;}var confirmButton=e.target.closest('[data-action="confirm-delete-category"]');if(confirmButton){var c=state.categories.filter(function(x){return x.id===confirmButton.getAttribute('data-id');})[0],name=c?c.name:'Categoría';deleteCategory(confirmButton.getAttribute('data-id'));closeModal();view='home';render();notice(name+' eliminada correctamente.',true);}};
  modal.addEventListener('click',function(e){var button=e.target.closest('[data-action="confirm-zones"]');if(!button)return;try{confirmZones();closeModal();view='positions';render();notice('Primera etapa cerrada: se creó la Zona Única con dos clasificados por zona.',true);}catch(error){button.disabled=false;notice(error.message||'No se pudo confirmar la clasificación.');}});
  modal.onsubmit=function(e){e.preventDefault();var f=e.target;try{var name=new FormData(f).get('name');if(f.getAttribute('data-form')==='modal-category'){createCategory(name);view='zones';}else createTeam(name);closeModal();render();notice('Categoría creada. Paso 1: Creá tu primera zona.',true);var zInput=document.getElementById('new-zone-input');if(zInput)zInput.focus();}catch(error){var input=f.querySelector('input');input.setCustomValidity(error.message);input.reportValidity();input.setCustomValidity('');}};

  state=loadState();theme=state.theme==='dark'?'dark':'light';document.documentElement.setAttribute('data-theme',theme);
  window.PuntajeNewcom={getState:function(){return JSON.parse(JSON.stringify(state));},calculateTeamTotal:calculateTeamTotal,calculateTeamStageTotal:calculateTeamStageTotal,calculateTeamSetStats:function(id,stage){var t=teamById(id);return t?teamSetStats(id,t.categoryId,stage):{for:0,against:0};},createCategory:createCategory,deleteCategory:deleteCategory,createTeam:createTeam,createZone:createZone,renameZone:renameZone,deleteZone:deleteZone,assignTeamToZone:assignTeamToZone,removeTeamFromZone:removeTeamFromZone,confirmZones:confirmZones,addResult:createScoreEntry,addScore:createScoreEntry,addTraditionalResult:createMatchResult,addMatchResult:createMatchResult,addMatchFromSets:createMatchFromSets,updateMatchResult:updateMatchResult,deleteMatchResult:deleteMatchResult,addQuickResults:addQuickScores,deleteScoreEntry:deleteScoreEntry,generateTop16:generateTop16,generateTop8:generateTop8,generateTop4:generateTop4,advanceToSemifinals:advanceToSemifinals,advanceToFinal:advanceToFinal,finishTournament:finishTournament,calculateStandings:standings,calculateClassificationPoints:function(id){var t=teamById(id);return t?teamClassificationPoints(id,t.categoryId):0;},calculateTeamPoints:function(id){var t=teamById(id);return t?calculateTeamTotal(t):0;},loadState:loadState,saveState:saveState};
  render();
}());
