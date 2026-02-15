export async function onRequestGet({ params, env }) {
  const segments = params.path;
  if (!segments || segments.length === 0) {
    return new Response('Not found', { status: 404 });
  }

  const key = `v1/${segments.join('/')}`;

  // Basic validation: expect {iso3}/{isic}/{slice}.json pattern
  if (!key.endsWith('.json')) {
    return new Response('Not found', { status: 404 });
  }

  const obj = await env.DATA_BUCKET.get(key);
  if (!obj) return new Response('Not found', { status: 404 });

  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=86400',
    'Access-Control-Allow-Origin': '*',
  };
  if (obj.httpMetadata?.contentEncoding) {
    headers['Content-Encoding'] = obj.httpMetadata.contentEncoding;
  }
  return new Response(obj.body, { headers });
}
