<?php

namespace App\Services;

use App\Models\Order;
use App\Models\RiderEarning;
use App\Models\RiderEarningEntry;
use App\Models\RiderPayout;
use App\Models\RiderPayoutValidation;
use App\Models\User;
use App\Services\Integrity\TransactionIntegrityService;

/**
 * Stage 6 — every cashout is validated against the permanent earnings
 * ledger, never against the write-once earning rows' amounts.
 *
 * Per earning in the request:
 *   posted       its commission / tip postings exist (BLOCK if not: record it first)
 *   ledger_row   the postings equal the write-once row (BLOCK: tampering)
 *   reserved     this request's reservation equals the earning's ledger
 *                total not paid elsewhere (BLOCK: changed since reserved)
 *   not_elsewhere no other live reservation / completed payout for it (BLOCK)
 *   source       the original transaction checks (RiderEarningVerifier) (BLOCK)
 *   integrity    the order's tamper-evident history (BLOCK → BLOCK, FLAG → FLAG)
 * Per request:
 *   amount       Σ reservations = the requested amount (BLOCK)
 *   destination  the GCash destination is unchanged since approval (BLOCK)
 *
 * PASS → normal; FLAG → staff may approve only with a documented
 * investigation decision; BLOCK → the cashout cannot proceed until resolved.
 * Every result is stored (rider_payout_validations, append-only).
 */
class CashoutValidator
{
    public function __construct(
        private readonly RiderEarningLedger $ledger,
        private readonly RiderEarningVerifier $verifier,
        private readonly TransactionIntegrityService $integrity,
    ) {}

    /** @return array{result: string, checks: list<array>, validation: RiderPayoutValidation, blocking_message: ?string, flags: list<string>} */
    public function validate(RiderPayout $payout, string $context, ?User $by = null, ?string $note = null): array
    {
        $checks = [];
        $add = function (string $key, string $label, bool $ok, string $severity, ?string $detail = null) use (&$checks) {
            $checks[] = ['key' => $key, 'label' => $label, 'ok' => $ok, 'severity' => $severity, 'detail' => $ok ? null : $detail];
        };

        $earnings = $payout->earnings()->get();
        $add('has_earnings', 'The request holds earnings', $earnings->isNotEmpty(), 'block', 'This request holds no earnings.');

        $sourceFailures = [];
        $reservedTotal = 0.0;
        foreach ($earnings as $earning) {
            $ref = Order::withTrashed()->whereKey($earning->order_id)->value('order_number') ?? "earning #{$earning->id}";
            $this->checkEarning($payout, $earning, $ref, $add, $sourceFailures, $reservedTotal);
        }

        $add('amount', 'Reserved earnings equal the requested amount', round($reservedTotal, 2) === round((float) $payout->amount, 2), 'block',
            sprintf('Reserved ₱%s, requested ₱%s.', number_format($reservedTotal, 2), number_format((float) $payout->amount, 2)));

        $fingerprint = self::fingerprint($payout);
        if (in_array($payout->status, [RiderPayout::STATUS_APPROVED, RiderPayout::STATUS_PAID], true)) {
            $approved = RiderPayoutValidation::where('rider_payout_id', $payout->id)->where('context', 'approve')->latest('id')->first();
            $add('destination', 'GCash destination unchanged since approval', $approved !== null && hash_equals($approved->destination_fingerprint, $fingerprint), 'block',
                $approved === null ? 'No approval validation is on record.' : 'The GCash number or account name changed after approval.');
        }

        $failed = collect($checks)->where('ok', false);
        $result = $failed->contains('severity', 'block') ? RiderPayoutValidation::BLOCK
            : ($failed->isNotEmpty() ? RiderPayoutValidation::FLAG : RiderPayoutValidation::PASS);

        $validation = RiderPayoutValidation::create([
            'rider_payout_id' => $payout->id,
            'context' => $context,
            'result' => $result,
            'checks' => $checks,
            'destination_fingerprint' => $fingerprint,
            'decision_note' => $note !== null && trim($note) !== '' ? trim($note) : null,
            'checked_by' => $by?->id,
        ]);

        $blocking = null;
        if ($result === RiderPayoutValidation::BLOCK) {
            $blocking = $sourceFailures !== []
                ? 'These earnings failed verification: '.implode(', ', array_unique($sourceFailures)).'. Reject the request or investigate.'
                : 'This cashout cannot proceed: '.$failed->where('severity', 'block')->map(fn ($c) => $c['detail'] ?? $c['label'])->implode(' ');
        }

        return [
            'result' => $result,
            'checks' => $checks,
            'validation' => $validation,
            'blocking_message' => $blocking,
            'flags' => $failed->where('severity', 'flag')->map(fn ($c) => $c['detail'] ?? $c['label'])->values()->all(),
        ];
    }

    public static function fingerprint(RiderPayout $payout): string
    {
        return hash('sha256', trim((string) $payout->destination_gcash_number)."\n".trim((string) $payout->destination_account_name));
    }

    private function checkEarning(RiderPayout $payout, RiderEarning $earning, string $ref, callable $add, array &$sourceFailures, float &$reservedTotal): void
    {
        $posted = $this->ledger->isPosted($earning->id);
        $add("posted:{$earning->id}", "{$ref}: recorded in the earnings ledger", $posted, 'block',
            'Not recorded in the earnings ledger yet (run earnings:ledger-backfill).');

        if ($posted) {
            $postings = round((float) RiderEarningEntry::where('rider_earning_id', $earning->id)
                ->whereIn('entry_type', [RiderEarningEntry::EARNING_POSTED, RiderEarningEntry::TIP_POSTED])->sum('amount'), 2);
            $add("ledger_row:{$earning->id}", "{$ref}: ledger postings match the recorded earning", $postings === round((float) $earning->total_earning, 2), 'block',
                sprintf('Ledger ₱%s, earning record ₱%s.', number_format($postings, 2), number_format((float) $earning->total_earning, 2)));
        }

        $entries = RiderEarningEntry::where('rider_earning_id', $earning->id)->get();
        $mine = $entries->where('rider_payout_id', $payout->id);
        $others = $entries->whereNotNull('rider_payout_id')->where('rider_payout_id', '!=', $payout->id);
        $reserved = round((float) $mine->where('bucket', 'reserved')->sum('amount'), 2);
        $paidElsewhere = round((float) $others->where('bucket', 'paid')->sum('amount'), 2);
        $openElsewhere = round((float) $others->where('bucket', 'reserved')->sum('amount') - $paidElsewhere, 2);
        $expected = round($this->ledger->earned($earning->id) - $paidElsewhere, 2);
        $reservedTotal += $reserved;

        $add("reserved:{$earning->id}", "{$ref}: reserved for this request at its current ledger amount", $reserved > 0 && $reserved === $expected, 'block',
            sprintf('Reserved ₱%s, ledger amount now ₱%s.', number_format($reserved, 2), number_format($expected, 2)));
        $add("not_elsewhere:{$earning->id}", "{$ref}: not reserved or paid in another cashout", $openElsewhere <= 0 && $paidElsewhere <= 0, 'block',
            $paidElsewhere > 0 ? 'Already paid in another cashout.' : 'Reserved by another cashout request.');

        $source = $this->verifier->verify($earning, $payout->id);
        if (! $source['ok']) {
            $sourceFailures[] = $ref;
        }
        $add("source:{$earning->id}", "{$ref}: original transaction verified", $source['ok'], 'block',
            collect($source['checks'])->where('ok', false)->pluck('label')->implode('; '));

        $order = Order::withTrashed()->find($earning->order_id);
        if ($order) {
            $verdict = $this->integrity->verifyOrder($order, 'cashout', $payout->id);
            $problems = collect($verdict['checks'])->where('ok', false)->map(fn ($c) => $c['detail'] ?? $c['label'])->implode(' ');
            $add("integrity:{$earning->id}", "{$ref}: transaction history verified", $verdict['result'] === 'pass', $verdict['result'] === 'block' ? 'block' : 'flag', $problems);
        }
    }
}
