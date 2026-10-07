const empty={type:'object',properties:{},additionalProperties:false};
function validateEmpty(input){if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length)throw new TypeError('Expected an empty object.');}
export function registerWebMcp(controller,{navigate},context=document.modelContext) {
  if(!context?.registerTool)return {supported:false};
  const lifecycle=new AbortController();
  const definitions=[
    {name:'read_demo_journey',title:'Read demo journey',description:'Read the currently loaded synthetic TeacherJourney state without running services.',inputSchema:empty,annotations:{readOnlyHint:true,untrustedContentHint:true},execute(input){validateEmpty(input);return structuredClone({journey:controller.state.journey,request:controller.state.request});}},
    {name:'navigate_demo_journey',title:'Navigate demo journey',description:'Open an existing preview route. Public profile navigation reads only fixture data; it creates no record.',inputSchema:{type:'object',properties:{route:{type:'string',enum:['/register','/login','/profile','/teachers','/teachers/demo-avery','/teachers/demo-jordan']}},required:['route'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},async execute(input){if(!input||Object.keys(input).length!==1||!['/register','/login','/profile','/teachers','/teachers/demo-avery','/teachers/demo-jordan'].includes(input.route))throw new TypeError('Expected one supported demo route.');await navigate(input.route);return {route:controller.route.path};}},
    {name:'simulate_demo_approval',title:'Simulate demo approval',description:'Simulate approval of the current pending synthetic teacher. This changes only this tab’s demo record and never logs the teacher in.',inputSchema:empty,annotations:{readOnlyHint:false,untrustedContentHint:false},async execute(input){validateEmpty(input);const result=await controller.dispatch('approve');return {ok:result.ok,outcome:result.outcome,message:result.message};}},
  ];
  for(const definition of definitions)try{Promise.resolve(context.registerTool(definition,{signal:lifecycle.signal})).catch(error=>console.warn('Optional WebMCP registration unavailable',error));}catch(error){console.warn('Optional WebMCP registration unavailable',error);}
  return {supported:true,cleanup:()=>lifecycle.abort(),names:definitions.map(x=>x.name)};
}
