/** Stage D (2026-11-18): the original rider's cancellation compensation — shared types. */

export type CompensationStatus = 'payable' | 'pending_approval' | 'held' | 'reserved' | 'paid' | 'voided' | 'written_off'

export interface Compensation {
  id: number
  penalty_id: number
  rider_id: number
  cancelled_order_id: number
  order_number: string | null
  amount: number
  funding: 'collection' | 'advance'
  status: CompensationStatus
  earned_at: string | null
  advance_reason: string | null
  advance_reference: string | null
  recovered_at: string | null
  voided_at: string | null
  written_off_at: string | null
  resolution_reason: string | null
  // statement rows only
  penalty_status?: string | null
  collection_method?: 'cash' | 'online' | null
  received_at?: string | null
  ledger_earned?: number
  paid_amount?: number
}

export interface CompensationPayout {
  id: number
  payout_number: string
  rider_id: number
  rider_payout_id: number | null
  amount: number
  status: 'pending' | 'under_review' | 'approved' | 'paid' | 'rejected' | 'cancelled' | 'failed'
  requested_at: string | null
  approved_at: string | null
  paid_at: string | null
  payment_reference: string | null
  transferred_total: number | null
  rejection_reason: string | null
  failure_reason: string | null
  items: { compensation_id: number; penalty_id: number | null; order_number: string | null; funding: string | null; amount: number }[]
  validation?: { result: 'pass' | 'block'; checks: { key: string; label: string; ok: boolean; detail: string | null }[]; blocking_message: string | null }
  rider_name?: string | null
  standalone?: boolean
}

export interface EarningsStatement {
  rider: { id: number; name: string | null }
  lines: { ride_earnings: number; delivery_earnings: number; cancellation_compensation: number; adjustments: number }
  cash_kept: number
  total_earned: number
  total_payable_now: number
  payable_now: { earnings: number; cancellation_compensation: number }
  previously_paid: number
  paid: { earnings: number; cancellation_compensation: number }
  remaining_balance: number
  compensations: Compensation[]
}

export const COMPENSATION_STATUS: Record<CompensationStatus, { label: string; tone: string }> = {
  payable: { label: 'Ready to cash out', tone: 'bg-[#DCFCE7] text-[#166534]' },
  pending_approval: { label: 'Advance awaiting approval', tone: 'bg-[#FEF3C7] text-[#92400E]' },
  held: { label: 'On hold (dispute)', tone: 'bg-[#FEF3C7] text-[#92400E]' },
  reserved: { label: 'In a cashout request', tone: 'bg-[#DBEAFE] text-[#1D4ED8]' },
  paid: { label: 'Paid', tone: 'bg-[#E6F2EB] text-[#1E6B40]' },
  voided: { label: 'Voided', tone: 'bg-[#F3F4F6] text-[#4B5563]' },
  written_off: { label: 'Written off (you keep it)', tone: 'bg-[#F3F4F6] text-[#4B5563]' },
}
