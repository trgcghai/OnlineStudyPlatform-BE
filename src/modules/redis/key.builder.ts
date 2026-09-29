import { createHash } from 'crypto';
import { CACHE_KEY_PREFIX } from './redis.constants';

type QueryValue = string | number | boolean | null | undefined | QueryValue[];

type BuildKeyInput = {
  namespace: string;
  version: string;
  scope: string;
  method: string;
  routePath: string;
  params: Record<string, unknown>;
  query: Record<string, QueryValue>;
};

export function normalizeQuery(
  query: Record<string, QueryValue>,
): Record<string, Exclude<QueryValue, undefined>> {
  return Object.keys(query)
    .sort()
    .reduce<Record<string, Exclude<QueryValue, undefined>>>(
      (normalized, key) => {
        const value = query[key];
        if (value !== undefined) {
          normalized[key] = value;
        }
        return normalized;
      },
      {},
    );
}

export function buildKey(input: BuildKeyInput): string {
  const requestPayload = {
    method: input.method.toUpperCase(),
    routePath: input.routePath,
    params: input.params,
    query: normalizeQuery(input.query),
  };
  const requestHash = createHash('sha256')
    .update(JSON.stringify(requestPayload))
    .digest('hex');

  return [
    CACHE_KEY_PREFIX,
    input.namespace,
    input.version,
    input.scope,
    requestHash,
  ].join(':');
}
