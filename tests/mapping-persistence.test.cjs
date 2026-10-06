'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {dock,installObsDouble}=require('./dock-harness.cjs');
const root=process.env.DOCK_SOURCE_DIR || path.join(__dirname,'..');
const settings={obsSceneName:'Main',highlightScene:'Highlight',screenShareScene:'Mapped',selectedOtherScenes:['Highlight'],selectedSourceCreationScenes:['Main','Highlight'],cameraPrefix:'VDO',reactionSubPrefix:'Screen',highlightSubPrefix:'Highlight',sourceSizing:'defaultSize'};
const first={streamId:'a',label:'Alice',matchType:'streamId',sceneName:'Mapped',cloneToMain:false,switchToScene:true};
const second={streamId:'b',label:'Bob',matchType:'label',sceneName:'Highlight',cloneToMain:true,switchToScene:false};
const normalize=rows=>JSON.parse(JSON.stringify(rows)).map(({id,...r})=>r);
function start(file,saved={obsNinjaSettings:settings,obsNinjaStreamMappings:[first,second]}){const d=dock(path.join(root,file),saved);d.doc.dispatch('DOMContentLoaded');return d;}
function stored(d){return normalize(JSON.parse(d.local.get('obsNinjaStreamMappings')||'[]'));}
function routes(d){return normalize(d.run('getStreamMappings()'));}
function change(el,value,property='value'){el[property]=value;assert.ok(el.listeners.change?.length,'shipped change handler');return el.dispatch('change');}
async function fetchScenes(file,d,scenes=['Main','Mapped','Highlight']){const s=installObsDouble(d,{scenes});await Promise.all(d.click(file==='obs.html'?'#loadScenesBtn':'#loadSourceCreationScenesBtn'));return s;}
for(const file of ['obs.html','obs2.html']){
 test(file+': routing preserves matching precedence and fallback after deferred restore',async()=>{
  const cases=[
   ['streamId','a','Else','Mapped'],['streamId','a2','Alice','Main'],
   ['label','other','Alice','Mapped'],['label','a','alice','Main'],
   ['both','a','Alice','Mapped'],['both','a','Else','Main'],
   ['either','a','Else','Mapped'],['either','other','Alice','Mapped'],['either','other','Else','Main']
  ];
  for(const [matchType,id,label,expected] of cases){
   const d=start(file,{obsNinjaSettings:settings,obsNinjaStreamMappings:[{...first,matchType}]});
   await fetchScenes(file,d);assert.equal(d.run(`getTargetSceneForStream(${JSON.stringify(id)},${JSON.stringify(label)}).scene`),expected);
  }
  const d=start(file,{obsNinjaSettings:settings,obsNinjaStreamMappings:[first,{...first,sceneName:'Highlight'}]});
  await fetchScenes(file,d);assert.equal(d.run('getTargetSceneForStream("a","Alice").scene'),'Mapped','first match wins');
 });
 test(file+': mapping saves and two reloads retain distinct targets and flags',async()=>{
  let d=start(file);
  for(let i=0;i<2;i++){
   change(d.doc.getElementById('autoRemoveSources'),false,'checked');
   change(d.doc.querySelectorAll('.stream-mapping')[0].querySelector('.mapping-label'),'Updated Alice');
   assert.deepEqual(stored(d),[{...first,label:'Updated Alice'},second]);
   d=start(file,Object.fromEntries(d.local));
  }
  await fetchScenes(file,d);assert.deepEqual(routes(d),[{...first,label:'Updated Alice'},second]);
 });
 test(file+': disconnected mapping label and matching flags remain editable',async()=>{
  const d=start(file);const row=d.doc.querySelectorAll('.stream-mapping')[0];
  change(row.querySelector('.mapping-label'),'Updated');change(row.querySelector('.mapping-match-type'),'both');
  change(row.querySelector('.mapping-clone-to-main'),true,'checked');change(row.querySelector('.mapping-switch-to-scene'),false,'checked');
  const expected={...first,label:'Updated',matchType:'both',cloneToMain:true,switchToScene:false};
  assert.deepEqual(stored(d),[expected,second]);await fetchScenes(file,d);assert.deepEqual(routes(d),[expected,second]);
 });
 test(file+': removing first deferred mapping does not move its target onto second',async()=>{
  const d=start(file);await Promise.all(d.click('.stream-mapping .remove-mapping-btn'));
  assert.deepEqual(stored(d),[second]);await fetchScenes(file,d);assert.deepEqual(routes(d),[second]);
 });
 test(file+': new incomplete mapping row does not inherit any stored target',async()=>{
  const d=start(file);d.click('#addStreamMappingBtn');
  const added=d.doc.querySelectorAll('.stream-mapping').at(-1);
  change(added.querySelector('.mapping-stream-id'),'new');assert.equal(added.querySelector('.mapping-scene-name').value,'');
  await fetchScenes(file,d);assert.equal(added.querySelector('.mapping-scene-name').value,'');assert.deepEqual(routes(d),[first,second]);
 });
 test(file+': clearing target before discovery remains cleared on fetch and reload',async()=>{
  const d=start(file);change(d.doc.querySelector('.mapping-scene-name'),'');
  assert.deepEqual(stored(d),[second]);await fetchScenes(file,d);assert.equal(d.doc.querySelector('.mapping-scene-name').value,'');
  assert.deepEqual(routes(d),[second]);const reloaded=start(file,Object.fromEntries(d.local));await fetchScenes(file,reloaded);assert.deepEqual(routes(reloaded),[second]);
 });
 test(file+': intentional target clear after discovery remains cleared on refresh',async()=>{
  const d=start(file);await fetchScenes(file,d);change(d.doc.querySelector('.mapping-scene-name'),'');
  await fetchScenes(file,d);assert.equal(d.doc.querySelector('.mapping-scene-name').value,'');assert.deepEqual(routes(d),[second]);
 });
 test(file+': missing discovered scene is cleared rather than fabricated',async()=>{
  const d=start(file);await fetchScenes(file,d,['Main','Highlight']);
  assert.equal(d.doc.querySelector('.mapping-scene-name').value,'');assert.deepEqual(routes(d),[second]);
  change(d.doc.getElementById('autoAddSources'),false,'checked');assert.deepEqual(stored(d),[second]);
 });
 test(file+': successful empty scene discovery permits empty mapping saves',async()=>{
  const d=start(file);await fetchScenes(file,d,[]);change(d.doc.getElementById('autoAddSources'),false,'checked');
  assert.deepEqual(stored(d),[]);
 });
 test(file+': failed first scene discovery preserves deferred mappings through save and retry',async()=>{
  const d=start(file);installObsDouble(d);d.run('sendRequest = async function(){throw new Error("fixture unavailable");};');
  await d.run('fetchObsScenes()');change(d.doc.getElementById('autoAddSources'),false,'checked');assert.deepEqual(stored(d),[first,second]);
  await fetchScenes(file,d);assert.deepEqual(routes(d),[first,second]);
 });
 test(file+': failed refresh preserves current mapping target',async()=>{
  const d=start(file);await fetchScenes(file,d);change(d.doc.querySelector('.mapping-scene-name'),'Main');
  d.run('sendRequest = async function(){throw new Error("fixture unavailable");};');await d.run('fetchObsScenes()');
  change(d.doc.getElementById('autoAddSources'),false,'checked');assert.deepEqual(stored(d),[{...first,sceneName:'Main'},second]);
  await fetchScenes(file,d);assert.deepEqual(routes(d),[{...first,sceneName:'Main'},second]);
 });
 test(file+': disconnect then unrelated edit preserves current routing',async()=>{
  const d=start(file);await fetchScenes(file,d);change(d.doc.querySelector('.mapping-scene-name'),'Highlight');
  d.run('onObsDisconnected()');change(d.doc.getElementById('autoAddSources'),false,'checked');assert.deepEqual(stored(d),[{...first,sceneName:'Highlight'},second]);
  await fetchScenes(file,d);assert.deepEqual(routes(d),[{...first,sceneName:'Highlight'},second]);
 });
 test(file+': shipped Add to OBS button uses saved mapped target after unrelated startup save',async()=>{
  const d=start(file);change(d.doc.getElementById('autoAddSources'),false,'checked');
  await fetchScenes(file,d);const state=installObsDouble(d,{inputs:[]});
  d.run('activeStreams = {a:{label:"Alice",sourceCreated:false}};updateStreamList();');
  d.click('.add-stream-btn[data-stream-id="a"]');await d.flush(300);
  assert.equal(state.requests.find(r=>r.type==='CreateInput')?.data.sceneName,'Mapped');
  assert.equal(d.run('activeStreams.a.sourceCreated'),true);
  assert.equal(state.program,'Mapped','saved switchToScene flag reaches the local OBS request double');
 });
 test(file+': first startup without saved configuration does not invent mappings',async()=>{
  const d=start(file,{});change(d.doc.getElementById('autoAddSources'),false,'checked');assert.deepEqual(stored(d),[]);
  await fetchScenes(file,d);assert.deepEqual(routes(d),[]);
 });
}
