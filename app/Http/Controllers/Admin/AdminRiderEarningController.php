<?php

namespace App\Http\Controllers\Admin;

use App\Exceptions\PayoutConflictException;
use App\Http\Controllers\Controller;
use App\Models\ActivityLog;
use App\Models\RiderEarning;
use App\Models\User;
use App\Services\RiderEarningLedger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

/**
 * Tourism Office view of one earning's permanent ledger and the only way to
 * correct it: a compensating adjustment (Stage 5). Requires a reason and the
 * staff member's password; at or above the two-person threshold a second
 * Tourism Office staff member confirms with their own password.
 */
class AdminRiderEarningController extends Controller
{
    public function __construct(private readonly RiderEarningLedger $ledger) {}

    public function show(RiderEarning $earning): JsonResponse
    {
        return $this->successResponse($this->present($earning), 'Earning ledger.');
    }

    public function adjust(Request $request, RiderEarning $earning): JsonResponse
    {
        $threshold = (float) config('payouts.two_person_threshold', 5000);
        $validated = $request->validate([
            'amount' => ['required', 'numeric', 'not_in:0', 'between:-100000,100000'],
            'reason' => ['required', 'string', 'min:5', 'max:500'],
            'password' => ['required', 'string'],
            'second_staff_email' => ['nullable', 'email'],
            'second_staff_password' => ['nullable', 'string'],
        ]);

        $staff = $request->user();
        if (! Hash::check($validated['password'], $staff->password)) {
            throw ValidationException::withMessages(['password' => 'Your password is incorrect.']);
        }
        if ((int) $earning->rider_id === (int) $staff->id) {
            return $this->errorResponse('You cannot adjust your own earnings.', 403);
        }

        $approver = null;
        if (abs((float) $validated['amount']) >= $threshold) {
            $approver = User::where('email', $validated['second_staff_email'] ?? '')->first();
            if (! $approver || $approver->id === $staff->id || $approver->role !== 'bansud_tourism_office'
                || ! Hash::check((string) ($validated['second_staff_password'] ?? ''), $approver->password)) {
                throw ValidationException::withMessages(['second_staff_email' => sprintf(
                    'Adjustments of ₱%s or more need a second Tourism Office staff member to confirm with their own password.',
                    number_format($threshold, 0)
                )]);
            }
        }

        try {
            $entry = $this->ledger->adjust($earning, (float) $validated['amount'], $validated['reason'], $staff, $approver);
        } catch (PayoutConflictException $e) {
            return $this->errorResponse($e->getMessage(), 409);
        }

        ActivityLog::record(
            'earning.adjusted',
            sprintf('Adjusted earning #%d by ₱%s: %s%s', $earning->id, number_format((float) $entry->amount, 2), $validated['reason'], $approver ? " (confirmed by {$approver->name})" : ''),
            $earning,
            ActivityLog::TYPE_FINANCIAL,
        );

        return $this->successResponse($this->present($earning->fresh()), 'Adjustment recorded.');
    }

    private function present(RiderEarning $earning): array
    {
        $names = User::whereIn('id', $this->ledger->entriesFor($earning->id)->flatMap(fn ($e) => [$e->actor_id, $e->approved_by])->filter()->unique())->pluck('name', 'id');

        return [
            'earning_id' => $earning->id,
            'rider_id' => $earning->rider_id,
            'order_id' => $earning->order_id,
            'recorded_total' => round((float) $earning->total_earning, 2),
            'earned' => $this->ledger->earned($earning->id),
            'in_cashout' => $this->ledger->open($earning->id),
            'paid_out' => $this->ledger->paid($earning->id),
            'available' => $this->ledger->available($earning->id),
            'two_person_threshold' => (float) config('payouts.two_person_threshold', 5000),
            'entries' => $this->ledger->entriesFor($earning->id)->map(fn ($e) => [
                'id' => $e->id,
                'type' => $e->entry_type,
                'bucket' => $e->bucket,
                'amount' => (float) $e->amount,
                'channel' => $e->channel,
                'reason' => $e->reason,
                'details' => $e->details,
                'by' => $e->actor_id ? ($names[$e->actor_id] ?? "User #{$e->actor_id}") : 'System',
                'approved_by' => $e->approved_by ? ($names[$e->approved_by] ?? "User #{$e->approved_by}") : null,
                'payout_id' => $e->rider_payout_id,
                'at' => $e->created_at,
            ])->values(),
        ];
    }
}
