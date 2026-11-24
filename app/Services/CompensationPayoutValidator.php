<?php

namespace App\Services;

use App\Models\Order;
use App\Models\RideCancellationPenalty;
use App\Models\RiderCancellationCompensation as Comp;
use App\Models\RiderCompensationEntry;
use App\Models\RiderCompensationPayout as CompPayout;
use App\Models\RiderCompensationPayoutItem;
use App\Services\Integrity\TransactionIntegrityService;

/**
 * Stage D2 (§P.5): validates the cancellation-compensation part of a payout,
 * independently of the existing CashoutValidator (which is unchanged). Per
 * compensation:
 *   owner     owned by the payout's rider = the cancelled booking's ORIGINAL rider
 *   funded    collection: the penalty is fully received (not refunded);
 *             advance: granted (approved), not merely requested
 *   standing  reserved in this payout (paid once paid); not held / voided /
 *             written off; the penalty is not disputed
 *   single    in no other live payout
 *   ledger    its entitlement and this payout's reservation equal its amount
 *   integrity the cancelled booking's tamper-evident history does not BLOCK
 * Per payout: the amount equals the sum of its items.
 */
class CompensationPayoutValidator
{
    public const PASS = 'pass';

    public const BLOCK = 'block';

    public function __construct(
        private readonly RideCompensationLedger $ledger,
        private readonly TransactionIntegrityService $integrity,
    ) {}

    /** @return array{result: string, checks: list<array{key: string, label: string, ok: bool, detail: ?string}>, blocking_message: ?string} */
    public function validate(CompPayout $payout): array
    {
        $payout->loadMissing('items.compensation.penalty');
        $checks = [];
        $add = function (string $key, string $label, bool $ok, ?string $detail = null) use (&$checks) {
            $checks[] = ['key' => $key, 'label' => $label, 'ok' => $ok, 'detail' => $ok ? null : $detail];
        };
        $expectStatus = $payout->status === CompPayout::STATUS_PAID ? Comp::STATUS_PAID : Comp::STATUS_RESERVED;

        foreach ($payout->items as $item) {
            $c = $item->compensation;
            $p = $c?->penalty;
            $ref = 'Compensation #'.$item->compensation_id;
            if (! $c || ! $p) {
                $add("source:{$item->compensation_id}", "{$ref}: found", false, 'The compensation or its penalty is missing.');

                continue;
            }

            $add("owner:{$c->id}", "{$ref}: owned by the original rider of the cancelled booking",
                (int) $c->rider_id === (int) $payout->rider_id && (int) $c->rider_id === (int) $p->compensated_rider_id,
                'The compensation does not belong to this rider.');

            $funded = $c->funding === Comp::FUNDING_COLLECTION
                ? $p->received_at !== null && $p->status === RideCancellationPenalty::STATUS_COLLECTED
                : RiderCompensationEntry::where('compensation_id', $c->id)->where('entry_type', RiderCompensationEntry::ADVANCE_GRANTED)->exists();
            $add("funded:{$c->id}", $c->funding === Comp::FUNDING_COLLECTION ? "{$ref}: the tourist's payment was received" : "{$ref}: approved advance",
                $funded, $c->funding === Comp::FUNDING_COLLECTION ? 'The penalty is not fully received (or was refunded).' : 'The advance was not approved.');

            $add("standing:{$c->id}", "{$ref}: payable and not disputed",
                $c->status === $expectStatus && $p->status !== RideCancellationPenalty::STATUS_DISPUTED,
                "Status: {$c->status}; penalty: {$p->status}.");

            $elsewhere = RiderCompensationPayoutItem::where('compensation_id', $c->id)->where('payout_id', '!=', $payout->id)
                ->whereHas('payout', fn ($q) => $q->whereIn('status', [...CompPayout::LIVE_STATUSES, CompPayout::STATUS_PAID]))->exists();
            $add("single:{$c->id}", "{$ref}: not in another payout", ! $elsewhere, 'It is already in another payout.');

            $reserved = round((float) RiderCompensationEntry::where('compensation_id', $c->id)->where('payout_id', $payout->id)
                ->where('bucket', 'reserved')->where('amount', '>', 0)->sum('amount'), 2);
            $add("ledger:{$c->id}", "{$ref}: ledger entitlement and reservation equal ₱".number_format((float) $item->amount, 2),
                $this->ledger->earned($c->id) === round((float) $item->amount, 2) && $reserved === round((float) $item->amount, 2),
                'Ledger entitlement ₱'.number_format($this->ledger->earned($c->id), 2).', reserved ₱'.number_format($reserved, 2).'.');

            $order = Order::withTrashed()->find($c->cancelled_order_id);
            $verdict = $order ? $this->integrity->verifyOrder($order, 'compensation_payout', $payout->id)['result'] : 'block';
            $add("integrity:{$c->id}", "{$ref}: cancelled booking history verified", $verdict !== 'block', 'The cancelled booking\'s history failed verification.');
        }

        $sum = round((float) $payout->items->sum('amount'), 2);
        $add('amount', 'Payout amount equals its compensations', $payout->items->isNotEmpty() && $sum === round((float) $payout->amount, 2),
            'Items ₱'.number_format($sum, 2).' vs payout ₱'.number_format((float) $payout->amount, 2).'.');

        $failed = collect($checks)->where('ok', false);

        return [
            'result' => $failed->isEmpty() ? self::PASS : self::BLOCK,
            'checks' => $checks,
            'blocking_message' => $failed->isEmpty() ? null : 'Compensation cannot be paid: '.$failed->map(fn ($c) => $c['label'].' — '.$c['detail'])->implode(' '),
        ];
    }
}
