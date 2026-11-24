<?php

namespace App\Http\Controllers\Rider;

use App\Exceptions\PayoutConflictException;
use App\Http\Controllers\Controller;
use App\Models\RiderEarning;
use App\Models\RiderCompensationPayout;
use App\Models\RiderPayout;
use App\Services\PayoutStatementService;
use App\Services\RiderEarningVerifier;
use App\Services\RiderPayoutService;
use App\Services\RiderStatementService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Rider cashout (decision 2026-11-11): the rider requests a cashout of
 * verified ONLINE earnings to their GCash; the Tourism Office reviews,
 * approves, sends the GCash transfer and records it. TrackTour never sends
 * money itself.
 */
class RiderPayoutController extends Controller
{
    public function __construct(
        private readonly RiderPayoutService $payoutService,
        private readonly RiderEarningVerifier $verifier,
        private readonly PayoutStatementService $statements,
    ) {}

    /** Verified online earnings the rider may cash out now. */
    public function available(Request $request): JsonResponse
    {
        $available = $this->payoutService->getAvailableEarnings($request->user()->id);

        return $this->successResponse([
            'earnings' => $available['earnings']->map(fn (RiderEarning $e) => $this->verifier->verify($e)['source'])->values(),
            'total' => $available['total'],
            'payable' => $available['payable'],
            // Kept from the cash collected on COD / cash trips; never cashed out online.
            'cash_total' => $available['cash_total'],
            // Online earnings not yet verifiable (e.g. payment not confirmed yet).
            'held_total' => $available['held_total'],
        ], 'Available cashout earnings.');
    }

    public function index(Request $request): JsonResponse
    {
        $payouts = RiderPayout::query()
            ->where('rider_id', $request->user()->id)
            ->orderByDesc('requested_at')
            ->paginate(15)
            ->through(fn (RiderPayout $p) => $this->row($p));

        return $this->paginatedResponse($payouts, 'Cashout history.');
    }

    public function request(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'amount' => ['nullable', 'numeric', 'gt:0', 'max:1000000'],
            'gcash_number' => ['required', 'string', 'regex:/^09\d{9}$/'],
            'account_name' => ['required', 'string', 'max:120'],
        ], ['gcash_number.regex' => 'Enter your GCash number as 09XXXXXXXXX.']);

        try {
            // Stage D2: earnings (existing cashout, unchanged) + the rider's
            // payable cancellation compensation, requested together.
            $result = $this->statements->request(
                $request->user(),
                isset($validated['amount']) ? (float) $validated['amount'] : null,
                $validated['gcash_number'],
                trim($validated['account_name']),
            );
            $comp = $result['compensation'];
            $body = $result['payout'] ? $this->row($result['payout']) : ['id' => null, 'status' => $comp?->status, 'amount' => 0.0];
            $body['compensation_payout'] = $comp?->present();
            $body['total'] = round((float) ($result['payout']?->amount ?? 0) + (float) ($comp?->amount ?? 0), 2);

            return $this->successResponse($body, 'Cashout requested. The Tourism Office will review it.', 201);
        } catch (PayoutConflictException $e) {
            return $this->errorResponse($e->getMessage(), 409);
        }
    }

    public function show(Request $request, RiderPayout $payout): JsonResponse
    {
        if ((int) $payout->rider_id !== (int) $request->user()->id) {
            return $this->errorResponse('You do not have access to this payout.', 403);
        }

        return $this->successResponse($this->row($payout) + ['items' => $payout->items_snapshot ?? []], 'Cashout detail.');
    }

    public function cancel(Request $request, RiderPayout $payout): JsonResponse
    {
        if ((int) $payout->rider_id !== (int) $request->user()->id) {
            return $this->errorResponse('You do not have access to this payout.', 403);
        }

        try {
            return $this->successResponse($this->row($this->statements->cancel($payout)), 'Cashout cancelled; the earnings are available again.');
        } catch (PayoutConflictException $e) {
            return $this->errorResponse($e->getMessage(), 409);
        }
    }

    /* ── Stage D2: statement and cancellation compensation ───────── */

    /** GET /rider/earnings-statement — earnings, cancellation compensation, payable, paid, remaining. */
    public function statement(Request $request, RiderStatementService $statement): JsonResponse
    {
        return $this->successResponse($statement->for($request->user()), 'Earnings statement.');
    }

    /** GET /rider/compensation-payouts — compensation payouts, newest first. */
    public function compensationPayouts(Request $request): JsonResponse
    {
        return $this->successResponse(
            RiderCompensationPayout::where('rider_id', $request->user()->id)->latest('id')->limit(50)->get()->map->present()->values(),
            'Cancellation compensation payouts.',
        );
    }

    /** POST /rider/compensation-payouts/{payout}/cancel — a compensation-only payout, while pending. */
    public function cancelCompensationPayout(Request $request, RiderCompensationPayout $payout): JsonResponse
    {
        try {
            return $this->successResponse($this->statements->cancelCompensationOnly($payout, $request->user())->present(), 'Cancelled; the compensation is available again.');
        } catch (PayoutConflictException $e) {
            return $this->errorResponse($e->getMessage(), 409);
        }
    }

    private function row(RiderPayout $p): array
    {
        return [
            'id' => $p->id,
            'payout_number' => $p->payout_number,
            'status' => $p->status,
            'amount' => (float) $p->amount,
            'items_count' => count($p->items_snapshot ?? []),
            'destination_gcash_number' => $p->destination_gcash_number,
            'destination_account_name' => $p->destination_account_name,
            'requested_at' => $p->requested_at,
            'approved_at' => $p->approved_at,
            'paid_at' => $p->status === RiderPayout::STATUS_PAID ? $p->paid_at : null,
            'payment_reference' => $p->status === RiderPayout::STATUS_PAID ? $p->payment_reference : null,
            'rejection_reason' => $p->rejection_reason,
            'failure_reason' => $p->failure_reason,
            // Stage D2: the linked cancellation compensation, if any.
            'compensation_payout' => RiderCompensationPayout::where('rider_payout_id', $p->id)->first()?->present(),
        ];
    }
}
