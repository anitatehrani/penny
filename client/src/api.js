// Which budget (personal or a shared group) requests are about. Set by the WorkspaceProvider.
let activeWorkspace = null;
export const setActiveWorkspace = (id) => {
  activeWorkspace = id;
};
export const workspaceQuery = () => (activeWorkspace ? `ws=${activeWorkspace}` : '');

async function send(method, url, { body, rawBody, headers = {}, workspace } = {}) {
  const h = { ...headers };
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const ws = workspace ?? activeWorkspace;
  if (ws && !url.startsWith('/auth/')) h['X-Workspace'] = String(ws);
  const res = await fetch(`/api${url}`, {
    method,
    credentials: 'same-origin',
    headers: h,
    body: rawBody ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // A 401 on a data request means the session ended: let the app show the sign-in page.
    if (res.status === 401 && !url.startsWith('/auth/')) window.dispatchEvent(new Event('auth:expired'));
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.problems = data.problems;
    throw err;
  }
  return data;
}

const methods = (workspace) => ({
  get: (url) => send('GET', url, { workspace }),
  post: (url, body) => send('POST', url, { body: body ?? {}, workspace }),
  put: (url, body) => send('PUT', url, { body, workspace }),
  patch: (url, body) => send('PATCH', url, { body, workspace }),
  del: (url, body) => send('DELETE', url, { body, workspace }),
  /** Send a file as the raw request body (profile picture, receipts). */
  upload: (method, url, blob, headers = {}) => send(method, url, { rawBody: blob, headers: { 'Content-Type': blob.type || 'application/octet-stream', ...headers }, workspace }),
});

export const api = {
  ...methods(undefined),
  /** The same calls, but about a specific budget instead of the open one (e.g. from a notification). */
  in: (workspaceId) => methods(workspaceId),
};

export const qs = (params) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== '' && v != null) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};
