/**
 * GET /api/streetcode — resolution semantics, single-flight, timeout/stale
 * fallback, cache writes, response states, candidate ordering.
 */

import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { fold } from '../services/fold.js';
import type { ParsedConfig } from '../config/parseConfig.js';
import type {
  CityListPayload,
  CitySinglePayload,
  StreetcodeCache,
  StreetListPayload,
  StreetSinglePayload,
} from '../services/cache.js';
import { splitOrtPlz } from '../services/upstream.js';
import type { UpstreamClient, UpstreamResult } from '../services/upstream.js';
import type { RateLimiter } from '../services/rateLimit.js';
import { logInfo } from '../services/logger.js';

// ── Ordering contract: cmp0 on the full display string, strcasecmp on street names ──

function cmpIgnoreCase(a: string, b: string): number {
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  return la < lb ? -1 : la > lb ? 1 : 0;
}

export function sortCityCandidates(candidates: CityListPayload['candidates']): CityListPayload['candidates'] {
  return [...candidates].sort((a, b) => cmpIgnoreCase(`${a.name} (PLZ: ${a.plz})`, `${b.name} (PLZ: ${b.plz})`));
}

export function sortStreetCandidates(candidates: StreetListPayload['candidates']): StreetListPayload['candidates'] {
  return [...candidates].sort((a, b) => cmpIgnoreCase(a.street, b.street));
}

// ── Query schema (TypeBox) ──

export const streetcodeQuerystring = Type.Object({
  city: Type.String({ minLength: 1, maxLength: 100 }),
  street: Type.Optional(Type.String({ maxLength: 100 })),
  ags: Type.Optional(Type.String({ pattern: '^\\d{8}$' })),
});

export type StreetcodeQuery = { city: string; street?: string; ags?: string };

// ── Resolver ──

export interface ResolveOutcome {
  status: number; // 200 | 404 | 502
  body: unknown;
  upstream: number; // URL index used, -1 = answered without upstream
}

export interface ResolverDeps {
  config: ParsedConfig;
  cache: StreetcodeCache;
  upstream: UpstreamClient;
}

interface Resolved {
  result: UpstreamResult;
  urlIndex: number;
}

export function createResolver(deps: ResolverDeps) {
  // single-flight: all upstream calls go through this map;
  // the entry is deleted when the promise settles.
  const flights = new Map<string, Promise<Resolved | { failed: true }>>();

  function singleFlight(
    key: string,
    run: () => Promise<Resolved>,
  ): Promise<Resolved | { failed: true }> {
    const existing = flights.get(key);
    if (existing) return existing;
    const p = run()
      .catch((): { failed: true } => ({ failed: true })) // upstream failures never write cache
      .finally(() => {
        flights.delete(key);
      });
    flights.set(key, p);
    return p;
  }

  // cache writes (only reached on the upstream-success path)
  function writeCityResult(cityRaw: string, result: UpstreamResult): void {
    if (!deps.config.cacheEnabled) return;
    if (result.state === 'single' || result.state === 'street_candidates') {
      const payload: CitySinglePayload = {
        state: 'single',
        city: result.city,
        plateCode: result.plateCode,
        subCode: result.subCode,
        ags: result.ags,
      };
      deps.cache.writeCitySingle(fold(cityRaw), fold(result.city), payload);
    } else if (result.state === 'city_candidates') {
      const payload: CityListPayload = {
        state: 'city_candidates',
        candidates: sortCityCandidates(
          result.candidates.map((c) => {
            const { name, plz } = splitOrtPlz(c.display);
            return { name, plz, kz: c.kz, ags: c.ags };
          }),
        ),
      };
      deps.cache.writeCityList(fold(cityRaw), payload);
    }
  }

  function writeStreetResult(streetRaw: string, result: UpstreamResult): void {
    if (!deps.config.cacheEnabled) return;
    if (result.state === 'single' && result.street) {
      const payload: StreetSinglePayload = {
        state: 'single',
        city: result.city,
        plateCode: result.plateCode,
        subCode: result.subCode,
        ags: result.ags,
        street: result.street.name,
        streetCode: result.street.code,
      };
      deps.cache.writeStreetSingle(result.ags, fold(streetRaw), fold(result.street.name), payload);
    } else if (result.state === 'street_candidates') {
      if (result.candidates.length === 0) return; // city-only lookup — nothing to store for the street
      const payload: StreetListPayload = {
        state: 'street_candidates',
        city: result.city,
        plateCode: result.plateCode,
        subCode: result.subCode,
        ags: result.ags,
        candidates: sortStreetCandidates(result.candidates.map((c) => ({ street: c.name }))),
      };
      deps.cache.writeStreetList(result.ags, fold(streetRaw), payload);
    }
  }

  // response builders — normalized* flags compare the RAW input against the canonical name
  function singleResponse(
    p: { city: string; plateCode: string; subCode: string; ags: string },
    street: { name: string; code: string } | undefined,
    rawCity: string,
    rawStreet: string | undefined,
    stale: boolean,
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      state: 'single',
      city: p.city,
      plateCode: p.plateCode,
      subCode: p.subCode,
      ags: p.ags,
    };
    if (street) {
      body['street'] = street.name;
      body['streetCode'] = street.code;
      body['normalizedStreet'] = street.name !== rawStreet;
    }
    body['normalizedCity'] = p.city !== rawCity;
    if (stale) body['stale'] = true;
    return body;
  }

  function streetCandidatesResponse(
    p: { city: string; plateCode: string; subCode: string; ags: string },
    candidates: { street: string }[],
    stale: boolean,
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      state: 'street_candidates',
      city: p.city,
      plateCode: p.plateCode,
      subCode: p.subCode,
      ags: p.ags,
      candidates: sortStreetCandidates(candidates),
    };
    if (stale) body['stale'] = true;
    return body;
  }

  function cityCandidatesResponse(
    candidates: CityListPayload['candidates'],
    stale: boolean,
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      state: 'city_candidates',
      candidates: sortCityCandidates(candidates).map((c) => ({
        name: c.name,
        plz: c.plz,
        kz: c.kz,
        ags: c.ags,
      })),
    };
    if (stale) body['stale'] = true;
    return body;
  }

  function upstreamResultToResponse(
    result: UpstreamResult,
    rawCity: string,
    rawStreet: string | undefined,
    scopeOnNotFound: 'city' | 'street',
    urlIndex: number,
  ): ResolveOutcome {
    // A city-only lookup (empty street) yields a city-resolved page with no
    // Straße row and no candidate rows — the API answers it as a city-only single.
    const cityOnlySingle =
      result.state === 'street_candidates' && result.candidates.length === 0;
    if (cityOnlySingle) {
      return {
        status: 200,
        body: singleResponse(result, undefined, rawCity, rawStreet, false),
        upstream: urlIndex,
      };
    }
    switch (result.state) {
      case 'single':
        return {
          status: 200,
          body: singleResponse(result, result.street, rawCity, rawStreet, false),
          upstream: urlIndex,
        };
      case 'street_candidates':
        return {
          status: 200,
          body: streetCandidatesResponse(result, result.candidates.map((c) => ({ street: c.name })), false),
          upstream: urlIndex,
        };
      case 'city_candidates':
        return {
          status: 200,
          body: cityCandidatesResponse(
            result.candidates.map((c) => {
              const { name, plz } = splitOrtPlz(c.display);
              return { name, plz, kz: c.kz, ags: c.ags };
            }),
            false,
          ),
          upstream: urlIndex,
        };
      case 'not_found':
        return { status: 404, body: { state: 'not_found', scope: scopeOnNotFound }, upstream: urlIndex };
    }
  }

  // stale fallback chains (never write cache)
  function staleChainNoAgs(rawCity: string, rawStreet: string | undefined): ResolveOutcome {
    const cityStale = deps.cache.getCityStale(fold(rawCity));
    if (cityStale && cityStale.response.state === 'single') {
      const cp = cityStale.response;
      if (rawStreet) {
        const streetStale = deps.cache.getStreetStale(cp.ags, fold(rawStreet));
        if (streetStale && streetStale.response.state === 'single') {
          const sp = streetStale.response;
          return {
            status: 200,
            body: singleResponse(sp, { name: sp.street, code: sp.streetCode }, rawCity, rawStreet, true),
            upstream: -1,
          };
        }
      }
      return { status: 200, body: singleResponse(cp, undefined, rawCity, rawStreet, true), upstream: -1 };
    }
    if (cityStale && cityStale.response.state === 'city_candidates') {
      return { status: 200, body: cityCandidatesResponse(cityStale.response.candidates, true), upstream: -1 };
    }
    return { status: 502, body: { state: 'upstream_unavailable' }, upstream: -1 };
  }

  function staleChainAgs(
    ags: string,
    rawCity: string,
    rawStreet: string,
    freshCityPayload: CitySinglePayload | undefined,
  ): ResolveOutcome {
    const streetStale = deps.cache.getStreetStale(ags, fold(rawStreet));
    if (streetStale && streetStale.response.state === 'single') {
      const sp = streetStale.response;
      return {
        status: 200,
        body: singleResponse(sp, { name: sp.street, code: sp.streetCode }, rawCity, rawStreet, true),
        upstream: -1,
      };
    }
    if (freshCityPayload) {
      // partial stale hit: the city was already resolved (fresh cache row), the street is not
      return {
        status: 200,
        body: singleResponse(freshCityPayload, undefined, rawCity, rawStreet, true),
        upstream: -1,
      };
    }
    return { status: 502, body: { state: 'upstream_unavailable' }, upstream: -1 };
  }

  async function resolveStreetcode(city: string, street: string | undefined, ags: string | undefined): Promise<ResolveOutcome> {
    const rawCity = city;
    const rawStreet = street;

    if (ags) {
      // city is considered resolved — street-only resolution via the GET follow-up
      const freshStreet = deps.cache.getStreetFresh(ags, fold(rawStreet ?? ''));
      if (freshStreet) {
        if (freshStreet.response.state === 'single') {
          const sp = freshStreet.response;
          return {
            status: 200,
            body: singleResponse(sp, { name: sp.street, code: sp.streetCode }, rawCity, rawStreet, false),
            upstream: -1,
          };
        }
        return {
          status: 200,
          body: streetCandidatesResponse(freshStreet.response, freshStreet.response.candidates, false),
          upstream: -1,
        };
      }
      const flight = singleFlight(`get:${ags}\u0000${fold(rawStreet ?? '')}`, () =>
        deps.upstream.get(ags, rawStreet ?? ''),
      );
      const resolved = await flight;
      if ('failed' in resolved) {
        return staleChainAgs(ags, rawCity, rawStreet ?? '', undefined);
      }
      writeStreetResult(rawStreet ?? '', resolved.result);
      if (rawCity) writeCityResult(rawCity, resolved.result);
      return upstreamResultToResponse(resolved.result, rawCity, rawStreet, 'street', resolved.urlIndex);
    }

    // no ags — cache first
    const cityFresh = deps.cache.getCityFresh(fold(rawCity));
    if (cityFresh) {
      if (cityFresh.response.state === 'city_candidates') {
        return {
          status: 200,
          body: cityCandidatesResponse(cityFresh.response.candidates, false),
          upstream: -1,
        };
      }
      const cp = cityFresh.response;
      if (!rawStreet) {
        return {
          status: 200,
          body: singleResponse(cp, undefined, rawCity, undefined, false),
          upstream: -1,
        };
      }
      const streetFresh = deps.cache.getStreetFresh(cp.ags, fold(rawStreet));
      if (streetFresh) {
        if (streetFresh.response.state === 'single') {
          const sp = streetFresh.response;
          return {
            status: 200,
            body: singleResponse(sp, { name: sp.street, code: sp.streetCode }, rawCity, rawStreet, false),
            upstream: -1,
          };
        }
        return {
          status: 200,
          body: streetCandidatesResponse(streetFresh.response, streetFresh.response.candidates, false),
          upstream: -1,
        };
      }
      // fresh city, but street not cached → GET follow-up (never re-POST a resolved city)
      const flight = singleFlight(`get:${cp.ags}\u0000${fold(rawStreet)}`, () =>
        deps.upstream.get(cp.ags, rawStreet),
      );
      const resolved = await flight;
      if ('failed' in resolved) {
        return staleChainAgs(cp.ags, rawCity, rawStreet, cp);
      }
      writeStreetResult(rawStreet, resolved.result);
      writeCityResult(rawCity, resolved.result);
      return upstreamResultToResponse(resolved.result, rawCity, rawStreet, 'street', resolved.urlIndex);
    }

    // cold lookup: ONE POST carrying city + street together
    const flight = singleFlight(`post:${fold(rawCity)}\u0000${fold(rawStreet ?? '')}`, () =>
      deps.upstream.post(rawCity, rawStreet ?? ''),
    );
    const resolved = await flight;
    if ('failed' in resolved) {
      return staleChainNoAgs(rawCity, rawStreet);
    }
    writeCityResult(rawCity, resolved.result);
    writeStreetResult(rawStreet ?? '', resolved.result);
    return upstreamResultToResponse(resolved.result, rawCity, rawStreet, 'city', resolved.urlIndex);
  }

  return { resolveStreetcode };
}

export type Resolver = ReturnType<typeof createResolver>;

// ── Fastify route ──

export function registerStreetcodeRoute(
  app: FastifyInstance,
  resolver: Resolver,
  limiter: RateLimiter,
): void {
  app.get('/api/streetcode', {
    schema: { querystring: streetcodeQuerystring },
    preValidation: async (request, reply) => {
      // rate limit runs BEFORE schema validation
      if (!limiter.check(request.ip)) {
        logInfo('streetcode', { state: 'rate_limited', status: 429, durMs: 0, upstream: -1 });
        return reply.code(429).send({ state: 'rate_limited' });
      }
    },
    handler: async (request, reply) => {
      const startedAt = Date.now();
      const { city, street, ags } = request.query as StreetcodeQuery;
      if (!city.trim()) {
        const outcome = {
          status: 400,
          body: { state: 'invalid_request', details: ['city darf nicht leer sein'] },
          upstream: -1,
        };
        logInfo('streetcode', {
          state: 'invalid_request',
          status: outcome.status,
          durMs: Date.now() - startedAt,
          upstream: -1,
        });
        return reply.code(outcome.status).send(outcome.body);
      }
      if (ags && !street?.trim()) {
        const outcome = {
          status: 400,
          body: { state: 'invalid_request', details: ['strasse erforderlich, wenn ags angegeben ist'] },
          upstream: -1,
        };
        logInfo('streetcode', { state: 'invalid_request', status: outcome.status, durMs: Date.now() - startedAt, upstream: -1 });
        return reply.code(outcome.status).send(outcome.body);
      }
      const outcome = await resolver.resolveStreetcode(city, street, ags);
      logInfo('streetcode', {
        state: (outcome.body as { state?: string }).state,
        status: outcome.status,
        durMs: Date.now() - startedAt,
        upstream: outcome.upstream,
      });
      return reply.code(outcome.status).send(outcome.body);
    },
  });
}
