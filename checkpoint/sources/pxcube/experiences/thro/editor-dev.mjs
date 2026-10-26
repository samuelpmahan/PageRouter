// Developer surfaces (the measurement layer, the DTree and its change toasts) are for the people who build thro, not for the people
// who use it. A customer's editor is the card and its controls; ?console or ?debug (or ?dtree, which opens the DTree) brings the rest back.
const params = new URLSearchParams(globalThis.location?.search ?? '');
export const developer = ['console', 'debug', 'dtree'].some(key => params.has(key));
