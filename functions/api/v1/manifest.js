export async function onRequestGet({ env }) {
  const obj = await env.DATA_BUCKET.get('v1/manifest.json');
  if (!obj) return new Response('Not found', { status: 404 });
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=3600',
    'Access-Control-Allow-Origin': '*',
  };
  if (obj.httpMetadata?.contentEncoding) {
    headers['Content-Encoding'] = obj.httpMetadata.contentEncoding;
  }
  return new Response(obj.body, { headers });
}
