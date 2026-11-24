<?php

namespace App\Services;

use App\Exceptions\RidePenaltyException;
use App\Models\ActivityLog;
use App\Models\Order;
use App\Models\PenaltyCashReceipt;
use App\Models\PenaltyCashReceiptAllocation;
use App\Models\RideCancellationPenalty;
use App\Models\User;
use App\Services\Integrity\TransactionLedger;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;

/**
 * Stage D1 (§P.4): Tourism Office staff confirm PHYSICAL receipt of cash
 * cancellation fees a rider collected — one numbered receipt per remittance,
 * one allocation per penalty. A penalty is received only when its
 * allocations reach the full amount; only then is the original rider's
 * compensation created (or an advance recovered). Partial remittances are
 * allocated as received; the rest stays outstanding.
 */
class PenaltyCashReceiptService
{
    public function __construct(
        private readonly RideCompensationService $compensations,
        private readonly TransactionLedger $orderLedger,
    ) {}

    /** Cash fees this rider collected that the office has not fully received yet. */
    public function outstandingFor(int $collectingRiderId)
    {
        return RideCancellationPenalty::with('cancelledOrder:id,order_number')
            ->where('collected_by', $collectingRiderId)
            ->where('collection_method', 'cash')
            ->where('status', RideCancellationPenalty::STATUS_COLLECTED)
            ->whereNull('received_at')
            ->orderBy('collected_at')
            ->get();
    }

    /**
     * @param  array<int, array{penalty_id: int, amount: float|int|string}>  $allocations
     */
    public function record(User $staff, int $collectingRiderId, string $receiptNumber, float $receivedAmount, array $allocations, ?string $note = null): PenaltyCashReceipt
    {
        $receiptNumber = trim($receiptNumber);
        if ($receiptNumber === '') {
            throw new RidePenaltyException('Enter the receipt number.', 422);
        }
        $receivedAmount = round($receivedAmount, 2);
        if ($receivedAmount <= 0) {
            throw new RidePenaltyException('Enter the amount received.', 422);
        }
        $byPenalty = [];
        foreach ($allocations as $a) {
            $id = (int) ($a['penalty_id'] ?? 0);
            $amount = round((float) ($a['amount'] ?? 0), 2);
            if ($id <= 0 || $amount <= 0) {
                throw new RidePenaltyException('Each line needs a cancellation fee and an amount above ₱0.', 422);
            }
            if (isset($byPenalty[$id])) {
                throw new RidePenaltyException('A cancellation fee appears twice on this receipt.', 422);
            }
            $byPenalty[$id] = $amount;
        }
        if ($byPenalty === []) {
            throw new RidePenaltyException('Add at least one cancellation fee to the receipt.', 422);
        }
        if (abs(array_sum($byPenalty) - $receivedAmount) >= 0.005) {
            throw new RidePenaltyException('The lines must add up to the amount received (₱'.number_format($receivedAmount, 2).').', 422);
        }

        try {
            return DB::transaction(function () use ($staff, $collectingRiderId, $receiptNumber, $receivedAmount, $byPenalty, $note) {
                ksort($byPenalty); // fixed lock order
                $penalties = RideCancellationPenalty::whereIn('id', array_keys($byPenalty))->orderBy('id')->lockForUpdate()->get()->keyBy('id');

                foreach ($byPenalty as $id => $amount) {
                    $p = $penalties->get($id);
                    if (! $p || $p->status !== RideCancellationPenalty::STATUS_COLLECTED || $p->collection_method !== 'cash' || (int) $p->collected_by !== $collectingRiderId) {
                        throw new RidePenaltyException("Cancellation fee #{$id} was not collected in cash by this rider.", 422);
                    }
                    if ($p->received_at !== null) {
                        throw new RidePenaltyException("Cancellation fee #{$id} is already fully received.", 409);
                    }
                    $remaining = round((float) $p->penalty_amount - (float) $p->received_amount, 2);
                    if ($amount - $remaining >= 0.005) {
                        throw new RidePenaltyException("Only ₱".number_format($remaining, 2)." is still outstanding on cancellation fee #{$id}.", 422);
                    }
                }

                $receipt = PenaltyCashReceipt::create([
                    'receipt_number' => $receiptNumber,
                    'collecting_rider_id' => $collectingRiderId,
                    'received_amount' => $receivedAmount,
                    'received_by' => $staff->id,
                    'received_at' => now(),
                    'note' => $note !== null && trim($note) !== '' ? mb_substr(trim($note), 0, 500) : null,
                ]);

                foreach ($byPenalty as $id => $amount) {
                    $p = $penalties->get($id);
                    PenaltyCashReceiptAllocation::create(['receipt_id' => $receipt->id, 'penalty_id' => $id, 'amount' => $amount]);
                    $newReceived = round((float) $p->received_amount + $amount, 2);
                    $full = $newReceived + 0.005 >= (float) $p->penalty_amount;
                    $p->forceFill([
                        'received_amount' => $newReceived,
                        'received_at' => $full ? now() : null,
                        'received_by' => $full ? $staff->id : $p->received_by,
                    ])->save();

                    $order = Order::find($p->cancelled_order_id);
                    if ($order) {
                        $this->orderLedger->record($order, 'ride_penalty_cash_received', [
                            'penalty_id' => $p->id,
                            'receipt_number' => $receiptNumber,
                            'amount' => $amount,
                            'received_total' => $newReceived,
                            'fully_received' => $full,
                            'collecting_rider_id' => $collectingRiderId,
                            'received_by' => $staff->id,
                        ], $receipt);
                        ActivityLog::record('ride.penalty_cash_received',
                            "Ride {$order->order_number}: ₱".number_format($amount, 2)." of the cancellation fee received from rider #{$collectingRiderId} (receipt {$receiptNumber})".($full ? ', fully received.' : ', partly received.'),
                            $order, ActivityLog::TYPE_FINANCIAL);
                    }
                    if ($full) {
                        $this->compensations->onReceived($p, $staff);
                    }
                }

                return $receipt->load('allocations');
            });
        } catch (UniqueConstraintViolationException) {
            throw new RidePenaltyException("Receipt {$receiptNumber} has already been recorded.", 409);
        }
    }
}
