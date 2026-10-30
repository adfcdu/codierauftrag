/**
 * Fastify bootstrap, static serving, handlers.
 *
 * Boot order (matters): parseConfig FIRST (it applies TZ before any date use)
 * → on errors print all Konfigurationsfehler lines and exit(1) → warnings →
 * frozen /api/config JSON + error page + client index template (read once,
 * for server-side OG rendering) → open SQLite (schema, WAL) + boot purge →
 * register routes/handlers (incl. the OG index routes)/static → purge timer
 * → listen.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Fastify from 'fastify';
import type { FastifyError, FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { parseConfig, formatConfigErrors, formatConfigWarnings } from './config/parseConfig.js';
import type { ConfigError, ConfigWarning, ParsedConfig } from './config/parseConfig.js';
import { StreetcodeCache } from './services/cache.js';
import { createUpstreamClient } from './services/upstream.js';
import type { UpstreamClient } from './services/upstream.js';
import { createRateLimiter } from './services/rateLimit.js';
import { logError, logInfo } from './services/logger.js';
import { createResolver, registerStreetcodeRoute } from './routes/streetcode.js';
import type { Resolver } from './routes/streetcode.js';
import { buildPublicConfig } from './routes/config.js';
import { renderErrorPage } from './errorPage.js';
import { createIndexPageRenderer } from './indexPage.js';
import type { IndexPageRenderer } from './indexPage.js';

export interface AppOptions {
  env?: Record<string, string | undefined>;
  version?: string; // override for tests; default: package.json at cwd
  fetchFn?: typeof fetch; // upstream stub for tests
  now?: () => number;
  clientRoot?: string; // static root; default: <cwd>/client/dist
}

export interface AppHandle {
  config: ParsedConfig;
  warnings: ConfigWarning[];
  resolver: Resolver;
  upstream: UpstreamClient;
  cache: StreetcodeCache;
  close(): Promise<void>;
}

export type CreateAppResult =
  | { ok: false; errors: ConfigError[] }
  | ({ ok: true; app: FastifyInstance } & AppHandle);

function readVersionFromCwd(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export async function createApp(opts: AppOptions = {}): Promise<CreateAppResult> {
  // 1. parseConfig first — the guard sets process.env.TZ before any date use.
  const parsed = parseConfig(opts.env ?? process.env);
  if ('errors' in parsed) {
    return { ok: false, errors: parsed.errors };
  }
  const { config, warnings } = parsed;

  // 3. frozen /api/config JSON + error page (rendered once)
  // + client index template for server-side OG rendering
  const version = opts.version ?? readVersionFromCwd();
  const publicConfigJson = JSON.stringify(buildPublicConfig(config, version));
  const errorPageHtml = renderErrorPage(config);

  const clientRoot = opts.clientRoot ?? join(process.cwd(), 'client/dist');
  const clientIndexHtml = existsSync(join(clientRoot, 'index.html'))
    ? readFileSync(join(clientRoot, 'index.html'), 'utf8')
    : null;
  const indexRenderer: IndexPageRenderer | null = clientIndexHtml !== null
    ? createIndexPageRenderer(config, clientIndexHtml)
    : null;

  // 4. open the SQLite cache (schema if missing, WAL) + boot purge (catch-up)
  const cache = new StreetcodeCache(config.cacheDbPath, {
    enabled: config.cacheEnabled,
    maxAgeDays: config.cacheMaxAgeDays,
    typoDays: config.cacheTypoDays,
    purgeMaxAgeDays: config.cachePurgeMaxAgeDays,
    now: opts.now,
  });
  const purgeResult = cache.purge();
  if (config.cacheEnabled && (purgeResult.city > 0 || purgeResult.street > 0)) {
    logInfo('cache-purge', { city: purgeResult.city, street: purgeResult.street });
  }

  const upstream = createUpstreamClient({
    urls: config.upstreamUrls,
    version,
    fetchFn: opts.fetchFn,
    now: opts.now,
    breakerFailureThreshold: config.breakerFailureThreshold,
    breakerCooldownMs: config.breakerCooldownMs,
  });
  const limiter = createRateLimiter(config.rateLimitPerMinute, opts.now);
  const resolver = createResolver({ config, cache, upstream });

  // 5. register Fastify: routes, error handlers, static serving, rate limiter hook
  // trustProxy: the container sits behind the reverse proxy — request.ip
  // must be the visitor's address for the per-IP rate limiter.
  const app = Fastify({ trustProxy: true, logger: false });

  // security headers on EVERY response, plus static cache-control in the same hook.
  app.addHook('onSend', async (request, reply, payload) => {
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'",
    );
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
    const path = request.url.split('?')[0];
    if (path.startsWith('/assets/')) {
      reply.header('Cache-Control', 'public, max-age=31536000, immutable');
    } else if (!path.startsWith('/api/')) {
      reply.header('Cache-Control', 'no-cache');
    }
    return payload;
  });

  // NB: the notFound/error handlers are registered FIRST — a handler attached
  // AFTER an awaited `app.register(...)` does not apply to routes registered
  // before it (Fastify encapsulation timing).
  app.setNotFoundHandler((request, reply) => {
    if (request.url.split('?')[0].startsWith('/api/')) {
      return reply.code(404).send({ state: 'invalid_request', message: 'Unbekannter API-Pfad' });
    }
    return reply
      .code(404)
      .header('Content-Type', 'text/html; charset=utf-8')
      .send(errorPageHtml);
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const isApi = request.url.split('?')[0].startsWith('/api/');
    if (isApi) {
      if (error.validation) {
        return reply.code(error.statusCode ?? 400).send({
          state: 'invalid_request',
          details: error.validation.map((v: { message?: string }) => v.message ?? ''),
        });
      }
      logError('api-error', { status: 500 });
      return reply.code(500).send({ state: 'internal_error' });
    }
    logError('unhandled-error', { status: 500 });
    return reply
      .code(500)
      .header('Content-Type', 'text/html; charset=utf-8')
      .send(errorPageHtml);
  });

  registerStreetcodeRoute(app, resolver, limiter);

  // Link preview / SPA entry: index.html is rendered server-side (meta
  // placeholders — bots do not execute JS). index:false + globIgnore below
  // keep @fastify/static from registering '/' and '/index.html' itself
  // (static payload is a stream, and the raw template must never leak).
  if (indexRenderer !== null) {
    app.get('/', { config: {} }, async (request, reply) => {
      // SERVER_BASIS_URL '' → derive from the request host. request.hostname
      // honors X-Forwarded-Host (trustProxy), matching the X-Forwarded-Proto
      // handling for the scheme. The derived scheme is always https: the
      // public instance is TLS-terminated at the reverse proxy, and messengers
      // ignore non-HTTPS preview images.
      const baseUrl = config.serverBasisUrl !== ''
        ? config.serverBasisUrl
        : `https://${request.hostname}`;
      reply.header('Content-Type', 'text/html; charset=utf-8');
      return indexRenderer.render(baseUrl);
    });
    app.get('/index.html', { config: {} }, async (_request, reply) => {
      return reply.redirect('/', 301); // canonical entry; template never leaks
    });
  }

  app.get('/api/config', { config: {} }, async (_request, reply) => {
    // frozen bytes; config may change on restart → no-store
    reply.header('Cache-Control', 'no-store');
    reply.header('Content-Type', 'application/json; charset=utf-8');
    return reply.send(publicConfigJson);
  });

  app.get('/healthz', { config: {} }, async (_request, reply) => {
    reply.header('Content-Type', 'text/plain; charset=utf-8');
    return reply.send('ok');
  });

  // static: built client (client/dist)
  if (existsSync(clientRoot)) {
    await app.register(fastifyStatic, {
      root: clientRoot,
      cacheControl: false, // headers set in the onSend hook below
      wildcard: false, // unknown paths → setNotFoundHandler (error page)
      index: false, // '/' is served by the renderer route above
      globIgnore: ['**/index.html'], // no raw '/index.html' route from static
    });
  }

  // 6. purge timer — holds no reference that keeps the process alive.
  // Node's setTimeout clamps delays > 2^31-1 ms (720 h overflows), so the
  // interval is waited out in chunks below the 32-bit limit.
  let purgeStopped = false;
  const purgeIntervalMs = config.cachePurgeIntervalHours * 3_600_000;
  const MAX_TIMEOUT_MS = 2_147_483_000;
  function runPurge(): void {
    const result = cache.purge();
    if (result.city > 0 || result.street > 0) {
      logInfo('cache-purge', { city: result.city, street: result.street });
    }
  }
  function schedulePurge(remainingMs: number): void {
    if (purgeStopped) return;
    const wait = Math.min(remainingMs, MAX_TIMEOUT_MS);
    const timer = setTimeout(() => {
      if (remainingMs > MAX_TIMEOUT_MS) {
        schedulePurge(remainingMs - MAX_TIMEOUT_MS);
        return;
      }
      runPurge();
      schedulePurge(purgeIntervalMs);
    }, wait);
    timer.unref();
  }
  schedulePurge(purgeIntervalMs);

  return {
    ok: true,
    app,
    config,
    warnings,
    resolver,
    upstream,
    cache,
    async close() {
      purgeStopped = true;
      await app.close();
      cache.close();
    },
  };
}

// ── boot entry ──

if (import.meta.main) {
  const handle = await createApp();
  if (!handle.ok) {
    for (const line of formatConfigErrors(handle.errors)) {
      process.stderr.write(line + '\n');
    }
    process.exit(1);
  }
  if (handle.warnings.length > 0) {
    for (const line of formatConfigWarnings(handle.warnings)) {
      process.stderr.write(line + '\n');
    }
  }
  try {
    await handle.app.listen({ port: handle.config.port, host: '0.0.0.0' });
    logInfo('listening', { port: handle.config.port });
  } catch {
    logError('listen-failed', { status: 500 });
    process.exit(1);
  }
}
