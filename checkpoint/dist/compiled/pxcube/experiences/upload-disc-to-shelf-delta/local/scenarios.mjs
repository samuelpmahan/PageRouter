// Single browser-safe registry shared by the local mount owner and sandbox UI.
export const scenarios=Object.freeze({empty:Object.freeze({id:'empty',count:0}),one:Object.freeze({id:'one',count:1}),normal:Object.freeze({id:'normal',count:50}),tons:Object.freeze({id:'tons',count:250})});
export const scenarioFor=id=>scenarios[id]??null;
export const scenarioAdapters=Object.freeze({
  empty:world=>({...world,px:{...world.px,discs:[],'discs.buzzz':undefined}}),
  one:world=>({...world,px:{...world.px,discs:Array.isArray(world.px?.discs)?world.px.discs.slice(0,1):world.px?.discs}}),
  normal:world=>structuredClone(world),
  tons:world=>({...world,px:{...world.px,discs:Array.isArray(world.px?.discs)?Array.from({length:Math.max(50,world.px.discs.length*25)},(_,i)=>({...world.px.discs[i%world.px.discs.length],scenarioCopy:i+1})):world.px?.discs}}),
});
export const scenarioWorld=(world,id)=>scenarioAdapters[id??'normal']?.(world)??structuredClone(world);
export function fixtureHash(world,id){let hash=2166136261;for(const char of JSON.stringify(scenarioWorld(world,id))){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619);}return(hash>>>0).toString(16).padStart(8,'0');}
