// One call makes a tracked link: createTrackedLink({ destination, label, card })
// resolves to { code, link, numbers } or throws an Error whose message a creator can read.

export async function createTrackedLink({ destination, label, card } = {}, fetchImpl = fetch) {
  if (typeof destination !== 'string' || !destination.trim()) {
    throw new Error('Paste the link you want people to land on (it starts with https://).');
  }
  let response;
  try {
    response = await fetchImpl('/api/links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ destination: destination.trim(), label, card }),
    });
  } catch {
    throw new Error('Could not reach thro to make the link. Check your connection and try again.');
  }
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const reason = body?.message || `thro answered ${response.status}.`;
    const error = new Error(`The link was not made: ${reason}`);
    error.status = response.status;
    error.code = body?.error || null;
    throw error;
  }
  if (!body?.code || !body?.link) throw new Error('thro made the link but its answer was incomplete. Try again.');
  return body;
}
