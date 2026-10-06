<?php

namespace App\Http\Controllers\Api;

use App\Events\PaymentReceived;
use App\Http\Controllers\Controller;
use App\Models\Booking;
use App\Models\Business;
use App\Models\Delivery;
use App\Models\GroupCheckout;
use App\Models\Order;
use App\Models\Payment;
use App\Models\PaymentWebhookEvent;
use App\Services\GroupOrderService;
use App\Services\NearestRiderService;
use App\Services\PaymentRefundProcessor;
use App\Services\PaymongoService;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

class PaymentController extends Controller
{
    public function __construct(
        protected PaymongoService $paymongo,
    ) {}

    /**
     * Create a PayMongo Checkout Session for the given order or booking.
     *
     * Returns checkout_url for the frontend to redirect the user to PayMongo's hosted checkout.
     */
    public function createIntent(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'payable_type' => 'required|in:order,booking,group_order',
            'payable_id' => 'required|integer',
            'method' => 'required|in:gcash,card',
        ]);

        $user = Auth::user();
        $payableType = $validated['payable_type'];
        $payableId = $validated['payable_id'];

        if ($payableType === 'order') {
            $order = Order::where('id', $payableId)
                ->where(function ($q) use ($user) {
                    $q->where('user_id', $user->id)
                      ->orWhereNull('user_id');
                })
                ->firstOrFail();
            $amount = (int) round($order->total * 100);
            $description = 'Track-Tour Order #'.$order->order_number;
            $referenceNumber = $order->order_number;

            if ($order->order_type === 'transport') {
                // A ride has a single fare component: subtotal === total === fare.
                $lineItems = [
                    [
                        'name' => 'Ride Fare',
                        'amount' => $amount,
                        'currency' => 'PHP',
                        'quantity' => 1,
                    ],
                ];

                // A cancelled ride owes nothing: never open a new checkout.
                if ($order->status === 'cancelled') {
                    return $this->errorResponse('This ride was cancelled and can no longer be paid.', 422);
                }
            } else {
                $lineItems = [
                    [
                        'name' => 'Food Subtotal',
                        'amount' => (int) round($order->subtotal * 100),
                        'currency' => 'PHP',
                        'quantity' => 1,
                    ],
                ];
                if ((float) $order->delivery_fee > 0) {
                    $lineItems[] = [
                        'name' => 'Delivery Fee',
                        'amount' => (int) round($order->delivery_fee * 100),
                        'currency' => 'PHP',
                        'quantity' => 1,
                    ];
                }
                if ((float) $order->rider_tip > 0) {
                    $lineItems[] = [
                        'name' => 'Rider Tip',
                        'amount' => (int) round($order->rider_tip * 100),
                        'currency' => 'PHP',
                        'quantity' => 1,
                    ];
                }
            }
            $existing = Payment::where('payable_type', Order::class)
                ->where('payable_id', $order->id)
                ->where('status', 'paid')
                ->first();
            if ($existing) {
                return $this->errorResponse('This order has already been paid.', 422);
            }
        } elseif ($payableType === 'group_order') {
            $group = GroupCheckout::where('id', $payableId)
                ->where(function ($q) use ($user) {
                    $q->where('user_id', $user->id)
                      ->orWhereNull('user_id');
                })
                ->firstOrFail();
            $amount = (int) round($group->grand_total * 100);
            $description = 'Track-Tour Group Order #'.$group->reference_number;
            $referenceNumber = $group->reference_number;
            $lineItems = [
                [
                    'name' => 'Food Subtotal',
                    'amount' => (int) round($group->subtotal * 100),
                    'currency' => 'PHP',
                    'quantity' => 1,
                ],
            ];
            if ((float) $group->delivery_total > 0) {
                $lineItems[] = [
                    'name' => 'Delivery Fees',
                    'amount' => (int) round($group->delivery_total * 100),
                    'currency' => 'PHP',
                    'quantity' => 1,
                ];
            }
            if ((float) ($group->system_fee_total ?? 0) > 0) {
                $lineItems[] = [
                    'name' => 'System Fees',
                    'amount' => (int) round((float) $group->system_fee_total * 100),
                    'currency' => 'PHP',
                    'quantity' => 1,
                ];
            }
            if ((float) $group->rider_tip > 0) {
                $lineItems[] = [
                    'name' => 'Rider Tips',
                    'amount' => (int) round($group->rider_tip * 100),
                    'currency' => 'PHP',
                    'quantity' => 1,
                ];
            }
            $existing = Payment::where('payable_type', GroupCheckout::class)
                ->where('payable_id', $group->id)
                ->where('status', 'paid')
                ->first();
            if ($existing) {
                return $this->errorResponse('This group order has already been paid.', 422);
            }
        } else {
            $booking = Booking::where('id', $payableId)
                ->where(function ($q) use ($user) {
                    $q->where('user_id', $user->id)
                      ->orWhereNull('user_id');
                })
                ->firstOrFail();
            $amount = (int) round($booking->total_amount * 100);
            $description = 'Track-Tour Booking #'.$booking->booking_number;
            $referenceNumber = $booking->booking_number;
            $existing = Payment::where('payable_type', Booking::class)
                ->where('payable_id', $booking->id)
                ->where('status', 'paid')
                ->first();
            if ($existing) {
                return $this->errorResponse('This booking has already been paid.', 422);
            }
        }

        if (! $this->paymongo->isConfigured()) {
            return $this->errorResponse('Payment gateway is not configured. Please contact support.', 503);
        }

        $paymentNumber = 'PAY-'.Str::upper(Str::random(12));
        $frontendUrl = rtrim(config('app.frontend_url', 'http://localhost:3000'), '/');
        $backendUrl = rtrim(config('app.url', 'http://localhost'), '/');

        $session = $this->paymongo->createCheckoutSession([
            'amount' => $amount,
            'currency' => 'PHP',
            'description' => $description,
            'reference_number' => $referenceNumber,
            'line_items' => in_array($payableType, ['order', 'group_order']) ? $lineItems : null,
            'payment_method_types' => $validated['method'] === 'gcash' ? ['gcash'] : ['card'],
            'success_url' => $frontendUrl.'/payment/callback?payment_number='.$paymentNumber.'&status=success&payable_type='.$payableType.'&payable_id='.$payableId,
            'cancel_url' => $frontendUrl.'/payment/callback?payment_number='.$paymentNumber.'&status=cancelled&payable_type='.$payableType.'&payable_id='.$payableId,
            'metadata' => [
                'payable_type' => $payableType,
                'payable_id' => (string) $payableId,
                'user_id' => (string) $user->id,
                'payment_number' => $paymentNumber,
            ],
        ]);

        if (! $session || empty($session['id'])) {
            return $this->errorResponse('Failed to initialize payment. Please try again.', 502);
        }

        $attributes = $session['attributes'] ?? [];
        $checkoutUrl = $attributes['checkout_url'] ?? null;

        if (! $checkoutUrl) {
            return $this->errorResponse('Failed to initialize payment. Please try again.', 502);
        }

        Payment::create([
            'payment_number' => $paymentNumber,
            'payable_type' => $payableType === 'order' ? Order::class : ($payableType === 'group_order' ? GroupCheckout::class : Booking::class),
            'payable_id' => $payableId,
            'user_id' => $user->id,
            'amount' => $amount / 100,
            'method' => $validated['method'],
            'provider' => 'paymongo',
            'provider_payment_id' => $session['id'],
            'status' => 'pending',
            'description' => $description,
            'metadata' => $session,
        ]);

        return $this->successResponse([
            'payment_number' => $paymentNumber,
            'checkout_url' => $checkoutUrl,
        ]);
    }

    public function paymongoReturn(Request $request): RedirectResponse
    {
        $paymentNumber = $request->query('payment_number');
        $status = $request->query('status', 'unknown');

        if ($paymentNumber && $status === 'success') {
            $payment = Payment::where('payment_number', $paymentNumber)->first();
            if ($payment && $payment->status === 'pending' && $payment->provider_payment_id) {
                $this->verifyAndConfirmPayment($payment);
            }
        }

        $frontendUrl = rtrim(config('app.frontend_url', 'http://localhost:3000'), '/');
        $query = array_filter([
            'payment_number' => $paymentNumber,
            'status' => $status,
            'payable_type' => $request->query('payable_type', 'order'),
            'payable_id' => $request->query('payable_id'),
        ], static fn ($value) => $value !== null && $value !== '');

        return redirect()->away($frontendUrl.'/payment/callback?'.http_build_query($query));
    }

    /**
     * Handle the redirect back from PayMongo after the user completes or cancels payment.
     *
     * This is NOT the source of truth for payment status.
     * The webhook is the source of truth.
     */
    public function callback(Request $request): JsonResponse
    {
        $paymentNumber = $request->query('payment_number');
        $status = $request->query('status', 'unknown');

        if (! $paymentNumber) {
            return $this->errorResponse('Invalid payment callback.', 400);
        }

        $payment = Payment::where('payment_number', $paymentNumber)
            ->where('user_id', Auth::id())
            ->first();

        if (! $payment) {
            return $this->errorResponse('Payment not found.', 404);
        }

        if ($status === 'cancelled') {
            if ($payment->status !== 'paid') {
                $payment->update([
                    'status' => 'cancelled',
                ]);
            }

            return $this->successResponse([
                'status' => $payment->status,
                'redirect' => $this->getRedirectUrl($payment, 'cancelled'),
            ]);
        }

        // For success redirect — just return current status.
        // The webhook is the source of truth and will mark as paid.
        return $this->successResponse([
            'status' => $payment->status,
            'redirect' => $this->getRedirectUrl($payment, $payment->status === 'paid' ? 'success' : 'pending'),
        ]);
    }

    /**
     * PayMongo webhook endpoint.
     *
     * This is the source of truth for payment status. Must be idempotent —
     * processing the same event twice must not cause side effects.
     *
     * P11.4: every webhook carries a stable event id (data.id). The event id is
     * recorded in `payment_webhook_events` inside the SAME transaction that
     * applies the financial transition, with UNIQUE(provider_event_id) as the
     * DB-level "already processed" backstop: a retried or concurrently
     * delivered webhook fails its insert and becomes a no-op — the handler can
     * never run a second time.
     */
    public function webhook(Request $request): JsonResponse
    {
        // Verify webhook signature
        $signatureHeader = $request->header('PayMongo-Signature', '');
        if (! $this->paymongo->verifyWebhookSignature($request->getContent(), $signatureHeader)) {
            Log::warning('PayMongo webhook signature verification failed');

            return response()->json(['status' => 'invalid_signature'], 400);
        }

        $payload = $request->all();
        $eventType = $payload['data']['attributes']['type'] ?? '';
        $eventData = $payload['data']['attributes']['data'] ?? [];

        Log::info('PayMongo webhook received', ['type' => $eventType]);

        $this->processWebhookEvent($eventType, $eventData, $this->webhookEventKey($payload, $eventType));

        return response()->json(['status' => 'ok']);
    }

    /**
     * Derive a stable, deterministic idempotency key for a webhook delivery.
     *
     * Prefers the stable PayMongo event id (data.id, retried/concurrent
     * deliveries reuse it verbatim); falls back to a type+resource composite
     * for legacy payload shapes, and finally to a payload hash so an event is
     * never processed twice even when the id is missing.
     */
    protected function webhookEventKey(array $payload, string $eventType): string
    {
        $event = $payload['data'] ?? [];
        $eventId = $event['id'] ?? null;
        if (is_string($eventId) && $eventId !== '') {
            return $eventId;
        }

        $data = $payload['data']['attributes']['data'] ?? [];
        $resourceId = $data['id'] ?? $data['checkout_session_id'] ?? null;
        if (is_string($resourceId) && $resourceId !== '') {
            return 'res|'.$eventType.'|'.$resourceId;
        }

        return 'raw|'.$eventType.'|'.md5(json_encode($payload) ?: (string) $eventType);
    }

    /**
     * Run a single webhook event exactly-once.
     *
     * The event-id insert and the handler run inside one transaction (the
     * "mark processed + process" atomicity). A UNIQUE violation on
     * provider_event_id — from a concurrent delivery or a retry — rolls back
     * to a no-op before the handler can run.
     */
    protected function processWebhookEvent(string $eventType, array $eventData, string $eventKey): void
    {
        if ($eventKey === '' || $eventType === '') {
            Log::warning('PayMongo webhook missing event type/key', ['type' => $eventType]);

            return;
        }

        DB::transaction(function () use ($eventType, $eventData, $eventKey) {
            try {
                $event = PaymentWebhookEvent::query()->create([
                    'provider_event_id' => $eventKey,
                    'event_type' => $eventType,
                    'processed_at' => now(),
                ]);
            } catch (UniqueConstraintViolationException $e) {
                Log::info('PayMongo webhook already processed — no-op', ['event_key' => $eventKey]);

                return;
            }

            $this->dispatchWebhookEvent($eventType, $eventData, $event);
        });
    }

    protected function dispatchWebhookEvent(string $eventType, array $eventData, PaymentWebhookEvent $event): void
    {
        $paymentId = $this->resolveWebhookPaymentId($eventType, $eventData);
        if ($paymentId) {
            $event->update(['payment_id' => $paymentId, 'payload' => $eventData]);
        }

        match ($eventType) {
            'checkout_session.completed' => $this->handleCheckoutSessionCompleted($eventData),
            'checkout_session.payment.paid' => $this->handleCheckoutSessionPaymentPaid($eventData),
            'payment.paid', 'payment.succeeded' => $this->handlePaymentPaid($eventData),
            'payment.failed' => $this->handlePaymentFailed($eventData),
            'refund.pending', 'refund.succeeded', 'refund.failed', 'refund.updated', 'payment.refunded' => $this->handleRefundWebhook($eventType, $eventData),
            default => null,
        };
    }

    /**
     * Resolve the local payment affected by a webhook event, for audit linkage.
     */
    protected function resolveWebhookPaymentId(string $eventType, array $eventData): ?int
    {
        $sessionId = $eventData['checkout_session_id'] ?? $eventData['payment_intent_id'] ?? null;
        $resourceId = $eventData['id'] ?? null;

        $payment = $this->lockPaymentByProvider((array) ($sessionId ?: []), (array) ($resourceId ?: []));
        if ($payment) {
            return $payment->id;
        }

        if (in_array($eventType, ['refund.pending', 'refund.succeeded', 'refund.failed', 'refund.updated', 'payment.refunded'], true)
            && is_string($resourceId) && $resourceId !== '') {
            $refundLedger = \App\Models\Refund::query()->where('provider_refund_id', $resourceId)->first();

            return $refundLedger?->payment_id;
        }

        return null;
    }

    protected function handleCheckoutSessionCompleted(array $eventData): void
    {
        $sessionId = $eventData['id'] ?? null;
        $paymentId = $eventData['payment_intent_id'] ?? null;

        $payment = $this->lockPaymentByProvider((array) $sessionId, (array) $paymentId);

        if (! $payment) {
            return;
        }

        $sessionStatus = $eventData['status'] ?? '';
        if ($sessionStatus === 'completed') {
            if (! $payment->canApplyProviderVerdict('paid')) {
                return;
            }

            $payment->update([
                'status' => 'paid',
                'paid_at' => now(),
                'metadata' => array_merge($payment->metadata ?? [], ['checkout_session' => $eventData]),
            ]);
            $this->markPayablePaid($payment);

            $this->broadcastPaymentReceived($payment);
        } elseif (in_array($sessionStatus, ['expired', 'failed'], true)) {
            if (! $payment->canApplyProviderVerdict('failed')) {
                return;
            }

            $payment->update([
                'status' => 'failed',
                'failed_at' => now(),
            ]);
        }
    }

    protected function handleCheckoutSessionPaymentPaid(array $eventData): void
    {
        $sessionId = $eventData['checkout_session_id'] ?? null;
        $paymentId = $eventData['id'] ?? null;

        $payment = $this->lockPaymentByProvider((array) $sessionId, (array) $paymentId);

        if (! $payment) {
            return;
        }

        if (! $payment->canApplyProviderVerdict('paid')) {
            return;
        }

        $payment->update([
            'status' => 'paid',
            'paid_at' => now(),
            'provider_source_id' => $paymentId ?? $payment->provider_source_id,
            'metadata' => array_merge($payment->metadata ?? [], ['checkout_session_payment_paid' => $eventData]),
        ]);
        $this->markPayablePaid($payment);

        $this->broadcastPaymentReceived($payment);
    }

    protected function handlePaymentPaid(array $eventData): void
    {
        $paymentId = $eventData['id'] ?? null;

        $payment = $this->lockPaymentByProvider((array) $paymentId, (array) $paymentId);

        if (! $payment) {
            return;
        }

        if (! $payment->canApplyProviderVerdict('paid')) {
            return;
        }

        $payment->update([
            'status' => 'paid',
            'paid_at' => now(),
            'provider_source_id' => $paymentId ?? $payment->provider_source_id,
            'metadata' => array_merge($payment->metadata ?? [], ['webhook_data' => $eventData]),
        ]);
        $this->markPayablePaid($payment);

        $this->broadcastPaymentReceived($payment);
    }

    protected function handlePaymentFailed(array $eventData): void
    {
        $paymentId = $eventData['id'] ?? null;

        $payment = $this->lockPaymentByProvider((array) $paymentId, (array) $paymentId);

        if (! $payment) {
            return;
        }

        // Never downgrade a successful/refunded payment (late or out-of-order
        // payment.failed), and never resurrect an in-flight refund.
        if (! $payment->canApplyProviderVerdict('failed')) {
            return;
        }

        $payment->update([
            'status' => 'failed',
            'failed_at' => now(),
        ]);
    }

    /**
     * Look up a payment by provider references and lock its row so concurrent
     * webhook deliveries for the same payment serialize on the row lock: the
     * loser re-reads the already-applied state and its transition is guarded
     * into a no-op.
     */
    protected function lockPaymentByProvider(array $primaryRefs, array $secondaryRefs): ?Payment
    {
        $refs = collect(array_merge($primaryRefs, $secondaryRefs))
            ->filter(fn ($ref) => is_string($ref) && $ref !== '')
            ->unique()
            ->values()
            ->all();

        if ($refs === []) {
            return null;
        }

        return Payment::query()
            ->where(function ($q) use ($refs) {
                foreach (array_values($refs) as $index => $ref) {
                    if ($index === 0) {
                        $q->where(fn ($inner) => $inner->where('provider_payment_id', $ref)->orWhere('provider_source_id', $ref));
                    } else {
                        $q->orWhere(fn ($inner) => $inner->where('provider_payment_id', $ref)->orWhere('provider_source_id', $ref));
                    }
                }
            })
            ->lockForUpdate()
            ->first();
    }

    protected function broadcastPaymentReceived(Payment $payment): void
    {
        $businessId = $payment->payable?->business_id;
        if ($businessId) {
            event(new PaymentReceived($payment, $businessId));
        }
    }

    /**
     * Handle a PayMongo refund lifecycle webhook.
     *
     * Idempotent: re-delivered events converge to the same state, never create
     * a second provider refund, never duplicate ledger effects, and never
     * downgrade a successful refund. refund.pending / refund.succeeded /
     * refund.failed are authoritative by event type; refund.updated reads the
     * status carried in the payload.
     */
    protected function handleRefundWebhook(string $eventType, array $eventData): void
    {
        $refundId = $eventData['id']
            ?? $eventData['data']['id']
            ?? null;
        $rawStatus = $eventData['status']
            ?? $eventData['attributes']['status']
            ?? $eventData['data']['status']
            ?? null;
        $paymentId = $eventData['payment_id']
            ?? $eventData['attributes']['payment_id']
            ?? $eventData['data']['payment_id']
            ?? null;

        if (! $refundId) {
            Log::warning('Refund webhook missing refund id', ['type' => $eventType]);
            return;
        }

        $status = match ($eventType) {
            'refund.pending' => 'pending',
            'refund.succeeded', 'payment.refunded' => 'succeeded',
            'refund.failed' => 'failed',
            default => (string) ($rawStatus ?: 'pending'),
        };

        app(PaymentRefundProcessor::class)->applyProviderStatus(
            providerRefundId: (string) $refundId,
            providerStatus: $status,
            paymentId: $paymentId ? (string) $paymentId : null,
            attributes: $eventData,
        );
    }

    /**
     * Get payment status.
     */
    public function status(Request $request, string $paymentNumber): JsonResponse
    {
        $payment = Payment::where('payment_number', $paymentNumber)
            ->where('user_id', Auth::id())
            ->first();

        if (! $payment) {
            return $this->errorResponse('Payment not found.', 404);
        }

        // Fallback: if still pending, check PayMongo directly
        if ($payment->status === 'pending' && $payment->provider_payment_id) {
            $this->verifyAndConfirmPayment($payment);
        }

        return $this->successResponse($this->paymentStatusData($payment));
    }

    /**
     * Verify a pending payment directly with PayMongo API and confirm if paid.
     * Fallback when webhooks are not configured.
     */
    public function checkAndConfirm(Request $request, string $paymentNumber): JsonResponse
    {
        $payment = Payment::where('payment_number', $paymentNumber)->first();

        if (! $payment) {
            return $this->errorResponse('Payment not found.', 404);
        }

        if ($payment->status === 'paid') {
            return $this->successResponse($this->paymentStatusData($payment));
        }

        if ($payment->provider_payment_id) {
            $this->verifyAndConfirmPayment($payment);
        }

        $payment->refresh();

        return $this->successResponse($this->paymentStatusData($payment));
    }

    protected function paymentStatusData(Payment $payment): array
    {
        return [
            'payment_number' => $payment->payment_number,
            'status' => $payment->status,
            'amount' => $payment->amount,
            'method' => $payment->method,
            'paid_at' => $payment->paid_at,
            'payable_type' => $payment->payable_type === Order::class ? 'order' : ($payment->payable_type === GroupCheckout::class ? 'group_order' : 'booking'),
            'order_id' => $payment->payable_type === Order::class ? $payment->payable_id : null,
            'group_order_id' => $payment->payable_type === GroupCheckout::class ? $payment->payable_id : null,
        ];
    }

    /**
     * Verify a pending payment directly with PayMongo API and confirm if paid.
     * Fallback when webhooks are not configured.
     */
    protected function verifyAndConfirmPayment(Payment $payment): void
    {
        try {
            $sessionId = $payment->provider_payment_id;
            $response = \Illuminate\Support\Facades\Http::withHeaders([
                'Authorization' => 'Basic '.base64_encode(config('services.paymongo.secret_key', '').':'),
                'Accept' => 'application/json',
            ])->timeout(10)->get("https://api.paymongo.com/v1/checkout_sessions/{$sessionId}");

            if (! $response->successful()) {
                return;
            }

            $session = $response->json('data.attributes', []);
            $sessionStatus = $session['status'] ?? '';
            $intentStatus = $session['payment_intent']['attributes']['status'] ?? '';

            $isPaid = $sessionStatus === 'completed' || $intentStatus === 'succeeded';

            if ($isPaid) {
                DB::transaction(function () use ($payment, $session) {
                    $locked = Payment::query()->lockForUpdate()->find($payment->id);

                    if (! $locked || ! $locked->canApplyProviderVerdict('paid')) {
                        return;
                    }

                    $locked->update([
                        'status' => 'paid',
                        'paid_at' => now(),
                        'provider_source_id' => $session['payment_intent']['id'] ?? ($session['payment_intent']['attributes']['id'] ?? $locked->provider_source_id),
                        'metadata' => array_merge($locked->metadata ?? [], [
                            'verified_via' => 'checkAndConfirm',
                            'checkout_session' => $session,
                        ]),
                    ]);
                    $this->markPayablePaid($locked);
                    Log::info('Payment confirmed via checkAndConfirm', ['payment_number' => $locked->payment_number]);
                });
            } elseif (in_array($sessionStatus, ['expired', 'failed']) || in_array($intentStatus, ['failed', 'canceled', 'awaiting_payment_method'])) {
                DB::transaction(function () use ($payment) {
                    $locked = Payment::query()->lockForUpdate()->find($payment->id);

                    if (! $locked || ! $locked->canApplyProviderVerdict('failed')) {
                        return;
                    }

                    $locked->update([
                        'status' => 'failed',
                        'failed_at' => now(),
                    ]);
                });
            }
        } catch (\Exception $e) {
            Log::error('checkAndConfirm failed', ['payment_number' => $payment->payment_number, 'error' => $e->getMessage()]);
        }
    }

    /**
     * Refund a payment.
     *
     * Provider-authoritative (P11.3): the payment is only ever marked refunded
     * after PayMongo confirms the refund succeeded. A provider failure returns
     * 502 and keeps the payment 'paid' (retryable); a provider-pending refund
     * becomes 'pending_refund' and is settled by the refund webhook or the
     * reconciliation command — never by this local endpoint.
     */
    public function refund(Request $request, string $paymentNumber): JsonResponse
    {
        $validated = $request->validate([
            'amount' => 'nullable|integer|min:1',
            'reason' => 'nullable|string|max:255',
        ]);

        $payment = Payment::where('payment_number', $paymentNumber)
            ->where('user_id', Auth::id())
            ->first();

        if (! $payment) {
            return $this->errorResponse('Payment not found.', 404);
        }

        if ($payment->status === 'refunded') {
            return $this->errorResponse('This payment has already been refunded.', 422);
        }

        if ($payment->status === 'pending_refund') {
            return $this->errorResponse('A refund is already being processed for this payment.', 422);
        }

        if ($payment->status !== 'paid') {
            return $this->errorResponse('Only paid payments can be refunded.', 422);
        }

        if (! $payment->provider_source_id && ! $payment->provider_payment_id) {
            return $this->errorResponse('No PayMongo payment ID found for this payment.', 422);
        }

        // Default to full refund if no amount specified
        $amountPesos = ($validated['amount'] ?? (int) round($payment->amount * 100)) / 100;

        $result = app(PaymentRefundProcessor::class)->initiateRefund(
            payment: $payment,
            amount: (float) $amountPesos,
            reason: $validated['reason'] ?? '',
            userId: Auth::id(),
        );

        return match ($result['status']) {
            'provider_error' => $this->errorResponse('Refund failed. Please try again.', 502),
            'already_refunded' => $this->errorResponse('This payment has already been refunded.', 422),
            'in_flight' => $this->errorResponse('A refund is already being processed for this payment.', 422),
            'not_refundable', 'no_provider_ref' => $this->errorResponse('Only paid payments can be refunded.', 422),
            default => null, // 'succeeded' | 'pending'
        } ?? (function () use ($payment, $result, $amountPesos) {
            $refundStatus = $result['status'];

            // The processor already finalized the payment, the refunds ledger,
            // and the payable. For a successfully refunded ORDER, also move the
            // order's lifecycle status to cancelled.
            if ($refundStatus === 'succeeded') {
                $payable = $payment->fresh()->payable;
                if ($payable instanceof Order && $payable->status !== 'cancelled') {
                    $payable->update(['status' => 'cancelled']);
                }
            }

            return $this->successResponse([
                'refund_id' => $result['refund_id'],
                'status' => $refundStatus,
                'amount' => $amountPesos,
            ]);
        })();
    }

    protected function markPayablePaid(Payment $payment): void
    {
        $payable = $payment->payable;

        if (! $payable) {
            return;
        }

        // Authoritative-once guard (P11.4): a payable whose payment_status is
        // already 'paid' has been finalized by the first paid payment.
        // Concurrent/distinct webhook events converging on the same payable can
        // never re-run the paid side effects (amounts, acceptance timestamps,
        // dispatch, group fan-out).
        if ((string) $payable->getAttribute('payment_status') === 'paid') {
            return;
        }

        // Transport rides are finalized by the delivery lifecycle, never by
        // payment. Record only the paid state: never flip status to
        // waiting_restaurant, never start preparation/dispatch fan-out, and
        // never resurrect a cancelled ride into an active food flow.
        if ($payable instanceof Order && $payable->order_type === 'transport') {
            $payable->update([
                'paid_amount' => $payment->amount,
                'payment_method' => $payment->method,
                'payment_status' => 'paid',
            ]);

            return;
        }

        if ($payable instanceof Order && ! in_array($payable->status, ['accepted', 'preparing', 'ready', 'completed'])) {
            $payable->update([
                'paid_amount' => $payment->amount,
                'payment_method' => $payment->method,
                'payment_status' => 'paid',
                'status' => 'waiting_restaurant',
                'acceptance_started_at' => now(),
                'acceptance_deadline' => now()->addMinutes(10),
            ]);

            // Dispatch immediately: riders are offered the trip before the
            // restaurant starts preparing. Preparation is gated on the rider's
            // acceptance (see PreparationStartService).
            if ($payable->order_type === 'delivery') {
                try {
                    app(\App\Services\SmartDispatchService::class)->scheduleDispatch($payable->fresh());
                } catch (\Exception $e) {
                    Log::warning('Dispatch after payment failed', [
                        'order_id' => $payable->id,
                        'error' => $e->getMessage(),
                    ]);
                }
            } else {
                // Pickup food orders need no rider: paid → preparation starts.
                try {
                    app(\App\Services\PreparationStartService::class)->startForOrder($payable->fresh());
                } catch (\Exception $e) {
                    Log::warning('Preparation start after payment failed', [
                        'order_id' => $payable->id,
                        'error' => $e->getMessage(),
                    ]);
                }
            }
        } elseif ($payable instanceof GroupCheckout && $payable->payment_status !== 'paid') {
            $payable->update([
                'paid_amount' => $payment->amount,
                'payment_method' => $payment->method,
                'payment_status' => 'paid',
            ]);

            // Fan out: mark each child order paid/ready for restaurant acceptance.
            $orders = $payable->orders()->get();
            foreach ($orders as $childOrder) {
                if (! in_array($childOrder->status, ['accepted', 'preparing', 'ready', 'completed'])) {
                    $childOrder->update([
                        'paid_amount' => $childOrder->total,
                        'payment_method' => $payment->method,
                        'payment_status' => 'paid',
                        'status' => 'waiting_restaurant',
                        'acceptance_started_at' => now(),
                        'acceptance_deadline' => now()->addMinutes(10),
                    ]);
                }
            }

            // One group checkout => ONE physical delivery with ONE rider trip
            // (step 4/5). The single group trip is dispatched, never a
            // per-restaurant delivery.
            if ($payable->order_type === 'delivery') {
                try {
                    app(\App\Services\SmartDispatchService::class)->scheduleGroupDispatch($payable->fresh());
                } catch (\Exception $e) {
                    Log::warning('Dispatch after group payment failed', [
                        'group_order_id' => $payable->id,
                        'error' => $e->getMessage(),
                    ]);
                }
            } else {
                // Pickup groups need no rider: paid → preparation starts.
                foreach ($orders as $childOrder) {
                    try {
                        app(\App\Services\PreparationStartService::class)->startForOrder($childOrder->fresh());
                    } catch (\Exception $e) {
                        Log::warning('Preparation start after group payment failed', [
                            'order_id' => $childOrder->id,
                            'error' => $e->getMessage(),
                        ]);
                    }
                }
            }

            $payable->refreshAggregateStatus();
        } elseif ($payable instanceof Booking && $payable->status !== 'completed') {
            $payable->update([
                'paid_amount' => $payment->amount,
                'payment_status' => 'paid',
            ]);
        }
    }

    protected function getRedirectUrl(Payment $payment, string $result): string
    {
        $base = config('app.frontend_url', 'http://localhost:3000');
        $route = '/tourist/payment-success';

        if ($payment->payable_type === Order::class) {
            $params = http_build_query([
                'order_id' => $payment->payable_id,
                'payment_number' => $payment->payment_number,
                'status' => $result,
            ]);
        } elseif ($payment->payable_type === GroupCheckout::class) {
            $params = http_build_query([
                'group_order_id' => $payment->payable_id,
                'payment_number' => $payment->payment_number,
                'status' => $result,
            ]);
        } else {
            $params = http_build_query([
                'booking_id' => $payment->payable_id,
                'payment_number' => $payment->payment_number,
                'status' => $result,
            ]);
        }

        return $route.'?'.$params;
    }
}
