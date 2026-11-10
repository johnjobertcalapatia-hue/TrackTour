import { describe, expect, it } from 'vitest'
import { shouldRetryQuery } from '@/app/providers'

/** Queries retry once, but never a client error that would answer the same. */
const err = (status?: number) => (status ? { response: { status } } : new Error('Network Error'))

describe('shouldRetryQuery', () => {
  it('does not retry 404 / 403 / 422 (same answer again)', () => {
    for (const status of [400, 401, 403, 404, 422]) expect(shouldRetryQuery(0, err(status))).toBe(false)
  })

  it('retries server errors, network errors, timeouts and rate limits once', () => {
    for (const e of [err(500), err(503), err(), err(408), err(429)]) {
      expect(shouldRetryQuery(0, e)).toBe(true)
      expect(shouldRetryQuery(1, e)).toBe(false)
    }
  })
})
