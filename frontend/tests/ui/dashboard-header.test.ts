import { describe, expect, it } from 'vitest'
import { formatRange } from '@/features/admin/components/dashboard/DashboardHeader'

describe('dashboard header period wording', () => {
  it('formats compared periods as readable ranges', () => {
    expect(formatRange('2026-11-01', '2026-11-17')).toBe('Nov 1 – 17, 2026')
    expect(formatRange('2026-10-28', '2026-11-03')).toBe('Oct 28 – Nov 3, 2026')
    expect(formatRange('2025-12-30', '2026-01-02')).toBe('Dec 30, 2025 – Jan 2, 2026')
    expect(formatRange('2026-11-17', '2026-11-17')).toBe('Nov 17, 2026')
  })
})
