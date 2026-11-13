<?php

namespace App\Http\Controllers\Admin;

use App\Exceptions\PayoutConflictException;
use App\Http\Controllers\Controller;
use App\Models\ActivityLog;
use App\Models\RiderEarning;
use App\Models\RiderPayout;
use App\Models\User;
use App\Services\RiderEarningVerifier;
use App\Services\RiderPayoutService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Tourism Office cashout review (decision 2026-11-11): every rider cashout is
 * investigated and approved by staff, paid manually through GCash and
 * confirmed with the transfer evidence. Approving, confirming payment and
 * marking a payout failed require the staff member's password again.
 */
class AdminPayoutController extends Controller
{
    public function __construct(
        private readonly RiderPayoutService $payoutService,
        private readonly RiderEarningVerifier $verifier,
    ) {}

    /** Cashout requests, newest first, optionally by status. */
    public function index(Request $request): JsonResponse
    {
        $validated = $request->validate(['status' => ['nullable', 'in:'.implode(',', RiderPayout::STATUSES).',open']]);
        $status = $validated['status'] ?? null;

        $payouts = RiderPayout::query()
            ->with('rider')
            ->withCount('earnings')
            ->when($status === 'open', fn ($q) => $q->whereIn('status', RiderPayout::LIVE_STATUSES))
            ->when($status && $status !== 'open', fn ($q) => $q->where('status', $status))
            ->orderByDesc('requested_at')
            ->paginate(15)
            ->through(fn (RiderPayout $p) => [
                'id' => $p->id,
                'payout_number' => $p->payout_number,
                'status' => $p->status,
                'amount' => (float) $p->amount,
                'rider' => ['id' => $p->rider_id, 'name' => $p->rider?->name ?? $p->rider?->email],
                'destination_gcash_number' => $this->mask($p->destination_gcash_number),
                'items_count' => $p->earnings_count ?: count($p->items_snapshot ?? []),
                'requested_at' => $p->requested_at,
            ]);

        return $this->paginatedResponse($payouts, 'Cashout requests.');
    }

    /** Stage 6: re-validate a live cashout against the earnings ledger now (stored). */
    public function validateNow(Request $request, RiderPayout $payout): JsonResponse
    {
        app(\App\Services\CashoutValidator::class)->validate($payout, 'manual', $request->user());

        return $this->successResponse($this->latestValidation($payout->fresh()), 'Validated against the earnings ledger.');
    }

    private function latestValidation(RiderPayout $payout): ?array
    {
        $v = \App\Models\RiderPayoutValidation::where('rider_payout_id', $payout->id)->latest('id')->first();
        if (! $v) {
            return null;
        }

        return [
            'result' => $v->result,
            'context' => $v->context,
            'checks' => $v->checks,
            'decision_note' => $v->decision_note,
            'checked_by' => $v->checked_by ? User::whereKey($v->checked_by)->value('name') : null,
            'at' => $v->created_at,
        ];
    }

    /** Dashboard tiles: pending requests, awaiting review, approved unpaid, paid today. */
    public function summary(): JsonResponse
    {
        $today = now('Asia/Manila')->startOfDay()->utc();

        return $this->successResponse([
            'pending_count' => RiderPayout::where('status', RiderPayout::STATUS_PENDING)->count(),
            'under_review_count' => RiderPayout::where('status', RiderPayout::STATUS_UNDER_REVIEW)->count(),
            'awaiting_review_amount' => round((float) RiderPayout::whereIn('status', [RiderPayout::STATUS_PENDING, RiderPayout::STATUS_UNDER_REVIEW])->sum('amount'), 2),
            'approved_unpaid_count' => RiderPayout::where('status', RiderPayout::STATUS_APPROVED)->count(),
            'approved_unpaid_amount' => round((float) RiderPayout::where('status', RiderPayout::STATUS_APPROVED)->sum('amount'), 2),
            'paid_today_amount' => round((float) RiderPayout::where('status', RiderPayout::STATUS_PAID)->where('paid_at', '>=', $today)->sum('paid_amount'), 2),
            'paid_today_count' => RiderPayout::where('status', RiderPayout::STATUS_PAID)->where('paid_at', '>=', $today)->count(),
        ], 'Cashout summary.');
    }

    /**
     * Original transaction investigation for one earning in the request: the
     * tourist, order and items, restaurant(s), payments, dispatch history,
     * pickup confirmations, completion / delivery confirmation and the earning
     * computation (rides: passenger, booking, fare, trip). Read-only.
     */
    public function investigate(RiderPayout $payout, RiderEarning $earning): JsonResponse
    {
        $inRequest = $payout->earnings()->whereKey($earning->id)->exists()
            || collect($payout->items_snapshot ?? [])->contains(fn ($i) => (int) ($i['earning_id'] ?? 0) === (int) $earning->id);
        if (! $inRequest || (int) $earning->rider_id !== (int) $payout->rider_id) {
            return $this->notFoundResponse('That earning is not part of this cashout.');
        }

        $order = $earning->order()->with(['items', 'business'])->first();
        if (! $order) {
            return $this->notFoundResponse('The original order no longer exists.');
        }
        $isRide = $order->order_type === 'transport';
        $delivery = \App\Models\Delivery::with('rider')->where('order_id', $order->id)->first()
            ?? ($order->group_order_id ? \App\Models\Delivery::with('rider')->where('group_checkout_id', $order->group_order_id)->first() : null);
        $tourist = $order->user_id ? User::with('profile')->find($order->user_id) : null;
        $payments = \App\Models\Payment::query()
            ->where(fn ($q) => $q->where(fn ($o) => $o->where('payable_type', \App\Models\Order::class)->where('payable_id', $order->id))
                ->when($order->group_order_id, fn ($g) => $g->orWhere(fn ($o) => $o->where('payable_type', \App\Models\GroupCheckout::class)->where('payable_id', $order->group_order_id))))
            ->orderBy('id')
            ->get();
        $notes = $isRide && is_string($delivery?->notes) ? (json_decode($delivery->notes, true) ?: []) : [];
        $status = fn ($d) => $d?->status instanceof \BackedEnum ? $d->status->value : $d?->status;
        $commission = (float) ($delivery?->rider_commission ?? 0);
        $tip = (float) $earning->rider_tip;

        return $this->successResponse([
            'type' => $isRide ? 'ride' : 'food',
            'verification' => $this->verifier->verify($earning, $payout->id)['checks'],
            'tourist' => [
                'name' => $order->customer_name,
                'email' => $order->customer_email,
                'phone' => $order->customer_phone ?? $tourist?->profile?->mobile_number,
                'account_id' => $tourist?->id,
                'account_status' => $tourist?->account_status,
                'email_verified' => $tourist?->email_verified_at !== null,
                'member_since' => $tourist?->created_at,
            ],
            'order' => [
                'id' => $order->id,
                'number' => $order->order_number,
                'status' => $order->status,
                'placed_at' => $order->created_at,
                'payment_method' => $order->payment_method,
                'payment_status' => $order->payment_status,
                'subtotal' => (float) $order->subtotal,
                'delivery_fee' => (float) $order->delivery_fee,
                'system_fee' => (float) ($order->system_fee ?? 0),
                'tip' => (float) ($order->rider_tip ?? 0),
                'total' => (float) $order->total,
                'delivery_address' => $order->delivery_address ?? $delivery?->delivery_address,
            ],
            'restaurants' => $isRide ? [] : collect([$order->business])->filter()
                ->merge($order->items->map(fn ($i) => $i->business_id ? \App\Models\Business::find($i->business_id) : null)->filter())
                ->unique('id')->values()
                ->map(fn ($b) => ['id' => $b->id, 'name' => $b->business_name, 'status' => $b->status, 'address' => $b->address]),
            'items' => $isRide ? [] : $order->items->map(fn ($i) => [
                'name' => $i->product_name,
                'quantity' => (int) $i->quantity,
                'cancelled_quantity' => (int) ($i->cancelled_quantity ?? 0),
                'unit_price' => (float) $i->unit_price,
                'subtotal' => (float) $i->subtotal,
                'status' => $i->status,
                'business_id' => $i->business_id ?: $order->business_id,
            ])->values(),
            'ride' => $isRide ? [
                'vehicle_type' => $notes['vehicle_type'] ?? null,
                'passenger_count' => $notes['passenger_count'] ?? null,
                'fare' => (float) $order->total,
                'distance_km' => $notes['estimated_distance_km'] ?? null,
                'duration_minutes' => $notes['estimated_duration_min'] ?? null,
                'pickup_address' => $delivery?->pickup_address,
                'dropoff_address' => $delivery?->delivery_address,
            ] : null,
            'payments' => $payments->map(fn ($pay) => [
                'number' => $pay->payment_number,
                'method' => $pay->method,
                'provider' => $pay->provider,
                'provider_reference' => $pay->provider_payment_id,
                'status' => $pay->status,
                'amount' => (float) $pay->amount,
                'paid_at' => $pay->paid_at,
                'refunded_at' => $pay->refunded_at,
            ])->values(),
            'assignment' => $delivery ? [
                'delivery_id' => $delivery->id,
                'rider' => $delivery->rider ? ['id' => $delivery->rider->id, 'name' => $delivery->rider->name] : null,
                'status' => $status($delivery),
                'assigned_at' => $delivery->assigned_at,
                'dispatch' => $delivery->dispatchLogs()->with('rider:id,name')->orderBy('id')->get()->map(fn ($log) => [
                    'rider' => $log->rider?->name ?? "Rider #{$log->rider_id}",
                    'is_this_rider' => (int) $log->rider_id === (int) $earning->rider_id,
                    'attempt' => $log->attempt_no,
                    'response' => $log->response,
                    'offered_at' => $log->dispatched_at,
                    'responded_at' => $log->responded_at,
                ])->values(),
            ] : null,
            'pickups' => $delivery ? \App\Models\DeliveryPickupStop::where('delivery_id', $delivery->id)->orderBy('sequence')->get()->map(fn ($stop) => [
                'restaurant' => \App\Models\Business::find($stop->business_id)?->business_name,
                'arrived_at' => $stop->arrived_at,
                'confirmed_at' => $stop->pickup_confirmed_at,
                'status' => $stop->status,
            ])->values() : [],
            'completion' => $delivery ? [
                'picked_up_at' => $delivery->picked_up_at,
                'arrived_destination_at' => $delivery->arrived_destination_at,
                'delivered_at' => $delivery->delivered_at,
                'confirmed_at' => $delivery->delivery_confirmed_at,
                'confirmed_by' => $delivery->delivery_confirmed_by
                    ? (((int) $delivery->delivery_confirmed_by === (int) $order->user_id) ? 'tourist' : (((int) $delivery->delivery_confirmed_by === (int) $earning->rider_id) ? 'rider (photo at drop-off)' : 'staff'))
                    : null,
                'proof_photo' => (bool) $delivery->delivery_proof_path,
                'proof_distance_m' => $delivery->delivery_proof_distance_m !== null ? (float) $delivery->delivery_proof_distance_m : null,
                'cash_settled_at' => $delivery->cash_settled_at,
            ] : null,
            'earning' => [
                'id' => $earning->id,
                'status' => $earning->status,
                'earned_at' => $earning->earned_at,
                'delivery_fee_charged' => (float) $earning->delivery_fee,
                'rider_commission' => $commission,
                'tip' => $tip,
                'total' => (float) $earning->total_earning,
                'formula' => sprintf('Rider commission ₱%s + tip ₱%s = ₱%s', number_format($commission, 2), number_format($tip, 2), number_format((float) $earning->total_earning, 2)),
                'matches_formula' => round($commission + $tip, 2) === round((float) $earning->total_earning, 2),
            ],
        ], 'Original transaction records.');
    }

    /** Full review: rider, destination, every earning traced to its source, history. */
    public function show(Request $request, RiderPayout $payout): JsonResponse
    {
        return $this->successResponse($this->detail($payout), 'Cashout request.');
    }

    public function startReview(Request $request, RiderPayout $payout): JsonResponse
    {
        return $this->act(fn () => $this->payoutService->startReview($payout, $request->user()), 'Review started.');
    }

    public function approve(Request $request, RiderPayout $payout): JsonResponse
    {
        $validated = $request->validate([
            'password' => ['required', 'string'],
            'note' => ['nullable', 'string', 'max:500'],
        ]);
        $this->reauthenticate($request->user(), $validated['password']);

        return $this->act(fn () => $this->payoutService->approve($payout, $request->user(), $validated['note'] ?? null), 'Cashout approved. Send the GCash transfer, then confirm the payment.');
    }

    public function reject(Request $request, RiderPayout $payout): JsonResponse
    {
        $validated = $request->validate([
            'reason' => ['required_without:note', 'nullable', 'string', 'max:500'],
            'note' => ['nullable', 'string', 'max:500'],
        ]);

        return $this->act(fn () => $this->payoutService->reject($payout, $request->user(), $validated['reason'] ?? $validated['note'] ?? null), 'Cashout rejected; the earnings returned to the rider.');
    }

    public function markPaid(Request $request, RiderPayout $payout): JsonResponse
    {
        $validated = $request->validate([
            'password' => ['required', 'string'],
            'reference' => ['required', 'string', 'max:64'],
            'amount' => ['required', 'numeric', 'gt:0'],
            'recipient_number' => ['required', 'string', 'regex:/^09\d{9}$/'],
            'recipient_name' => ['required', 'string', 'max:120'],
            'paid_at' => ['required', 'date', 'before_or_equal:now'],
            'proof' => ['required', 'file', 'image', 'mimes:jpg,jpeg,png,webp', 'max:8192'],
            'note' => ['nullable', 'string', 'max:500'],
        ], [
            'recipient_number.regex' => 'Enter the GCash number as 09XXXXXXXXX.',
            'proof.required' => 'Attach the screenshot or photo of the GCash transfer.',
        ]);
        $this->reauthenticate($request->user(), $validated['password']);

        return $this->act(fn () => $this->payoutService->markPaid($payout, $request->user(), $validated['note'] ?? null, [
            'reference' => $validated['reference'],
            'amount' => $validated['amount'],
            'recipient_number' => $validated['recipient_number'],
            'recipient_name' => $validated['recipient_name'],
            'paid_at' => $validated['paid_at'],
            'proof' => $request->file('proof'),
        ]), 'Payment confirmed.');
    }

    public function markFailed(Request $request, RiderPayout $payout): JsonResponse
    {
        $validated = $request->validate([
            'password' => ['required', 'string'],
            'reason' => ['required', 'string', 'max:500'],
        ]);
        $this->reauthenticate($request->user(), $validated['password']);

        return $this->act(fn () => $this->payoutService->markFailed($payout, $request->user(), $validated['reason']), 'Marked failed; the earnings returned to the rider.');
    }

    /** The GCash transfer proof (private file). */
    public function proof(RiderPayout $payout): StreamedResponse|JsonResponse
    {
        if (! $payout->payment_proof_path || ! Storage::disk('local')->exists($payout->payment_proof_path)) {
            return $this->notFoundResponse('No proof on file.');
        }

        return Storage::disk('local')->response($payout->payment_proof_path);
    }

    private function act(callable $action, string $message): JsonResponse
    {
        try {
            $payout = $action();

            return $this->successResponse($this->detail($payout), $message);
        } catch (PayoutConflictException $e) {
            return $this->errorResponse($e->getMessage(), 409);
        }
    }

    private function reauthenticate(User $staff, string $password): void
    {
        if (! Hash::check($password, $staff->password)) {
            throw ValidationException::withMessages(['password' => 'Your password is incorrect.']);
        }
    }

    private function detail(RiderPayout $payout): array
    {
        $payout->loadMissing('rider.profile', 'rider.municipality', 'earnings.order.business');
        $live = in_array($payout->status, RiderPayoutService::LOCKING_STATUSES, true);

        // Live or paid: verify each linked earning now. Released (rejected /
        // cancelled / failed): show the snapshot taken at request time.
        $items = $live && $payout->earnings->isNotEmpty()
            ? $payout->earnings->map(function (RiderEarning $e) use ($payout) {
                $check = $this->verifier->verify($e, $payout->id);

                return $check['source'] + ['checks' => $check['checks'], 'verified' => $check['ok']];
            })->values()->all()
            : collect($payout->items_snapshot ?? [])->map(fn ($s) => $s + ['checks' => [], 'verified' => null])->values()->all();

        $names = User::whereIn('id', array_filter([$payout->review_started_by, $payout->approved_by, $payout->paid_by, $payout->failed_by, $payout->reviewed_by]))
            ->pluck('name', 'id');
        $staff = fn ($id) => $id ? ['id' => (int) $id, 'name' => $names[$id] ?? "Staff #{$id}"] : null;

        // A. GCash accounts this rider used on earlier cashouts.
        $earlier = RiderPayout::where('rider_id', $payout->rider_id)->where('id', '!=', $payout->id)->orderBy('requested_at')->get();
        $gcashHistory = $earlier->filter(fn ($p) => $p->destination_gcash_number)
            ->groupBy('destination_gcash_number')
            ->map(fn ($group, $number) => [
                'gcash_number' => (string) $number,
                'account_name' => $group->last()->destination_account_name,
                'requests' => $group->count(),
                'paid' => $group->where('status', RiderPayout::STATUS_PAID)->count(),
                'first_used_at' => $group->first()->requested_at,
                'last_used_at' => $group->last()->requested_at,
            ])->values();
        $paidNumbers = $earlier->where('status', RiderPayout::STATUS_PAID)->pluck('paid_recipient_number')->filter()->unique();

        // D. Financial verification.
        $paidBefore = round((float) $earlier->where('status', RiderPayout::STATUS_PAID)->sum('paid_amount'), 2);
        $otherOpen = round((float) $earlier->whereIn('status', RiderPayout::LIVE_STATUSES)->sum('amount'), 2);
        $lifetimeOnline = app(\App\Services\RiderEarningLedger::class)->riderTotals((int) $payout->rider_id)['earned'];
        $thisAmount = $payout->status === RiderPayout::STATUS_PAID ? 0.0 : (float) $payout->amount;
        $customerPaid = round((float) collect($items)->sum(fn ($i) => (float) ($i['customer_paid'] ?? 0)), 2);
        $gateway = round((float) collect($items)->sum(fn ($i) => (float) ($i['gateway_amount'] ?? 0)), 2);
        $earningsTotal = round((float) collect($items)->sum('amount'), 2);

        return [
            'id' => $payout->id,
            'payout_number' => $payout->payout_number,
            'status' => $payout->status,
            'amount' => (float) $payout->amount,
            'requested_at' => $payout->requested_at,
            'rider' => [
                'id' => $payout->rider_id,
                'name' => $payout->rider?->name,
                'email' => $payout->rider?->email,
                'phone' => $payout->rider?->profile?->mobile_number,
                'account_status' => $payout->rider?->account_status,
                'municipality' => $payout->rider?->municipality?->name,
                'member_since' => $payout->rider?->created_at,
                'email_verified' => $payout->rider?->email_verified_at !== null,
            ],
            'gcash_history' => $gcashHistory,
            'validation' => $this->latestValidation($payout),
            'decision_note_min' => RiderPayoutService::DECISION_NOTE_MIN,
            // A destination never paid before deserves a closer look.
            'new_destination' => $payout->destination_gcash_number !== null && ! $paidNumbers->contains($payout->destination_gcash_number),
            'financial' => [
                'customer_paid' => $customerPaid,
                'gateway_confirmed' => $gateway,
                'earnings_in_request' => $earningsTotal,
                'paid_out_before' => $paidBefore,
                'other_open_requests' => $otherOpen,
                'lifetime_online_earnings' => $lifetimeOnline,
                'remaining_unpaid' => round($lifetimeOnline - $paidBefore - $otherOpen - $thisAmount, 2),
                'checks' => [
                    ['key' => 'gateway_matches', 'label' => 'Provider-confirmed amounts equal what the customers were charged', 'ok' => $customerPaid > 0 && abs($gateway - $customerPaid) < 0.01],
                    ['key' => 'earnings_within_payments', 'label' => 'Earnings are less than the payments they come from', 'ok' => $earningsTotal > 0 && $earningsTotal < $gateway],
                    ['key' => 'request_matches_earnings', 'label' => 'Request amount equals its earnings', 'ok' => abs($earningsTotal - (float) $payout->amount) < 0.01],
                    ['key' => 'within_lifetime', 'label' => 'Paid out before + this request do not exceed lifetime online earnings', 'ok' => round($paidBefore + $otherOpen + $thisAmount, 2) <= $lifetimeOnline],
                ],
            ],
            'destination' => [
                'gcash_number' => $payout->destination_gcash_number,
                'account_name' => $payout->destination_account_name,
            ],
            'items' => $items,
            'items_total' => round((float) collect($items)->sum('amount'), 2),
            'all_verified' => $live ? collect($items)->every(fn ($i) => $i['verified'] === true) : null,
            'two_person_threshold' => $this->payoutService->twoPersonThreshold(),
            'two_person_required' => (float) $payout->amount >= $this->payoutService->twoPersonThreshold(),
            'review' => [
                'started_by' => $staff($payout->review_started_by),
                'started_at' => $payout->review_started_at,
                'approved_by' => $staff($payout->approved_by),
                'approved_at' => $payout->approved_at,
                'note' => $payout->review_note,
                'rejection_reason' => $payout->rejection_reason,
            ],
            'payment' => $payout->status === RiderPayout::STATUS_PAID ? [
                'paid_by' => $staff($payout->paid_by),
                'paid_at' => $payout->paid_at,
                'reference' => $payout->payment_reference,
                'amount' => (float) $payout->paid_amount,
                'recipient_number' => $payout->paid_recipient_number,
                'recipient_name' => $payout->paid_recipient_name,
                'has_proof' => (bool) $payout->payment_proof_path,
            ] : null,
            'failure' => $payout->status === RiderPayout::STATUS_FAILED ? [
                'failed_by' => $staff($payout->failed_by),
                'failed_at' => $payout->failed_at,
                'reason' => $payout->failure_reason,
            ] : null,
            'history' => ActivityLog::query()
                ->where('model_type', RiderPayout::class)
                ->where('model_id', $payout->id)
                ->with('user:id,name')
                ->orderBy('id')
                ->get()
                ->map(fn (ActivityLog $l) => ['action' => $l->action, 'description' => $l->description, 'by' => $l->user?->name, 'at' => $l->created_at])
                ->values(),
        ];
    }

    private function mask(?string $number): ?string
    {
        if (! $number) {
            return null;
        }

        return substr($number, 0, 4).str_repeat('•', max(0, strlen($number) - 7)).substr($number, -3);
    }
}
