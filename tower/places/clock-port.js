/* Zīj clock resolution, ported from time_zones.py.
 * Copyright (C) 2026 Dār al-Ḥikma.
 * GNU Affero General Public License, version 3 (AGPL-3.0).
 * Origin: Zij-dev fc813ad8528c91591c5a0c2708c8ef6f2634db42.
 * See data/LICENSE-AGPL-3.0.txt and the exported manifest for the source and data pins.
 */
(function (root) {
'use strict';
function create(data, text) {
  const fail = (kind, extra={}) => { throw {towerClockRefusal:true,kind,...extra}; };
  const cmp = (a,b) => { for(let i=0;i<Math.min(a.length,b.length);i++) if(a[i]!==b[i]) return a[i]<b[i]?-1:1; return 0; };
  const epoch = a => { const d=new Date(0);d.setUTCFullYear(a[0],a[1]-1,a[2]);d.setUTCHours(a[3]||0,a[4]||0,a[5]||0,0);return d.getTime()/1000; };
  const inside = (lat,lon,rings) => rings.some(ring=>{
    let held=false;
    for(let i=0;i<ring.length;i++){
      const a=ring[i],b=ring[(i+1)%ring.length];
      if((a[0]>lat)!==(b[0]>lat) && lon<a[1]+(lat-a[0])*(b[1]-a[1])/(b[0]-a[0])) held=!held;
    }return held;
  });
  const offsets = new Map();
  function recordState(zone, instant) {
    const z=data.zones[zone];if(!z)fail('unknown');
    const list=z.transitions;let lo=0,hi=list.length;
    while(lo<hi){const mid=(lo+hi)>>>1;if(list[mid][0]<=instant)lo=mid+1;else hi=mid;}
    return lo?list[lo-1].slice(1):z.initial;
  }
  function zoneState(zone,reading) {
    const z=data.zones[zone];if(!z)fail('unknown');
    let all=offsets.get(zone);if(!all){all=[...new Set([z.initial[0],...z.transitions.map(r=>r[1])])];offsets.set(zone,all);}
    const local=epoch(reading), holding=[];
    for(const offset of all){const state=recordState(zone,local-offset);if(state[0]===offset)holding.push(state);}
    if(holding.length>1)fail('ambiguous');if(!holding.length)fail('nonexistent');
    return {offset_seconds:holding[0][0],abbreviation:holding[0][1],instant:local-holding[0][0]};
  }
  function meanLabel(abbreviation,keptOn,chosen) {
    let label=text(keptOn?'a.meanSummer':'a.meanCivil',{abbreviation,keptOn});
    if(chosen){const start=Array.isArray(chosen[0])?chosen[0].map((v,i)=>String(v).padStart(i?2:4,'0')).join('-'):chosen[0];label+=text('a.chosenStart',{start,why:chosen[1]});}
    return label;
  }
  function pre1970(zone,reading) {
    const local=epoch(reading),at=(w,offset)=>w.from<=local-offset&&local-offset<w.to;
    for(const stretch of data.pre1970Disputed[zone]||[])if(stretch.offsets.some(o=>at(stretch,o)))fail('disputed');
    const windows=data.pre1970Windows[zone],holding=windows.filter(w=>at(w,w.offset_seconds));
    if(holding.length>1)fail('ambiguous');
    if(holding.length){
      const w=holding[0];if(w.turned_back_from!=null&&local-w.turned_back_from<w.from)fail('ambiguous');
      const state={offset_seconds:w.offset_seconds,abbreviation:w.abbreviation};
      if(w.mean_time||w.chosen){const start=new Date(w.from*1000).toISOString().slice(0,16).replace('T',' ')+' UT';const chosen=w.chosen?[start,w.chosen]:null;
        state.label=w.mean_time?meanLabel(w.abbreviation,null,chosen):text('a.windowStart',{abbreviation:w.abbreviation,start,why:w.chosen});}
      return state;
    }
    for(let i=1;i<windows.length;i++){const a=windows[i-1],b=windows[i];if(a.to===b.from&&local-a.offset_seconds>=a.to&&local-b.offset_seconds<b.from)fail('nonexistent');}
    fail('linked');
  }
  function placeState(place,reading) {
    const local=epoch(reading),at=(w,o)=>w.from<=local-o&&local-o<w.to;
    for(const w of place.intervals)if(w.kind==='disputed'&&((cmp(w.from_local,reading)<=0&&cmp(reading,w.to_local)<0)||(w.offsets||[]).some(o=>at(w,o))))fail('clock_choice',{place:place.name});
    const holding=place.intervals.filter(w=>w.kind==='clock'&&at(w,w.offset_seconds));
    if(holding.length>1)fail('ambiguous',{place:place.name});if(!holding.length)fail('nonexistent',{place:place.name});
    return {offset_seconds:holding[0].offset_seconds,abbreviation:holding[0].abbreviation,place_clock:true};
  }
  function named(zone,reading,lat,lon) {
    if(!zone)fail('unknown');if(zone.startsWith('Etc/'))fail('sea');
    if(Object.hasOwn(data.linkedZones,zone)&&reading[0]<1970){if(data.pre1970Windows[zone])return pre1970(zone,reading);fail('linked');}
    const place=lat==null?null:Object.values(data.placeClocks).find(p=>p.lat===lat&&p.lon===lon&&p.zone===zone&&p.years.includes(reading[0]));
    if(place)return placeState(place,reading);
    const record=data.zoneAliases[zone]||zone,state=zoneState(zone,reading),initial=data.zones[zone].initial;
    const first=state.offset_seconds===initial[0]&&state.abbreviation===initial[1];
    if(state.abbreviation==='LMT'&&(!first||cmp(reading.slice(0,3),data.lmtReturns[record]||[10000,1,1])>=0))fail('later_lmt');
    if(first)fail('before_rules',{abbreviation:state.abbreviation});
    if(lat!=null&&lon!=null){
      for(const [area,country,rings] of data.meanTimeOutside[record]||[]){
        const ranges=(data.outsideStretches[record]||{})[area]||[];
        if(ranges.some(([lo,hi])=>lo<=state.instant&&state.instant<hi)&&inside(lat,lon,rings))fail('outside_clock',{area,country,abbreviation:state.abbreviation});
      }
    }
    const match=(data.namedMeanTimes[data.linkedZones[record]||record]||[]).find(r=>r[0]===state.abbreviation&&r[1]===state.offset_seconds);
    if(match){
      const keptOn=match[2],date=reading.slice(0,3),start=Object.hasOwn(data.civilMeanTimes,record)?data.civilMeanTimes[record]:false;let city=null;
      if(lat!=null&&lon!=null){
        for(const [area,until,rings] of data.meanTimeExceptions[record]||[])if(inside(lat,lon,rings))fail('mean_time_exception',{area,until,abbreviation:state.abbreviation});
        for(const [area,country,rings] of data.meanTimeOutside[record]||[])if(inside(lat,lon,rings))fail('mean_time_outside',{area,country,abbreviation:state.abbreviation});
        for(const [area,since,rings] of data.meanTimeCityDates[record]||[])if(inside(lat,lon,rings)){if(cmp(date,since)<0)fail('mean_time_city',{area,since,abbreviation:state.abbreviation});city=area;break;}
      }
      if(city===null&&(start===false||(start!==null&&cmp(date,start)<0)))fail('mean_time',{abbreviation:state.abbreviation});
      const chosen=city===null&&Object.hasOwn(data.chosenStarts,record)?[start,data.chosenStarts[record]]:null;
      state.label=meanLabel(state.abbreviation,keptOn,chosen);
    }
    return state;
  }
  function placeZone(place,reading) {
    const row=data.placeZones.find(r=>Number(r.lat)===place.lat&&Number(r.lon)===place.lon);
    const rule=row&&row.rule,derived=place.derivedZone;
    const areaName=rule&&rule.startsWith('area:')?rule.slice(5):Object.keys(data.placeZoneAreas).find(k=>data.placeZoneAreas[k].boundary===derived);
    if(areaName){
      const area=data.placeZoneAreas[areaName],cast=area.cast||derived;
      const states=area.clocks.map(z=>{try{return named(z,reading).offset_seconds;}catch(e){if(!e.towerClockRefusal)throw e;return null;}});
      if(states.every(s=>s===null))return derived;
      if(area.unsettled.some(([lo,hi])=>cmp(lo,reading)<=0&&cmp(reading,hi)<0))fail('clock_choice',{area:areaName});
      if(area.cast||(states.every(s=>s!==null)&&states[0]===states[1]))return cast;
      fail('clock_choice',{area:areaName});
    }
    if(rule==='unsettled')fail('unsettled');return row?row.zone:derived;
  }
  function resolve(place,civil) {
    try {
      const reading=[civil.year,civil.month,civil.day,civil.hour,civil.minute,civil.second];
      if(!reading.every(Number.isFinite)||!reading.slice(0,5).every(Number.isInteger)||reading[5]<0||reading[5]>=60)fail('invalid');
      if(reading[0]<-500||reading[0]>2200)fail('range');
      // Python datetime is proleptic Gregorian and has no year zero. Refuse
      // incompatible labels; do not cast a Julian date as Gregorian.
      if(cmp(reading,[1582,10,15,0,0,0])<0)fail('calendar');
      reading[5]=Math.floor(reading[5]);
      const d=new Date(epoch(reading)*1000);
      if([d.getUTCFullYear(),d.getUTCMonth()+1,d.getUTCDate(),d.getUTCHours(),d.getUTCMinutes(),d.getUTCSeconds()].some((v,i)=>v!==reading[i]))fail('invalid');
      const zone=placeZone(place,reading),state=named(zone,reading,place.lat,place.lon);
      if(Math.abs(state.offset_seconds)>50400)fail('range');
      return {status:'ok',offsetSeconds:state.offset_seconds,abbreviation:state.abbreviation,note:state.label||text(state.place_clock?'a.placeClock':'a.zoneClock',{zone})};
    }catch(error){
      if(!error.towerClockRefusal)throw error;
      const key=error.kind==='before_rules'&&error.abbreviation==='-00'?'a.refuse.uninhabited':'a.refuse.'+error.kind;
      return {status:'refused',reason:text(key,error),kind:error.kind};
    }
  }
  return Object.freeze({resolve});
}
root.TowerClockPort=Object.freeze({create});
if(typeof module==='object'&&module.exports)module.exports=root.TowerClockPort;
})(typeof window==='object'?window:globalThis);
