// Browser-native port of the provisional Python atlas calculations.
// No dynamic code execution. This module's exported registry is the only executable family.
export const GRID = Object.freeze([0,-2,-1,1,2]);
export const MODEL_ASSUMPTION='conditionally independent Bernoulli cases with one shared pass probability';
export function number(value,name='value') {
  if(typeof value!=='number'||!Number.isFinite(value))throw new TypeError(`${name} must be a finite number`);
  return value;
}
function object(value,name='value') {
  if(value===null||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw new TypeError(`${name} must be a plain object`);
  return value;
}
function integer(value,name){if(!Number.isSafeInteger(value)||value<0)throw new TypeError(`${name} must be a nonnegative safe integer`);return value;}
export function clone(value){return JSON.parse(canonical(value));}
export function canonical(value){
  if(value===null||typeof value==='boolean'||typeof value==='string')return JSON.stringify(value);
  if(typeof value==='number')return JSON.stringify(number(value));
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  object(value);
  return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
}
function rows(source,target=false){
  object(source);const records=source.transitions;
  if(!Array.isArray(records)||!records.length)throw new TypeError('transitions must be a nonempty list');
  return records.map(row=>{object(row);const result={x:number(row.x,'x'),action:number(row.action,'action')};if(target)result.next_x=number(row.next_x,'next_x');return result;});
}
export function trainingFixture(gain=2,bias=1){
  number(gain);number(bias);
  return {transitions:[-2,-1,0,1,2].map((action,index)=>({x:index*3-4,action,next_x:number(index*3-4+gain*action+bias)}))};
}
export function fit_motion(training,config){
  object(config);const minVariance=number(config.min_variance??1e-12);
  if(minVariance<0)throw new RangeError('min_variance must be nonnegative');
  const data=rows(training,true);if(data.length<2)throw new RangeError('at least two transitions required');
  const n=data.length,meanAction=data.reduce((s,r)=>s+r.action,0)/n,meanDelta=data.reduce((s,r)=>s+(r.next_x-r.x),0)/n;
  const variance=data.reduce((s,r)=>s+(r.action-meanAction)**2,0)/n;
  if(!Number.isFinite(variance)||variance<=minVariance)throw new RangeError('degenerate actions');
  const covariance=data.reduce((s,r)=>s+(r.action-meanAction)*(r.next_x-r.x-meanDelta),0)/n;
  const gain=number(covariance/variance),bias=number(meanDelta-gain*meanAction);
  const training_mse=number(data.reduce((s,r)=>s+(r.next_x-r.x-(gain*r.action+bias))**2,0)/n);
  return {gain,bias,n,training_mse,equation:`delta = ${gain} * action + ${bias}`};
}
export function predict_motion(model,queries){object(model);const gain=number(model.gain),bias=number(model.bias);return {values:rows(queries).map(r=>number(r.x+gain*r.action+bias))};}
export function probe_model(model,spec){
  object(model);object(spec);const tolerance=number(spec.tolerance);if(tolerance<0)throw new RangeError('negative tolerance');
  const gain_matches=Math.abs(number(model.gain)-number(spec.expected_gain))<=tolerance,bias_matches=Math.abs(number(model.bias)-number(spec.expected_bias))<=tolerance;
  return {gain_matches,bias_matches,passed:gain_matches&&bias_matches};
}
export function probe_predictions(predicted,observed){
  object(predicted);object(observed);const tolerance=number(observed.tolerance);
  if(tolerance<0)throw new RangeError('negative tolerance');
  if(!Array.isArray(predicted.values)||!Array.isArray(observed.values)||!predicted.values.length||predicted.values.length!==observed.values.length)throw new TypeError('nonempty equal length values required');
  const errors=predicted.values.map((value,index)=>number(Math.abs(number(value)-number(observed.values[index]))));
  const pass_flags=errors.map(error=>error<=tolerance),passed=pass_flags.filter(Boolean).length;
  return {errors,pass_flags,passed,failed:errors.length-passed,n:errors.length};
}
export function update_beta(prior,evidence){
  object(prior);object(evidence);const alpha=number(prior.alpha),beta=number(prior.beta),success=integer(evidence.passed,'passed'),fail=integer(evidence.failed,'failed'),n=success+fail;
  if(alpha<=0||beta<=0)throw new RangeError('positive prior parameters required');
  if(evidence.n!==undefined&&integer(evidence.n,'n')!==n)throw new RangeError('evidence count mismatch');
  const nextAlpha=number(alpha+success),nextBeta=number(beta+fail),total=number(nextAlpha+nextBeta);
  return {alpha:nextAlpha,beta:nextBeta,mean:nextAlpha/total,n,model_assumption:MODEL_ASSUMPTION};
}
// Both parsers consume the whole input before interpretation, so no hidden branch can bypass validation.
function tokens(expression,boolean=false){
  if(typeof expression!=='string'||expression.length>4096)throw new TypeError('expression must be bounded text');
  const pattern=boolean?/\s*([A-Za-z_][A-Za-z0-9_]*|[()])/y:/\s*([A-Za-z_][A-Za-z0-9_]*|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[+*()\-])/y;
  let position=0;const result=[];
  while(position<expression.length){
    if(/^\s*$/.test(expression.slice(position)))break;
    pattern.lastIndex=position;const match=pattern.exec(expression);
    if(!match)throw new SyntaxError(`unsupported expression syntax at ${position}`);
    result.push(match[1]);position=pattern.lastIndex;
  }
  return result;
}
function arithmeticTree(program){
  object(program);if(Object.keys(program).sort().join(',')!=='bindings,expression')throw new TypeError('program requires exactly expression and bindings');
  object(program.bindings);const names=new Set(['x','action']);
  for(const [name,value]of Object.entries(program.bindings)){
    if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)||names.has(name))throw new TypeError('invalid or reserved binding name');
    number(value);names.add(name);
  }
  const stream=tokens(program.expression);let at=0,depth=0;
  function atom(){
    if(++depth>128)throw new RangeError('expression nesting exceeds 128');
    const token=stream[at++];let node;
    if(token==='('){node=add();if(stream[at++]!==')')throw new SyntaxError('unclosed parentheses');}
    else if(token==='+'||token==='-'){
      const literal=stream[at++];if(!literal||!/^(?:\d|\.)/.test(literal))throw new SyntaxError('signs only allowed on numeric literals');
      node={kind:'number',value:number(Number((token==='-'?'-':'')+literal))};
    }else if(token&&/^(?:\d|\.)/.test(token)){node={kind:'number',value:number(Number(token))};}
    else if(names.has(token)){node={kind:'name',name:token};}
    else throw new SyntaxError(`unknown expression name or token: ${String(token)}`);
    depth--;return node;
  }
  function multiply(){let node=atom();while(stream[at]==='*'){at++;node={kind:'multiply',left:node,right:atom()};}return node;}
  function add(){let node=multiply();while(stream[at]==='+'){at++;node={kind:'add',left:node,right:multiply()};}return node;}
  const root=add();if(at!==stream.length)throw new SyntaxError('trailing expression syntax');return root;
}
function arithmetic(node,names){
  if(node.kind==='number')return node.value;
  if(node.kind==='name')return names[node.name];
  const left=arithmetic(node.left,names),right=arithmetic(node.right,names);
  return number(node.kind==='add'?left+right:left*right);
}
export function canonical_program(program){arithmeticTree(program);return canonical(program);}
export function program_size(program){return new TextEncoder().encode(canonical_program(program)).length;}
// A lossless canonical identity, deliberately not presented as Python's SHA256 identity.
export function program_id(program){return 'json:'+canonical_program(program);}
export function evaluate_program(program,queries){
  const tree=arithmeticTree(program),inputs=rows(queries);
  return {values:inputs.map(row=>number(arithmetic(tree,{...program.bindings,...row}))),program_id:program_id(program),program:clone(program),inputs};
}
export function evaluate_boolean(expression,bindings){
  object(bindings);const stream=tokens(expression,true);let at=0,depth=0;
  function atom(){
    if(++depth>128)throw new RangeError('Boolean nesting exceeds 128');
    const token=stream[at++];let node;
    if(token==='('){node=or();if(stream[at++]!==')')throw new SyntaxError('unclosed Boolean parentheses');}
    else if(token==='True'||token==='False')node={kind:'literal',value:token==='True'};
    else if(Object.hasOwn(bindings,token)&&typeof bindings[token]==='boolean')node={kind:'literal',value:bindings[token]};
    else throw new SyntaxError(`unknown Boolean name or token ${String(token)}`);
    depth--;return node;
  }
  function not(){if(stream[at]==='not'){at++;if(++depth>128)throw new RangeError('Boolean nesting exceeds 128');const result={kind:'not',right:not()};depth--;return result;}return atom();}
  function and(){let node=not();while(stream[at]==='and'){at++;node={kind:'and',left:node,right:not()};}return node;}
  function or(){let node=and();while(stream[at]==='or'){at++;node={kind:'or',left:node,right:and()};}return node;}
  const root=or();if(at!==stream.length)throw new SyntaxError('trailing Boolean syntax');
  function evaluate(node){if(node.kind==='literal')return node.value;if(node.kind==='not')return !evaluate(node.right);return node.kind==='and'?(evaluate(node.left)&&evaluate(node.right)):(evaluate(node.left)||evaluate(node.right));}
  return evaluate(root);
}
export function probe_decision(posterior,policy){
  object(posterior);object(policy);const n=integer(posterior.n,'n'),mean=number(posterior.mean),min_cases=integer(policy.min_cases,'min_cases'),min_mean=number(policy.min_mean);
  if(min_cases<1||mean<0||mean>1||min_mean<0||min_mean>1)throw new RangeError('invalid decision policy');
  const expression=policy.formula??'enough_cases and reliability_ok',checks={enough_cases:n>=min_cases,reliability_ok:mean>=min_mean};
  return {accepted:evaluate_boolean(expression,checks),checks,expression};
}
export function reference_program(model,settings){object(settings);return {expression:'x+gain*action+bias',bindings:{gain:number(model.gain),bias:number(model.bias)}};}
export function reference_context(predicted,specification){
  const tolerance=number(specification.tolerance);if(tolerance<0)throw new RangeError('negative tolerance');
  const transitions=rows(specification);if(transitions.length!==predicted.values.length)throw new RangeError('reference case count mismatch');
  return {values:clone(predicted.values),tolerance,transitions};
}
function literal(value){return String(number(value));}
function affine(includeX,gain,bias){const terms=includeX?['x']:[];if(gain)terms.push(gain===1?'action':literal(gain)+'*action');if(bias)terms.push(literal(bias));return terms.join('+')||'0';}
export function generate_candidates(reference,constraints){
  const reference_size_bytes=program_size(reference),gains=[...new Set([-1,0,1,2,3,reference.bindings.gain])].sort((a,b)=>a-b),biases=[...new Set([-1,0,1,2,reference.bindings.bias])].sort((a,b)=>a-b);
  const expressions=new Set(['x','action',...[-1,0,1,2,3].map(literal)]);
  for(const includeX of [false,true])for(const gain of gains)for(const bias of biases)expressions.add(affine(includeX,gain,bias));
  const programs=[...expressions].map(expression=>({expression,bindings:{}}));
  programs.sort((a,b)=>program_size(a)-program_size(b)||(canonical_program(a)<canonical_program(b)?-1:canonical_program(a)>canonical_program(b)?1:0));
  const considered=[],viable=[],pruned=[];
  for(const program of programs){
    const constraint_failures=[];
    constraints.counterexamples.forEach((ce,index)=>{
      const actual=evaluate_program(program,{transitions:[ce.input]}).values[0];
      if(Math.abs(actual-ce.reference)>ce.tolerance)constraint_failures.push({constraint_index:index,input:clone(ce.input),reference:ce.reference,actual,rejected_program_id:ce.program_id});
    });
    const size_bytes=program_size(program),row={program,program_id:program_id(program),size_bytes,constraint_failures,strictly_smaller:size_bytes<reference_size_bytes};
    considered.push(row);if(constraint_failures.length)pruned.push(row);else if(row.strictly_smaller)viable.push(row);
  }
  return {considered,viable,pruned,constraint_count:constraints.counterexamples.length,reference_size_bytes};
}
export function select_candidate(generated,settings){object(settings);if(!generated.viable.length)throw new RangeError('finite candidate family exhausted');return clone(generated.viable[0].program);}
export function comparison_context(predictions,reference){return {predictions:clone(predictions),reference:clone(reference)};}
export function retain_counterexample(probe,context){
  const predicted=context.predictions,reference=context.reference,index=probe.pass_flags.findIndex(passed=>!passed);
  return index<0?null:{program_id:predicted.program_id,program:clone(predicted.program),case_index:index,input:clone(predicted.inputs[index]),reference:reference.values[index],actual:predicted.values[index],tolerance:reference.tolerance};
}
export function update_constraints(previous,counterexample){return {counterexamples:[...clone(previous.counterexamples),...(counterexample===null?[]:[clone(counterexample)])]};}
export function size_comparison(program,reference){return {program_id:program_id(program),size_bytes:program_size(program),reference_size_bytes:program_size(reference),declared_case_count:GRID.length**2};}
export function accept_candidate(probe,sizes){return {...sizes,accepted:sizes.size_bytes<sizes.reference_size_bytes&&probe.failed===0&&probe.n===(sizes.declared_case_count??GRID.length**2),failed:probe.failed,case_count:probe.n};}
export function calculationRegistry(){return {fit_motion,predict_motion,probe_model,probe_predictions,update_beta,probe_decision,reference_program,reference_context,generate_candidates,select_candidate,evaluate_program,comparison_context,retain_counterexample,update_constraints,size_comparison,accept_candidate};}
