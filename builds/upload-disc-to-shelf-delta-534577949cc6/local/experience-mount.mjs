// Bind a public mount to one owning context; never copy its Part wrappers.
export function localAddress(mount, address) {
  const prefix = `${mount}.`;
  if (typeof address !== 'string' || !address.startsWith(prefix)) throw Error(`Address is outside ${mount}`);
  const inner = address.slice(prefix.length);
  if (!/^(px|fn|oc)\.[A-Za-z0-9_.-]+$/.test(inner)) throw Error(`Address is outside ${mount}'s model`);
  return inner.startsWith('px.') ? `ds.${inner}` : inner;
}

export function scopedStorage(storage, key) {
  let known = storage.getItem(key);
  return Object.freeze({
    getItem: () => known,
    setItem(_ignored, value) {
      if (storage.getItem(key) !== known) throw Error('This sandbox changed in another tab; reload before saving.');
      storage.setItem(key, value); known = value;
    },
  });
}
