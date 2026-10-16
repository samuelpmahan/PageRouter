// HTML text escaping for the browser views. src/app.mjs, src/atlas-view.mjs,
// src/block5-view.mjs and src/justin-site-ide.mjs import esc from here.
// src/session-repl.mjs keeps its own identical copy, named escape: that file
// is frozen, since its bytes are part of the evaluator identity.
//
// Control: escape-html 1.0.3 passes its own 30-case suite; esc passes 28, as
// did every copy it replaces. The two differences are kept on purpose: null
// and undefined become '' where escape-html writes 'null' and 'undefined'.
// esc fills slots in HTML templates, where a missing optional field renders
// as nothing. Other values go through String(), not '' + value, so a Symbol
// prints instead of throwing; html.test.mjs pins both.
export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
