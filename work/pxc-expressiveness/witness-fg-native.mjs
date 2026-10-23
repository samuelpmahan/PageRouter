// WitnessFG adapter over the actual HH PxC Part/PxC composition machinery.
// This does not alter the pinned vendor kernel or claim universal FG semantics.
import {Part, PxC} from '../../checkpoint/vendor/hh/services/pxc.mjs';

const derivation = ['and', ['or', ['and', 'a', 'b'], 'c'], 'd'];
function evaluate(expr, values, plus, times, zero, one) {
  if (typeof expr === 'string') return values[expr] ?? zero;
  const [op, ...children] = expr;
  if (op !== 'and' && op !== 'or') throw new Error('Unknown derivation operation');
  return children.reduce((v, child) => op === 'and'
    ? times(v, evaluate(child, values, plus, times, zero, one))
    : plus(v, evaluate(child, values, plus, times, zero, one)), op === 'and' ? one : zero);
}
const bool = {plus:(a,b)=>a||b,times:(a,b)=>a&&b,zero:false,one:true};
const count = {plus:(a,b)=>a+b,times:(a,b)=>a*b,zero:0,one:1};

export async function runWitnessFG({counterexample=false}={}) {
  const pxc = new PxC();
  const claim = new Part(Object.freeze({
    type:'WitnessFG', claim:'Alternative derivations and semiring reinterpretation',
    scope:'R=(ab+c)d', obligations:['c*d survives loss of a', 'same derivation counts two proofs'],
  }));
  const expression = new Part(derivation);
  const observation = new Part(Object.freeze({a:false,b:true,c:true,d:true}));
  const checker = new Part(({claim, expression, observation}) => {
    const surviving = evaluate(expression, observation, bool.plus, bool.times, bool.zero, bool.one);
    const proofs = evaluate(expression, {a:1,b:1,c:1,d:1}, count.plus, count.times, count.zero, count.one);
    const passed = surviving === true && proofs === 2;
    return Object.freeze({
      type:'WitnessFGEvidence', claim:claim.claim, scope:claim.scope,
      method:'PxC Calculation', obligations:claim.obligations,
      observed:{surviving, proofs}, kind:passed?'supporting':'counterexample',
      verdict:passed?'supported':'challenged',
    });
  });
  pxc.set('claim',claim);pxc.set('expression',expression);pxc.set('observation',observation);pxc.set('checker',checker);
  const first = await pxc.compose({into:'witness/initial',calculation:'checker',inputs:{claim:'claim',expression:'expression',observation:'observation'}});
  if (counterexample) {
    const changed = new Part(Object.freeze({a:false,b:true,c:false,d:true}));
    pxc.set('observation/challenged',changed);
    await pxc.compose({into:'witness/challenged',calculation:'checker',inputs:{claim:'claim',expression:'expression',observation:'observation/challenged'}});
  }
  return {pxc,first,receipts:pxc.receipts()};
}
