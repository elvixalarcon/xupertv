import { Capacitor, CapacitorHttp } from '@capacitor/core';

function isAbsoluteUrl(url) {
  return /^https?:\/\//i.test(url);
}

function shouldUseNativeHttp(url) {
  return Capacitor.isNativePlatform() && isAbsoluteUrl(url);
}

function decodeBinary(data) {
  if (data instanceof Uint8Array) return data;
  if (Array.isArray(data)) return new Uint8Array(data);
  if (typeof data === 'string') {
    const bin = atob(data);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(0);
}

function toFetchResponse(nativeRes, responseType = 'text') {
  const status = nativeRes.status ?? 0;
  const ok = status >= 200 && status < 300;
  let body = nativeRes.data;

  if (responseType === 'json') {
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { body = null; }
    }
  } else if (responseType === 'blob' || responseType === 'arraybuffer') {
    body = decodeBinary(body);
  }

  return {
    ok,
    status,
    json: async () => {
      if (typeof body === 'object' && body !== null && !(body instanceof Uint8Array)) return body;
      if (typeof body === 'string') return JSON.parse(body);
      return null;
    },
    text: async () => {
      if (typeof body === 'string') return body;
      if (body instanceof Uint8Array) return new TextDecoder().decode(body);
      return JSON.stringify(body ?? '');
    },
    blob: async () => {
      const bytes = body instanceof Uint8Array ? body : decodeBinary(body);
      return new Blob([bytes]);
    },
  };
}

export async function httpFetch(url, options = {}) {
  const responseType = options.responseType || 'text';
  if (!shouldUseNativeHttp(url)) {
    return fetch(url, options);
  }

  const method = (options.method || 'GET').toUpperCase();
  const headers = { ...(options.headers || {}) };
  const timeout = options.timeout ?? 60000;
  const params = {
    url,
    headers,
    connectTimeout: timeout,
    readTimeout: Math.max(timeout, 120000),
    responseType: responseType === 'blob' ? 'arraybuffer' : responseType,
  };

  let data = options.body;
  if (typeof data === 'string' && headers['Content-Type']?.includes('json')) {
    try { data = JSON.parse(data); } catch { /* keep */ }
  }

  const res = method === 'GET'
    ? await CapacitorHttp.get(params)
    : await CapacitorHttp.request({ ...params, method, data });

  return toFetchResponse(res, responseType);
}

export async function httpGetBlob(url, timeout = 180000, headers = {}) {
  const res = await httpFetch(url, { responseType: 'blob', timeout, headers });
  if (!res.ok) throw new Error(`Error al descargar (${res.status})`);
  return res.blob();
}
