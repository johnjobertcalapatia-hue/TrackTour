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
  payable_type?: 'order' | 'booking' | 'group_order'
  order_id?: number | null
  group_order_id?: number | null
}

export type PayableType = 'order' | 'booking' | 'group_order'

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
