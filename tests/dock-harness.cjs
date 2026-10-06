'use strict';
// Minimal inert DOM used solely for local dock state tests. No browser engine,
// external scripts, sockets, timers or real OBS calls are run.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
function attrs(text) {
  const result = {};
  for (const m of text.matchAll(/([^\s=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s<>]+)))?/g)) {
    result[m[1]] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return result;
}
function simpleMatch(el, selector) {
  if (selector === '*') return true;
  let s = selector;
  const checked = s.includes(':checked'); s = s.replace(':checked', '');
  if (checked && !el.checked) return false;
  s = s.replace(/:nth-(?:child|of-type)\(\d+\)/g, '');
  for (const m of [...s.matchAll(/\[([^\]=]+)(?:=["']?([^\]"']*)["']?)?\]/g)]) {
    if (!el.hasAttribute(m[1])) return false;
    if (m[2] !== undefined && el.getAttribute(m[1]) !== m[2]) return false;
  }
  s = s.replace(/\[[^\]]*\]/g, '');
  const id = s.match(/#([\w-]+)/); if (id && el.id !== id[1]) return false;
  for (const m of s.matchAll(/\.([\w-]+)/g)) if (!el.classList.contains(m[1])) return false;
  const tag = s.match(/^[\w-]+/); if (tag && el.tagName !== tag[0].toLowerCase()) return false;
  return true;
}
function matches(el, selector) {
  const parts = selector.trim().match(/(?:\[[^\]]*\]|[^\s])+/g) || [];
  if (!parts.length || !simpleMatch(el, parts.pop())) return false;
  let parent = el.parentNode;
  while (parts.length) {
    const wanted = parts.pop();
    while (parent && !simpleMatch(parent, wanted)) parent = parent.parentNode;
    if (!parent) return false;
    parent = parent.parentNode;
  }
  return true;
}
class Element {
  constructor(tag='div', attributes={}) {
    this.tagName = tag.toLowerCase(); this.attributes = {...attributes};
    this.children=[]; this.listeners={}; this.style={setProperty(k,v){this[k]=v;}}; this.parentNode=null;
    this._value=attributes.value || ''; this.checked='checked' in attributes;
    this.selected='selected' in attributes; this.disabled='disabled' in attributes;
    this.dataset={}; this._html=''; this.textContent='';
    for (const [k,v] of Object.entries(attributes)) {
      if (k.startsWith('data-')) this.dataset[k.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=v;
    }
    this.classList={
      contains: c => this.className.split(/\s+/).includes(c),
      add: (...cs) => { this.className=[...new Set([...this.className.split(/\s+/).filter(Boolean),...cs])].join(' '); },
      remove: (...cs) => { this.className=this.className.split(/\s+/).filter(c=>!cs.includes(c)).join(' '); },
      toggle: c => { const had=this.classList.contains(c); had?this.classList.remove(c):this.classList.add(c); return !had; }
    };
  }
  get id(){return this.attributes.id || '';} set id(v){this.attributes.id=v;}
  get className(){return this.attributes.class || '';} set className(v){this.attributes.class=v;}
  get type(){return this.attributes.type || '';} set type(v){this.attributes.type=v;}
  get value(){
    if(this.tagName==='select') { const selected=this.options.find(x=>x.selected); return selected?selected.value:''; }
    return this._value;
  }
  set value(v){
    v=String(v);
    if(this.tagName==='select') { let found=false; for(const o of this.options){o.selected=!found&&o.value===v;if(o.selected)found=true;} }
    else this._value=v;
  }
  get options(){return this.children.filter(x=>x.tagName==='option');}
  get selectedOptions(){return this.options.filter(x=>x.selected);}
  get childElementCount(){return this.children.length;}
  get nextElementSibling(){const ss=this.parentNode?.children || [];return ss[ss.indexOf(this)+1] || null;}
  get innerHTML(){return this._html;}
  set innerHTML(v){this._html=String(v);this.children=[];parseInto(this,this._html);}
  getAttribute(k){if(k==='value')return this.value;return this.attributes[k] ?? null;}
  hasAttribute(k){return k==='value' || k in this.attributes;}
  setAttribute(k,v){this.attributes[k]=String(v);if(k==='value')this.value=v;}
  appendChild(c){
    if(c.tagName==='script') throw new Error('External script injection prohibited by harness');
    c.parentNode=this;this.children.push(c);
    if(this.tagName==='select' && c.tagName==='option') {
      if(c.selected){for(const o of this.options)if(o!==c)o.selected=false;}
      else if(this.options.length===1)c.selected=true;
    }
    return c;
  }
  remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(x=>x!==this);}
  addEventListener(k,fn){(this.listeners[k] ||= []).push(fn);}
  dispatch(k){return this.disabled ? [] : (this.listeners[k] || []).map(fn=>fn.call(this,{target:this,type:k}));}
  querySelectorAll(s){
    const selectors=s.split(',').map(x=>x.trim());const results=[];
    const visit=el=>{for(const c of el.children){if(selectors.some(sel=>matches(c,sel)))results.push(c);visit(c);}};visit(this);return results;
  }
  querySelector(s){return this.querySelectorAll(s)[0] || null;}
}
function parseInto(root, html){
  const stack=[root];
  for(const m of html.matchAll(/<!--[\s\S]*?-->|<\/?[A-Za-z][^>]*>/g)){
    const token=m[0]; if(token.startsWith('<!--'))continue;
    const tag=token.match(/^<\/?([\w-]+)/)[1].toLowerCase();
    if(token.startsWith('</')){let i=stack.length-1;while(i>0 && stack[i].tagName!==tag)i--;if(i>0)stack.length=i;continue;}
    if(tag==='script') continue;
    const el=new Element(tag,attrs(token.slice(tag.length+1,-1)));
    stack.at(-1).appendChild(el);
    if(!/^(input|br|hr|meta|link|img|source|wbr|area|base|embed|param|track)$/.test(tag) && !token.endsWith('/>'))stack.push(el);
  }
}
function dock(path, saved={}) {
  const html=fs.readFileSync(path,'utf8');
  const scriptMatches=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  const scripts=scriptMatches.filter(m=>! /\bsrc\s*=/.test(m[1])).map(m=>m[2]);
  assert.ok(scripts.length);
  const doc = new Element('document'); parseInto(doc,html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''));
  doc.getElementById=id=>doc.querySelector('#'+id);
  doc.createElement=tag=>new Element(tag);
  const local = new Map(Object.entries(saved).map(([k,v])=>[k,typeof v==='string'?v:JSON.stringify(v)]));
  const logs=[]; const timers=[];
  const forbidden=()=>{throw new Error('External operation prohibited by offline harness');};
  const ctx = vm.createContext({
    document:doc, window:{addEventListener(){},crypto:{randomUUID:()=> 'fixture-uuid'}},
    localStorage:{getItem:k=>local.get(k) ?? null,setItem:(k,v)=>local.set(k,String(v))},
    console:{log:(...x)=>logs.push(x.join(' ')),warn:(...x)=>logs.push(x.join(' ')),error:(...x)=>logs.push(x.join(' '))},
    i18next:{isInitialized:true,language:'en',exists:()=>true,t:(key,opts)=>typeof opts==='string'?opts:key,use(){return this;},init(opts,cb){cb(null,this.t);},changeLanguage(lang,cb){this.language=lang;cb(null,this.t);}},
    i18nextHttpBackend:{}, PointerEvent:class PointerEvent{},
    setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length;},clearTimeout(){},setInterval:()=>1,clearInterval(){},
    URL,URLSearchParams,TextEncoder,WebSocket:class ForbiddenSocket{constructor(){forbidden();}},fetch:forbidden,
    alert:forbidden,confirm:forbidden,
  });
  for(const [i,s] of scripts.entries()) new vm.Script(s,{filename:path+':inline-'+i}).runInContext(ctx);
  const run=code=>vm.runInContext(code,ctx);
  const api={ctx,doc,local,logs,timers,run,scripts};
  api.flush = async (n=50)=>{for(let i=0;i<n;i++)await Promise.resolve();};
  api.click = selector=>{const el=doc.querySelector(selector);assert.ok(el,selector+' exists');assert.ok(el.listeners.click?.length,selector+' has shipped click handler');return el.dispatch('click');};
  return api;
}
function installObsDouble(d, {inputs=['VDO_a','VDO_b'], scenes=['Main','Mapped','Highlight'], hold=null}={}) {
  const state={inputs:new Set(inputs),requests:[],sceneItems:new Map(),pending:[],nextId:1};
  for(const scene of scenes) state.sceneItems.set(scene,new Map());
  const notfound=()=>{throw new Error('Resource not found (code 600)');};
  state.execute=(type,data)=>{
    const name=data.inputName;
    switch(type){
      case 'GetInputSettings': if(!state.inputs.has(name))notfound();return {inputSettings:{width:1920,height:1080}};
      case 'SetInputName': if(!state.inputs.has(name))notfound();if(state.inputs.has(data.newInputName))throw new Error('Name exists');state.inputs.delete(name);state.inputs.add(data.newInputName);for(const map of state.sceneItems.values()){if(map.has(name)){map.set(data.newInputName,map.get(name));map.delete(name);}}return {};
      case 'GetSceneList':return {scenes:scenes.map(sceneName=>({sceneName}))};
      case 'GetVideoSettings':return {baseWidth:1920,baseHeight:1080};
      case 'GetStudioModeEnabled':return {studioModeEnabled:false};
      case 'SetCurrentProgramScene':state.program=data.sceneName;return {};
      case 'SetCurrentPreviewScene':state.preview=data.sceneName;return {};
      case 'TriggerStudioModeTransition':state.program=state.preview;return {};
      case 'GetSceneItemId':{const id=state.sceneItems.get(data.sceneName)?.get(data.sourceName);if(id===undefined)notfound();return {sceneItemId:id};}
      case 'CreateInput':if(state.inputs.has(name))throw new Error('Input exists');state.inputs.add(name);state.sceneItems.get(data.sceneName).set(name,state.nextId++);return {};
      case 'CreateSceneItem':{const id=state.nextId++;state.sceneItems.get(data.sceneName).set(data.sourceName,id);return {sceneItemId:id};}
      case 'RemoveSceneItem':{const map=state.sceneItems.get(data.sceneName);for(const [name,id]of map)if(id===data.sceneItemId)map.delete(name);return {};}
      case 'SetInputSettings':if(!state.inputs.has(name))notfound();return {};
      case 'GetInputList':return {inputs:[...state.inputs].map(inputName=>({inputName,inputKind:'browser_source'}))};
      case 'SetSceneItemTransform':case 'SetSceneItemEnabled':return {};
      case 'GetSceneItemList':return {sceneItems:[...(state.sceneItems.get(data.sceneName)||new Map())].map(([sourceName,sceneItemId])=>({sourceName,sceneItemId,sourceType:'OBS_SOURCE_TYPE_INPUT',inputKind:'browser_source'}))};
      default:throw new Error('Unhandled OBS double request '+type);
    }
  };
  d.ctx.__obsDouble=async(type,data={})=>{state.requests.push({type,data:JSON.parse(JSON.stringify(data))});if(hold?.(type,data,state))return new Promise((resolve,reject)=>state.pending.push({type,data,resolve,reject}));return state.execute(type,data);};
  d.run('sendRequest = __obsDouble; obs = {}; obsConnected = true;');
  state.releaseNext=()=>{const item=state.pending.shift();assert.ok(item,'pending request');try{item.resolve(state.execute(item.type,item.data));}catch(e){item.reject(e);}};
  return state;
}
module.exports={dock,installObsDouble,Element};
