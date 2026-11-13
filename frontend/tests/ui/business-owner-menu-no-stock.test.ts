import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Stage 3 decision (2026-11-11): TrackTour keeps no stock quantities.
 * Availability is a manual Yes/No; the menu page must not read, edit,
 * export or import a stock number (old CSVs with a Stock column are skipped).
 */
describe('Business owner menu — no stock quantities', () => {
  const source = readFileSync(resolve(__dirname, '../../src/features/business-owner/pages/BusinessOwnerMenu.tsx'), 'utf-8')

  it('has no stock field, input, mutation or export column', () => {
    expect(source).not.toMatch(/stock:\s*number/)
    expect(source).not.toMatch(/stockValue|setStockValue/)
    expect(source).not.toMatch(/Manage Inventory/)
    expect(source).not.toMatch(/'Stock'/)
    expect(source).not.toMatch(/stock:\s*Math/)
  })

  it('still reads files exported with the old Stock column, ignoring its value', () => {
    expect(source).toMatch(/legacyStockColumn/)
    expect(source).toMatch(/parsed\.slice\(0, 5\), \.\.\.parsed\.slice\(6\)/)
  })
})
