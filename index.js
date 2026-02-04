// index.js
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { logger } from './log.js';
import { HTTPException } from 'hono/http-exception';
import { compress } from 'hono/compress';
import { timeout } from 'hono/timeout'
import { bodyLimit } from 'hono/body-limit'
import { prettyJSON } from 'hono/pretty-json'

import { Pool } from 'undici';
import { LRUCache } from 'lru-cache';
import dotenv from 'dotenv'

dotenv.config()

const app = new Hono();

// Configuration
const PROTOCOL = process.env.PROXY_PROTOCOL || 'https';
const ORIGIN_SERVER = process.env.PROXY_ORIGIN || 'hono.dev';
const PORT = process.env.PORT || 3000;
const CACHE_TTL = parseInt(process.env.CACHE_TTL || '300', 10);
const CACHE_CLEAR_TOKEN = process.env.CACHE_CLEAR_TOKEN || '123456'
const REQUEST_TIMEOUT = parseInt(process.env.REQUEST_TIMEOUT || '10000', 10);
const MAX_CONNECTIONS = parseInt(process.env.MAX_CONNECTIONS || '100', 10);
const MAX_KEEP_ALIVE_TIMEOUT = parseInt(process.env.MAX_KEEP_ALIVE_TIMEOUT || '60000', 10);

// Cache strategy configuration
const CACHE_STRATEGY = process.env.CACHE_STRATEGY || 'auto'; // 'off', 'force', 'auto'
const CACHE_STATIC_ONLY = process.env.CACHE_STATIC_ONLY === 'true'; // Only cache static resources

// Create connection pool
const originPool = new Pool(`${PROTOCOL}://${ORIGIN_SERVER}`, {
  connections: MAX_CONNECTIONS,
  keepAliveTimeout: MAX_KEEP_ALIVE_TIMEOUT,
});

// Create cache (only if strategy is not 'off')
const cache = CACHE_STRATEGY !== 'off' ? new LRUCache({
  max: 100,
  ttl: CACHE_TTL * 1000,
}) : null;

// Static resource extensions list
const STATIC_EXTENSIONS = [
  'jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'ico',
  'woff', 'woff2', 'ttf', 'eot', 'otf',
  'css', 'js',
  'mp4', 'webm', 'mp3', 'wav', 'ogg',
  'pdf', 'xml', 'json', 'txt', 'csv', 'zip', 'gz', 'tar', 'rar', '7z'
];

// Check if it's a static resource
const isStaticResource = (path, contentType) => {
  if (path) {
    const extension = path.split('.').pop().toLowerCase();
    if (STATIC_EXTENSIONS.includes(extension)) {
      return true;
    }
  }

  if (contentType) {
    const staticMimeTypes = [
      'image/', 'font/', 'application/font-', 'application/x-font-',
      'text/css', 'application/javascript', 'text/javascript',
      'video/', 'audio/', 'application/pdf', 'application/zip',
      'application/x-tar', 'application/x-rar-compressed', 'application/x-7z-compressed',
    ];

    for (const mimeType of staticMimeTypes) {
      if (contentType.includes(mimeType)) {
        return true;
      }
    }
  }

  return false;
};

// Check if response should be cached based on strategy
const shouldCacheResponse = (path, contentType, cacheControl) => {
  if (CACHE_STRATEGY === 'off') {
    return false;
  }

  if (CACHE_STATIC_ONLY && !isStaticResource(path, contentType)) {
    return false;
  }

  if (CACHE_STRATEGY === 'force') {
    return true;
  }

  // Auto strategy: respect Cache-Control headers
  if (CACHE_STRATEGY === 'auto') {
    if (!cacheControl) {
      return true; // No cache control header, allow caching
    }

    const directives = cacheControl.toLowerCase().split(',').map(d => d.trim());

    // Don't cache if explicitly forbidden
    if (directives.includes('no-store') || directives.includes('no-cache')) {
      return false;
    }

    // Don't cache if private (unless we're forcing static caching)
    if (directives.includes('private') && !CACHE_STATIC_ONLY) {
      return false;
    }

    return true;
  }

  return false;
};

// Fixed timing middleware to avoid immutable header issues
const safeTiming = async (c, next) => {
  const start = Date.now();
  await next();
  const end = Date.now();
  const responseTime = end - start;

  // Safely set timing header without causing immutable errors
  try {
    c.res.headers.set('Server-Timing', `total;dur=${responseTime}`);
  } catch (error) {
    // If headers are immutable, create a new response
    if (error.message.includes('immutable')) {
      const newHeaders = new Headers(c.res.headers);
      newHeaders.set('Server-Timing', `total;dur=${responseTime}`);

      c.res = new Response(c.res.body, {
        status: c.res.status,
        statusText: c.res.statusText,
        headers: newHeaders,
      });
    }
  }
};

// Path encoding function
const encodePathSegment = (segment) => encodeURIComponent(segment).replace(/%2F/g, '/');
const encodePath = (path) => {
  if (!path) return '';
  return path.split('/').map(segment => encodePathSegment(segment)).join('/');
};

// html-inject-middleware.js
const htmlInjectMiddleware = () => {
  const INJECTED_HEAD_BEGIN = process.env.INJECTED_HEAD_BEGIN || '';
  const INJECTED_HEAD_END = process.env.INJECTED_HEAD_END || '';
  const INJECTED_BODY_BEGIN = process.env.INJECTED_BODY_BEGIN || '';
  const INJECTED_BODY_END = process.env.INJECTED_BODY_END || '';

  return async (c, next) => {
    await next();

    if (!c.res || c.res.status !== 200) {
      return;
    }

    const contentType = c.res.headers.get('content-type') || '';

    if (!contentType.includes('text/html')) {
      return;
    }

    if (!INJECTED_HEAD_BEGIN && !INJECTED_HEAD_END &&
      !INJECTED_BODY_BEGIN && !INJECTED_BODY_END) {
      return;
    }

    try {
      const response = c.res.clone();
      const html = await response.text();

      let injectedHtml = html;
      let injectionLog = [];

      if (INJECTED_HEAD_BEGIN) {
        injectedHtml = injectedHtml.replace(
          /<head[^>]*>/i,
          (match) => `${match}${INJECTED_HEAD_BEGIN}`
        );
        injectionLog.push('HEAD_BEGIN');
      }

      if (INJECTED_HEAD_END) {
        injectedHtml = injectedHtml.replace(
          /<\/head>/i,
          `${INJECTED_HEAD_END}</head>`
        );
        injectionLog.push('HEAD_END');
      }

      if (INJECTED_BODY_BEGIN) {
        injectedHtml = injectedHtml.replace(
          /<body[^>]*>/i,
          (match) => `${match}${INJECTED_BODY_BEGIN}`
        );
        injectionLog.push('BODY_BEGIN');
      }

      if (INJECTED_BODY_END) {
        injectedHtml = injectedHtml.replace(
          /<\/body>/i,
          `${INJECTED_BODY_END}</body>`
        );
        injectionLog.push('BODY_END');
      }

      const newHeaders = new Headers(c.res.headers);

      if (newHeaders.has('content-length')) {
        newHeaders.delete('content-length');
      }

      newHeaders.set('X-HTML-Injected', 'true');
      newHeaders.set('X-Injection-Points', injectionLog.join(', '));

      c.res = new Response(injectedHtml, {
        status: c.res.status,
        statusText: c.res.statusText,
        headers: newHeaders,
      });

      console.log(`✅ HTML injected at [${injectionLog.join(', ')}]: ${c.req.url}`);

    } catch (error) {
      console.error('HTML injection error:', error);
      return;
    }
  };
};

// Middleware
app.use(safeTiming);
app.use(compress());
app.use(prettyJSON({force:true}))
app.use(htmlInjectMiddleware());
app.use(logger());
app.use(timeout(5000))

// Health check endpoint
app.get('/health', (c) => c.text('OK'));

// Cache management endpoints (only available if cache is enabled)
app.get('/cache/info', (c) => {
  if (CACHE_STRATEGY === 'off') {
    return c.json({
      error: 'Cache is disabled'
    }, 403);
  }

  if (CACHE_CLEAR_TOKEN !== c.req.query('token')) {
    return c.text('Unauthorized', 401);
  }

  const cacheInfo = {
    size: cache.size,
    max: cache.max,
    ttl: cache.ttl,
    calculatedSize: cache.calculatedSize,
    strategy: CACHE_STRATEGY,
    staticOnly: CACHE_STATIC_ONLY,
  };

  return c.json(cacheInfo);
});

app.get('/cache/clear', (c) => {
  if (CACHE_STRATEGY === 'off') {
    return c.json({
      error: 'Cache is disabled'
    }, 403);
  }

  cache.clear();
  return c.json({
    message: 'Cache cleared successfully',
    success: true
  });
});

app.get('/cache/stats', (c) => {
  if (CACHE_STRATEGY === 'off') {
    return c.json({
      error: 'Cache is disabled'
    }, 403);
  }

  const cacheEntries = [];

  for (const [key, value] of cache.entries()) {
    if (key.startsWith('cache:')) {
      cacheEntries.push({
        key: key.replace('cache:', ''),
        contentType: value.contentType,
        cachedAt: new Date(value.cachedAt).toISOString(),
        size: value.body ? value.body.length : 0,
      });
    }
  }

  return c.json({
    total: cacheEntries.length,
    strategy: CACHE_STRATEGY,
    staticOnly: CACHE_STATIC_ONLY,
    entries: cacheEntries.slice(0, 20),
  });
});

// Static resource cache middleware
const staticCacheMiddleware = async (c, next) => {
  // Skip cache if disabled
  if (CACHE_STRATEGY === 'off') {
    console.log(`Cache DISABLED: ${c.req.url}`);
    return next();
  }

  // Skip cache for cache management endpoints
  if (c.req.path.startsWith('/cache/')) {
    return next();
  }

  if (c.req.method !== 'GET') {
    return next();
  }

  const cacheKey = `cache:${c.req.url}`;
  const cached = cache.get(cacheKey);

  if (cached) {
    console.log(`Cache HIT: ${c.req.url} (Content-Type: ${cached.contentType})`);

    const responseHeaders = new Headers(cached.headers);
    responseHeaders.set('X-Cache', 'HIT');
    responseHeaders.set('X-Cache-Key', cacheKey);
    responseHeaders.set('X-Cache-Strategy', CACHE_STRATEGY);

    const response = new Response(cached.body, {
      status: cached.status,
      statusText: cached.statusText,
      headers: responseHeaders,
    });

    return response;
  }

  await next();

  if (c.res && c.res.status === 200) {
    try {
      const response = c.res.clone();
      const contentType = response.headers.get('content-type') || '';
      const cacheControl = response.headers.get('cache-control') || '';
      const path = c.req.path;

      // Check if response should be cached based on strategy
      const shouldCache = shouldCacheResponse(path, contentType, cacheControl);

      if (shouldCache) {
        const body = await response.arrayBuffer();

        cache.set(cacheKey, {
          body: new Uint8Array(body),
          contentType,
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers.entries()),
          cachedAt: Date.now(),
        });

        console.log(`Cached resource: ${c.req.url} (Strategy: ${CACHE_STRATEGY}, Static: ${isStaticResource(path, contentType)})`);

        const newHeaders = new Headers(c.res.headers);
        newHeaders.set('X-Cache', 'MISS (Cached)');
        newHeaders.set('X-Cache-Key', cacheKey);
        newHeaders.set('X-Cache-Strategy', CACHE_STRATEGY);

        // Set appropriate cache headers based on strategy
        if (CACHE_STRATEGY === 'force') {
          newHeaders.set('Cache-Control', `public, max-age=${CACHE_TTL}`);
        } else if (CACHE_STRATEGY === 'auto') {
          if (!cacheControl) {
            newHeaders.set('Cache-Control', `public, max-age=${CACHE_TTL}`);
          }
          // Otherwise keep original cache-control
        }

        c.res = new Response(c.res.body, {
          status: c.res.status,
          statusText: c.res.statusText,
          headers: newHeaders,
        });
      } else {
        const newHeaders = new Headers(c.res.headers);
        newHeaders.set('X-Cache', 'BYPASS');
        newHeaders.set('X-Cache-Strategy', CACHE_STRATEGY);
        newHeaders.set('X-Cache-Reason', CACHE_STRATEGY === 'off' ? 'disabled' :
          CACHE_STATIC_ONLY && !isStaticResource(path, contentType) ? 'non-static' :
          'cache-control-forbidden');

        // Ensure no caching when strategy forbids it
        if (!shouldCache) {
          newHeaders.set('Cache-Control', 'no-cache, no-store, must-revalidate');
        }

        c.res = new Response(c.res.body, {
          status: c.res.status,
          statusText: c.res.statusText,
          headers: newHeaders,
        });

        console.log(`Cache bypass: ${c.req.url} (Reason: ${newHeaders.get('X-Cache-Reason')})`);
      }
    } catch (error) {
      console.error('Error processing cache response:', error);
    }
  }
};

// Request header processing function
const processHeaders = (originalHeaders) => {
  const headers = {};

  for (const [key, value] of originalHeaders.entries()) {
    const lowerKey = key.toLowerCase();

    if (lowerKey === 'host') {
      headers['host'] = ORIGIN_SERVER;
      // } else if (lowerKey === 'accept-encoding') {
      // headers['accept-encoding'] = value;
      // 通过 accept-encoding 会乱码，原因未知
    } else if (!['accept-encoding', 'connection', 'keep-alive', 'content-length'].includes(lowerKey)) {
      headers[key] = value;
    }
  }
  return new Headers(headers);
};

// Process response headers
const processResponseHeaders = (originalHeaders) => {
  const headers = new Headers();

  if (originalHeaders) {
    if (typeof originalHeaders.entries === 'function') {
      for (const [key, value] of originalHeaders.entries()) {
        if (!['content-encoding', 'transfer-encoding', 'content-length'].includes(key.toLowerCase())) {
          headers.set(key, value);
        }
      }
    } else if (typeof originalHeaders === 'object' && !(originalHeaders instanceof Map)) {
      for (const [key, value] of Object.entries(originalHeaders)) {
        const lowerKey = key.toLowerCase();
        if (!['content-encoding', 'transfer-encoding', 'content-length'].includes(lowerKey)) {
          if (Array.isArray(value)) {
            value.forEach(v => headers.append(key, v));
          } else {
            headers.set(key, value);
          }
        }
      }
    } else if (originalHeaders instanceof Map) {
      for (const [key, value] of originalHeaders) {
        if (!['content-encoding', 'transfer-encoding', 'content-length'].includes(key.toLowerCase())) {
          headers.set(key, value);
        }
      }
    }
  }

  return headers;
};

// Fix redirect URL function
const fixRedirectUrl = (location, c) => {
  if (!location) return null;

  const url = new URL(c.req.url)
  const protocol = url.protocol.replace(':', '')
  const host = url.host

  try {
    if (location.startsWith('http://') || location.startsWith('https://')) {
      if (location.includes(ORIGIN_SERVER)) {
        return location.replace(
          `${PROTOCOL}://${ORIGIN_SERVER}`,
          `${protocol}://${host}`
        );
      }
      return location;
    }

    const path = location.startsWith('/') ? location : `/${location}`;
    return `${protocol}://${host}${path}`;
  } catch (error) {
    console.error('Redirect URL fix error:', error, 'Original location:', location);
    return null;
  }
};

// Main proxy logic - GET requests
app.get('*', staticCacheMiddleware, async (c) => {
  if (c.req.path === '/health' || c.req.path.startsWith('/cache/')) {
    return;
  }

  const queryString = c.req.queries() ? `?${new URLSearchParams(c.req.queries()).toString()}` : '';
  const encodedPath = encodePath(c.req.path);
  const targetPath = encodedPath + queryString;

  console.log(`Proxying GET: ${targetPath}`);

  try {
    const headers = processHeaders(c.req.raw.headers);
    const response = await originPool.request({
      path: targetPath,
      method: 'GET',
      headers,
      body: null,
    });
    
    // console.log(response)

    if (response.statusCode >= 300 && response.statusCode < 400) {
      const location = response.headers.location;
      if (location) {
        const fixedLocation = fixRedirectUrl(location, c);
        if (fixedLocation) {
          return Response.redirect(fixedLocation, response.statusCode);
        }
      }
    }

    if (response.statusCode === 304) {
      return new Response(null, {
        status: 304,
        statusText: response.statusMessage,
        headers: processResponseHeaders(response.headers),
      });
    }

    const responseHeaders = processResponseHeaders(response.headers);

    // Set cache headers based on strategy
    const contentType = response.headers['content-type'] || '';
    if (CACHE_STRATEGY === 'force' && isStaticResource(c.req.path, contentType)) {
      responseHeaders.set('Cache-Control', `public, max-age=${CACHE_TTL}`);
    } else if (CACHE_STRATEGY === 'auto') {
      // Keep original cache-control headers
      if (!responseHeaders.get('cache-control') && isStaticResource(c.req.path, contentType)) {
        responseHeaders.set('Cache-Control', `public, max-age=${CACHE_TTL}`);
      }
    } else {
      responseHeaders.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    }

    return new Response(response.body, {
      status: response.statusCode,
      statusText: response.statusMessage,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error('Proxy error:', error);

    if (error.code === 'UND_ERR_SOCKET_TIMEOUT' || error.message.includes('timeout')) {
      throw new HTTPException(504, {
        message: 'Gateway Timeout'
      });
    }

    throw new HTTPException(502, {
      message: 'Bad Gateway'
    });
  }
});

// Handle non-GET requests
app.all('*',
  bodyLimit({
    maxSize: 50 * 1024, // 50kb
    onError: (c) => {
      return c.text('overflow :(', 413)
    },
  }),
  async (c) => {
    if (c.req.method === 'GET') {
      return;
    }

    if (c.req.path === '/health' || c.req.path.startsWith('/cache/')) {
      return;
    }

    const targetPath = encodePath(c.req.path);
    const queryString = c.req.queries() ? `?${new URLSearchParams(c.req.queries()).toString()}` : '';
    const fullPath = targetPath + queryString;

    console.log(`Proxying ${c.req.method}: ${fullPath}`);

    try {
      const headers = processHeaders(c.req.raw.headers);
      let body = null;

      if (c.req.body) {
        body = c.req.raw.body;
      }

      const response = await originPool.request({
        path: fullPath,
        method: c.req.method,
        headers,
        body,
      });

      if (response.statusCode >= 300 && response.statusCode < 400) {
        const location = response.headers.location;
        if (location) {
          const fixedLocation = fixRedirectUrl(location, c);
          if (fixedLocation) {
            return Response.redirect(fixedLocation, response.statusCode);
          }
        }
      }

      if (response.statusCode === 304) {
        return new Response(null, {
          status: 304,
          statusText: response.statusMessage,
          headers: processResponseHeaders(response.headers),
        });
      }

      const responseHeaders = processResponseHeaders(response.headers);
      responseHeaders.set('Cache-Control', 'no-cache, no-store, must-revalidate');

      return new Response(response.body, {
        status: response.statusCode,
        statusText: response.statusMessage,
        headers: responseHeaders,
      });
    } catch (error) {
      console.error('Proxy error:', error);

      if (error.code === 'UND_ERR_SOCKET_TIMEOUT' || error.message.includes('timeout')) {
        throw new HTTPException(504, {
          message: 'Gateway Timeout'
        });
      }

      throw new HTTPException(502, {
        message: 'Bad Gateway'
      });
    }
  });

// Error handling
app.onError((err, c) => {
  console.error('Application error:', err);

  if (err instanceof HTTPException) {
    return c.json({
      error: err.message
    }, err.status);
  }

  return c.json({
    error: 'Internal Server Error'
  }, 500);
});

// Graceful shutdown handling
const cleanup = async () => {
  console.log('Closing connection pool...');
  await originPool.close();
  console.log('Connection pool closed');
  process.exit(0);
};

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

// Start server
serve({
  fetch: app.fetch,
  port: PORT
}, (info) => {
  console.log(`🚀 Mirror server running at http://localhost:${info.port}`);
  console.log(`📡 Mirroring site: ${PROTOCOL}://${ORIGIN_SERVER}/`);
  console.log(`💡 Health check: http://localhost:${info.port}/health`);
  console.log(`⚡ Cache strategy: ${CACHE_STRATEGY}, Static only: ${CACHE_STATIC_ONLY}`);
  console.log(`📦 Cache TTL: ${CACHE_TTL} seconds, Max connections: ${MAX_CONNECTIONS}`);
  console.log(`🔧 Cache management: http://localhost:${info.port}/cache/info?token=${CACHE_CLEAR_TOKEN}`);
});