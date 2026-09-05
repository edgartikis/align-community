export const json = (body, status = 200, headers = {}) => Response.json(body, {
  status,
  headers: { 'cache-control': 'no-store', ...headers },
});

export const requirePost = request => {
  if (request.method !== 'POST') throw Object.assign(new Error('Método no permitido.'), { status: 405 });
};

export const sameOriginOnly = request => {
  const origin = request.headers.get('origin');
  if (!origin) return;
  const ownOrigin = new URL(request.url).origin;
  if (origin !== ownOrigin) throw Object.assign(new Error('Origen no permitido.'), { status: 403 });
};

export const cleanEmail = value => String(value || '').trim().toLowerCase();
export const cleanPhone = value => String(value || '').replace(/[^0-9+]/g, '').slice(0, 20);
export const cleanText = (value, max = 120) => String(value || '').trim().replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max);

export const isoFromUnix = value => {
  const seconds = Number(value || 0);
  return seconds > 0 ? new Date(seconds * 1000).toISOString() : null;
};
