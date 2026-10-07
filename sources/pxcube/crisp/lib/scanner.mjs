export const NAMESPACES = ['px', 'fn', 'oc', 'sc'];

const MOUNT_USE_RE = /\b([A-Za-z_][A-Za-z0-9_-]*)\.(px|fn|oc|sc)\b/g;
const REST_RE = /^[A-Za-z0-9_.-]+/;

function lineNumber(content, index) {
  return content.slice(0, index).split('\n').length;
}

export function findMountUses(files) {
  const uses = [];
  for (const { path, content } of files) {
    MOUNT_USE_RE.lastIndex = 0;
    let match;
    while ((match = MOUNT_USE_RE.exec(content)) !== null) {
      const [mount, namespace] = [match[1], match[2]];
      let rest = '';
      const after = content.slice(match.index + match[0].length);
      if (after.startsWith('.')) {
        const tail = REST_RE.exec(after.slice(1));
        if (tail) rest = tail[0];
      }
      uses.push({ mount, namespace, rest, file: path, line: lineNumber(content, match.index) });
    }
  }
  return uses;
}

const PERSIST_CALL_RE = /\b(persist|save|store|setItem|put|writePart|pxc\.persist)\s*\(/;

function persistedPrefixLine(line, mounts) {
  if (!PERSIST_CALL_RE.test(line)) return null;
  for (const mount of mounts) {
    const re = new RegExp(`(['"\`])(${mount}\\.(px|fn|oc|sc)\\.[A-Za-z0-9_.\\-]+)\\1`);
    const hit = re.exec(line);
    if (hit) {
      return { mount, address: hit[2] };
    }
  }
  return null;
}

// Heuristic lint for the mount contract: persisted Part addresses must be
// {px|fn|oc|sc}.* with the mount prefix NOT persisted. This is a heuristic:
// it flags lines that look like a persist-like call carrying a quoted
// "mount.ns...." string. It can miss dynamic addresses and can flag comments
// next to a persist call, so treat hits as review prompts, not proof.
export function findPersistedMountPrefixes(files, mounts) {
  const hits = [];
  for (const { path, content } of files) {
    const lines = content.split('\n');
    lines.forEach((text, i) => {
      const found = persistedPrefixLine(text, mounts);
      if (found) {
        hits.push({ mount: found.mount, file: path, line: i + 1, snippet: text.trim(), address: found.address });
      }
    });
  }
  return hits;
}
