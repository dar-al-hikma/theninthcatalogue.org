/* The Tower place service. Relative classic scripts work from file: and HTTP.
 * Search uses folded one/two-character prefix shards. Clock resolution remains
 * the separately licensed, unchanged Zīj AGPL-3.0 port. See data/manifest.json. */
(function(){
'use strict';
if(window.TowerPlaces)return;
const base=new URL('.',document.currentScript.src),values=new Map(),pending=new Map();
window.__TowerPlacesData=function(kind,value){values.set(kind,value);};
const placesById=new Map(),foldedById=new Map();
let clockReady=null,chosenReasons=null;
const clockRecipes=new WeakMap();
const chosenReasonKeys=Object.freeze([
  'a.chosenWhy.jamaicaAfterFebruary1899',
  'a.chosenWhy.easterAfter1890',
  'a.chosenWhy.romeAfter1886',
  'a.chosenWhy.dayAfterLaw',
  'a.chosenWhy.firstYearWithoutSummerTime',
  'a.chosenWhy.afterOrdinanceMonth',
  'a.chosenWhy.dayAfterGazette',
  'a.chosenWhy.dayAfterOrder'
]);
function chosenReason(why){
  if(!chosenReasons){
    chosenReasons=new Map(chosenReasonKeys.map(key=>{
      const value=window.StandaloneTower.englishText(key);
      if(typeof value!=='string')throw new TypeError('Missing chosen-start string: '+key);
      return [value,key];
    }));
  }
  const key=chosenReasons.get(why);
  if(!key)throw new TypeError('Unmapped chosen-start explanation');
  return text(key);
}
function text(key,args={}){
  const host=window.StandaloneTower;
  const value=host&&host.text(key);if(typeof value!=='string')throw new TypeError('Missing place-service string: '+key);
  if(key==='a.chosenStart'||key==='a.windowStart')args={...args,why:chosenReason(args.why)};
  return value.replace(/\{(\w+)\}/g,(m,k)=>args[k]==null?m:String(['abbreviation','area','country'].includes(k)?host.displayData(args[k]):args[k]));
}
function load(kind,path){
  if(values.has(kind))return Promise.resolve(values.get(kind));
  if(!pending.has(kind))pending.set(kind,new Promise((resolve,reject)=>{
    const script=document.createElement('script');script.src=new URL(path,base).href;
    script.onload=()=>{
      if(kind==='port'&&window.TowerClockPort)resolve(window.TowerClockPort);
      else if(values.has(kind))resolve(values.get(kind));
      else{pending.delete(kind);script.remove();reject(new Error('Missing data block: '+kind));}
    };
    script.onerror=()=>{pending.delete(kind);script.remove();reject(new Error('Place data could not load: '+kind));};
    document.head.append(script);
  }));
  return pending.get(kind);
}
const fileKind=file=>file.replace(/\.js$/,'');
const dataFile=file=>load(fileKind(file),'data/'+file);
const fold=s=>s.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/ß/g,'ss').replace(/ı/g,'i').replace(/ς/g,'σ').replace(/[’‘]/g,"'");
const searchIndex=()=>dataFile('search-index.js');
async function searchShard(index,ordinal){
  const rows=await dataFile(index.searchFiles[ordinal]);
  for(const place of rows)placesById.set(place.id,place);
  return rows;
}
function matchingShards(index,query){
  const chars=Array.from(query),first=chars[0];let ordinals;
  if(index.splitPrefixes.includes(first)){
    if(chars.length===1)ordinals=Object.entries(index.prefixes).filter(([key])=>Array.from(key)[0]===first).map(([,ordinal])=>ordinal);
    else ordinals=[index.prefixes[chars.slice(0,2).join('')]];
  }else ordinals=[index.prefixes[first]];
  return [...new Set(ordinals.filter(ordinal=>ordinal!==undefined))];
}
async function identify(request){
  if(!request||typeof request.id!=='string')return null;
  let place=placesById.get(request.id);
  if(!place){
    const number=Number(request.id);if(!Number.isSafeInteger(number)||number<=0||String(number)!==request.id)return null;
    const index=await searchIndex(),route=await dataFile(index.identityFiles[number%index.identityFiles.length]);
    const ordinal=route[request.id];if(ordinal===undefined)return null;
    await searchShard(index,ordinal);place=placesById.get(request.id);
  }
  return place&&request.lat===place.lat&&request.lon===place.lon&&request.zone===place.zone?place:null;
}
async function prepareClocks(){
  if(!clockReady)clockReady=(async()=>{
    const [index,port]=await Promise.all([dataFile('clock-index.js'),load('port','clock-port.js')]);
    const meta=await dataFile(index.metaFile),data={...meta,zones:{},placeClocks:{}};
    return {index,data,solver:port.create(data,text)};
  })();
  try{return await clockReady;}catch(error){clockReady=null;throw error;}
}
async function clockGroups(clock,place,civil){
  const {index,data}=clock,year=civil&&civil.year;
  // These guards are resolved before any zone/place table by the unchanged port.
  if(Number.isFinite(year)&&(year<-500||year>2200||year<1582||year===1582&&(civil.month<10||civil.month===10&&civil.day<15)))return;
  const row=data.placeZones.find(r=>Number(r.lat)===place.lat&&Number(r.lon)===place.lon);
  const rule=row&&row.rule,derived=place.derivedZone;
  const areaName=rule&&rule.startsWith('area:')?rule.slice(5):Object.keys(data.placeZoneAreas).find(k=>data.placeZoneAreas[k].boundary===derived);
  const zones=new Set(),research=new Set();
  function native(zone){
    if(!zone||zone.startsWith('Etc/')||Object.hasOwn(data.linkedZones,zone)&&year<1970)return;
    const file=index.zoneFiles[zone];if(file)zones.add(file);
  }
  function atPlace(zone){
    if(!zone||zone.startsWith('Etc/')||Object.hasOwn(data.linkedZones,zone)&&year<1970)return;
    const own=index.placeClocks.find(p=>p.lat===place.lat&&p.lon===place.lon&&p.zone===zone&&p.years.includes(year));
    if(own)research.add(own.file);else native(zone);
  }
  if(areaName){
    const area=data.placeZoneAreas[areaName];
    // Area alternatives are evaluated without coordinates in the source port.
    area.clocks.forEach(native);atPlace(derived);atPlace(area.cast||derived);
  }else if(rule!=='unsettled')atPlace(row?row.zone:derived);
  await Promise.all([
    ...[...zones].map(async file=>Object.assign(data.zones,await dataFile(file))),
    ...[...research].map(async file=>Object.assign(data.placeClocks,await dataFile(file)))
  ]);
}
window.TowerPlaces=Object.freeze({
  localizeClock(result){const render=result&&clockRecipes.get(result);return render?render():result;},
  async placeSearch(query,{limit=6}={}){
    query=fold(String(query).trim());if(!query)return [];
    limit=Number.isFinite(limit)?Math.max(0,Math.floor(limit)):6;if(!limit)return [];
    const index=await searchIndex(),groups=await Promise.all(matchingShards(index,query).map(ordinal=>searchShard(index,ordinal)));
    const unique=new Map();for(const rows of groups)for(const p of rows)unique.set(p.id,p);
    const found=[];
    for(const place of unique.values()){
      let names=foldedById.get(place.id);if(!names){names=[fold(place.name),fold(place.asciiName)];foldedById.set(place.id,names);}
      const [name,ascii]=names;if(name.startsWith(query)||ascii.startsWith(query))found.push({place,exact:name===query||ascii===query});
    }
    found.sort((a,b)=>Number(b.exact)-Number(a.exact)||Number(b.place.seat)-Number(a.place.seat)||b.place.population-a.place.population||Number(a.place.id)-Number(b.place.id));
    return found.slice(0,limit).map(r=>({...r.place}));
  },
  async clockAt(request,civil){
    const place=await identify(request);if(!place){const render=()=>({status:'refused',reason:text('a.refuse.identity')}),result=render();clockRecipes.set(result,render);return result;}
    const clock=await prepareClocks();await clockGroups(clock,place,civil);
    const reading={...civil},render=()=>clock.solver.resolve(place,reading),result=render();clockRecipes.set(result,render);return result;
  }
});
})();
