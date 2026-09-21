<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\RiderCredit;
use App\Models\RiderCreditTransaction;
use App\Models\User;
use App\Services\RiderCreditService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class AdminCreditsController extends Controller
{
    public function __construct(
        private RiderCreditService $creditService
    ) {}

    public function overview(): JsonResponse
    {
        $riders = User::where('role', User::ROLE_RIDER)
            ->orderBy('name')
            ->get();
        $accounts = $riders->map(fn (User $rider) => $this->creditService->getOrCreateAccount($rider->id));

        $stats = [
            'total_credits' => round((float) $accounts->sum('total_credits'), 2),
            'available_credits' => round((float) $accounts->sum(fn ($a) => $a->usable_credits), 2),
            'reserved_credits' => round((float) $accounts->sum('reserved_credits'), 2),
            'riders' => $accounts->count(),
            'eligible_riders' => $accounts->filter(fn ($a) => $a->usable_credits > 0)->count(),
            'pending_topups' => 0.0,
        ];

        $riders = $riders->map(fn (User $rider) => $this->riderData($rider))->values();

        $transactions = $this->transactionQuery()->limit(100)->get()
            ->map(fn (RiderCreditTransaction $transaction) => $this->transactionData($transaction))
            ->values();

        return $this->successResponse(compact('stats', 'riders', 'transactions'));
    }

    public function adjust(Request $request, User $rider): JsonResponse
    {
        abort_unless($rider->role === User::ROLE_RIDER, 404);

        $data = $request->validate([
            'type' => ['required', 'in:add,deduct'],
            'amount' => ['required', 'numeric', 'gt:0'],
            'reason' => ['required', 'string', 'max:1000'],
        ]);

        $transaction = DB::transaction(function () use ($rider, $data, $request) {
            $account = RiderCredit::where('rider_id', $rider->id)->lockForUpdate()->first();

            if (! $account) {
                $account = $this->creditService->getOrCreateAccount($rider->id);
            }

            $amount = (float) $data['amount'];
            $usableBefore = (float) $account->usable_credits;
            $delta = $data['type'] === 'add' ? $amount : -$amount;

            abort_if($usableBefore + $delta < 0, 422, 'Available credits cannot be negative.');

            $account->update([
                'total_credits' => max(0, (float) $account->total_credits + $delta),
            ]);

            return RiderCreditTransaction::create([
                'rider_id' => $rider->id,
                'transaction_type' => 'CREDIT_ADJUSTMENT',
                'amount' => $delta,
                'balance_before' => $usableBefore,
                'balance_after' => $usableBefore + $delta,
                'reference' => 'ADJ-' . Str::upper(Str::random(8)),
                'description' => $data['reason'] . ' (Authorized by ' . ($request->user()->name ?? 'Tourism Admin') . ')',
            ]);
        });

        return $this->successResponse($this->transactionData($transaction->load('rider')), 'Credits adjusted successfully.');
    }

    private function transactionQuery()
    {
        return RiderCreditTransaction::with(['rider', 'order'])
            ->orderByDesc('created_at');
    }

    private function riderData(User $rider): array
    {
        $credit = $this->creditService->getOrCreateAccount($rider->id);
        $available = (float) $credit->usable_credits;

        return [
            'id' => $rider->id,
            'name' => $rider->name,
            'email' => $rider->email,
            'available_credits' => $available,
            'reserved_credits' => (float) $credit->reserved_credits,
            'total_credits' => (float) $credit->total_credits,
            'eligibility' => $available > 0 ? ($available < 500 ? 'limited' : 'eligible') : 'ineligible',
        ];
    }

    private function transactionData(RiderCreditTransaction $transaction): array
    {
        return [
            'id' => $transaction->id,
            'rider_id' => $transaction->rider_id,
            'rider_name' => $transaction->rider?->name ?? 'Unknown rider',
            'transaction_type' => $transaction->transaction_type,
            'amount' => (float) $transaction->amount,
            'balance_before' => (float) $transaction->balance_before,
            'balance_after' => (float) $transaction->balance_after,
            'reference' => $transaction->reference,
            'description' => $transaction->description,
            'order_number' => $transaction->order?->order_number,
            'created_at' => $transaction->created_at,
            'status' => str_starts_with((string) $transaction->description, 'Pending') ? 'pending' : 'success',
            'payment_method' => $transaction->transaction_type === 'CREDIT_TOPUP' ? 'GCash' : null,
            'provider' => $transaction->transaction_type === 'CREDIT_TOPUP' ? 'PayMongo' : null,
        ];
    }
}
