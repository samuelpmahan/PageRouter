// OnTop operations, not new kernel semantics. Output Parts still get fresh addresses.
export function create({ value = {}, ...fields }                                       ) {
  return Object.freeze({ ...value, ...fields });
}
export function read({ base = {}, own }                          ) {
  return Object.freeze({ ...base, ...own });
}
export function update({ value, patch = {}, remove = [] }                                                ) {
  const next = Object.assign(Array.isArray(value) ? [...value] : { ...value }, patch);
  for (const key of remove) delete next[key];
  return Object.freeze(next);
}
export function destroy({ collection, key }                                                      ) {
  return update({ value: collection, remove: [key] });
}

                                                                                             
                                                                 
                           
// Each yielded boundary has actual output Parts as inputs, not a second execution model.
export async function* runStage(pxc     , stage       ) {
  for (const tick of stage) {
    if (!tick.calculations.length) throw Error('A Tick needs a Calculation.');
    for (const calculation of tick.calculations) await pxc.compose(calculation);
    await pxc.compose({ into: tick.into, calculation: 'fn.tick', inputs:
      Object.fromEntries(tick.calculations.map(step => [step.into, step.into])) });
    yield tick.into;
  }
}
