import { expect, it, vi } from 'vitest';
import { createNpmHostRelease } from '../src/adapters/npm-host-release';
import { parseReleaseCache } from '../src/core/host-updates';

it('requests only the fixed public npm URL, without user data or credentials, and validates response metadata', async () => {
 const fetcher = vi.fn(async () => new Response('{"name":"mars-ram","version":"0.1.5"}', { status: 200 }));
 expect(await createNpmHostRelease(fetcher).latest()).toBe('0.1.5');
 expect(fetcher.mock.calls[0]).toEqual(['https://registry.npmjs.org/mars-ram/latest', expect.objectContaining({ method: 'GET', credentials: 'omit', redirect: 'error' })]);
 for (const body of ['{}', 'bad', '{"name":"wrong","version":"0.1.5"}', '{"name":"mars-ram","version":"0.1.5;evil"}', ' '.repeat(65_537)]) {
  expect(await createNpmHostRelease(async () => new Response(body)).latest()).toBeUndefined();
 }
 expect(await createNpmHostRelease(async () => new Response('{}', { status: 500 })).latest()).toBeUndefined();
 expect(await createNpmHostRelease(async () => { throw Error('offline'); }).latest()).toBeUndefined();
});
it('refuses oversized declared bodies and validates persisted cache input', async () => {
 const text = vi.fn();
 expect(await createNpmHostRelease(async () => ({ ok: true, headers: new Headers({ 'content-length': '999999' }), text }) as unknown as Response).latest()).toBeUndefined();
 expect(text).not.toHaveBeenCalled();
 expect(parseReleaseCache('{"version":1,"checkedAt":123,"latest":"0.1.5"}')).toEqual({ checkedAt: 123, latest: '0.1.5' });
 for (const text of ['{}', '{"version":1,"checkedAt":-1}', '{"version":1,"checkedAt":123,"latest":"evil"}', ' '.repeat(1025)]) expect(parseReleaseCache(text)).toBeUndefined();
});
