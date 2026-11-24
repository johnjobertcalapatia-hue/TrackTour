import { post, get } from '@/shared/services/api'

export interface CreateCheckoutResponse {
  payment_number: string
  checkout_url: string
}

export interface PaymentStatusResponse {
  payment_number: string
  status: string
  amount?: number
  method?: string
  paid_at: string | null
  payable_type?: 'order' | 'booking' | 'group_order' | 'ride_penalty'
  order_id?: number | null
  group_order_id?: number | null
}

/** ride_penalty: an owed ₱50 ride cancellation fee, paid on its own (Stage C, 2026-11-18). */
export type PayableType = 'order' | 'booking' | 'group_order' | 'ride_penalty'

/**
 * "Pay online" opens PayMongo with GCash and QR Ph (2026-11-18). QR Ph is
 * scanned with GCash, Maya or most bank apps.
 */
export const ONLINE_PAYMENT_NAME = 'GCash or QR Ph'

const PAID_VIA: Record<string, string> = { gcash: 'GCash', qrph: 'QR Ph', card: 'card', paymaya: 'Maya', grab_pay: 'GrabPay' }

/** The method actually used on PayMongo; payments before QR Ph was added were all GCash. */
export const paidViaName = (paidVia: string | null | undefined, fallback = 'GCash') =>
  (paidVia ? PAID_VIA[paidVia.toLowerCase()] ?? paidVia : fallback)

export async function createCheckoutSession(
  payableType: PayableType,
  payableId: number,
  method: 'gcash' | 'card' = 'gcash',
): Promise<CreateCheckoutResponse> {
  return post<CreateCheckoutResponse>('/payments/create-intent', {
    payable_type: payableType,
    payable_id: payableId,
    method,
  })
}

export async function getPaymentStatus(
  paymentNumber: string,
): Promise<PaymentStatusResponse> {
  return get<PaymentStatusResponse>(`/payments/status/${paymentNumber}`)
}

export async function checkAndConfirmPayment(
  paymentNumber: string,
): Promise<PaymentStatusResponse> {
  return get<PaymentStatusResponse>(`/payments/check/${paymentNumber}`)
}

export async function refundPayment(
  paymentNumber: string,
  amount?: number,
  reason?: string,
): Promise<{ refund_id: string; status: string; amount: number }> {
  return post(`/payments/${paymentNumber}/refund`, {
    ...(amount !== undefined && { amount }),
    ...(reason !== undefined && { reason }),
  })
}
