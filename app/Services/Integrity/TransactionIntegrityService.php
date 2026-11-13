<?php

namespace App\Services\Integrity;

use App\Models\ActivityLog;
use App\Models\Delivery;
use App\Models\GroupCheckout;
use App\Models\Order;
use App\Models\Payment;
use App\Models\RiderEarning;
use App\Models\TransactionBlueprint;
use App\Models\TransactionCheckpoint;
use App\Models\TransactionCheckpointEntry;
use App\Models\TransactionEvent;
use App\Models\TransactionIntegrityCheck;
use Illuminate\Support\Collection;

/**
 * Transaction Integrity Service (plan §3.4). Verifies a blueprint against
 * its own hash chain, the last signed checkpoint, and the live source
 * records, and stores the result:
 *
 *   PASS  every check succeeded
 *   FLAG  incomplete or unusual evidence — Tourism Office must investigate
 *   BLOCK a critical inconsistency (broken chain, checkpoint mismatch, or a
 *         live amount / status / assignment that no recorded event explains)
 *
 * A failing check never modifies the original records.
 */
class TransactionIntegrityService
{
    private const BLOCK = 'block';

    private const FLAG = 'flag';

    public function __construct(private readonly TransactionCheckpointService $checkpoints) {}

    /** Verify the order's blueprint, opening none: an order with no blueprint is reported as such. */
    public function verifyOrder(Order $order, string $context = 'manual', ?int $contextId = null): array
    {
        $blueprint = TransactionBlueprint::where('order_id', $order->id)->first();
        if (! $blueprint) {
            return [
                'result' => TransactionLedger::transactionType($order) === null ? TransactionIntegrityCheck::PASS : TransactionIntegrityCheck::FLAG,
                'blueprint' => null,
                'checks' => [[
                    'key' => 'blueprint', 'label' => 'Transaction blueprint exists', 'ok' => TransactionLedger::transactionType($order) === null,
                    'severity' => self::FLAG, 'detail' => 'No transaction history was recorded for this order.',
                ]],
            ];
        }

        return $this->verify($blueprint, $context, $contextId);
    }

    /** @return array{result: string, blueprint: TransactionBlueprint, checks: list<array>, check_id: int} */
    public function verify(TransactionBlueprint $blueprint, string $context = 'manual', ?int $contextId = null): array
    {
        /** @var Collection<int, TransactionEvent> $events */
        $events = TransactionEvent::where('blueprint_id', $blueprint->id)->orderBy('sequence')->get();
        $order = Order::withTrashed()->find($blueprint->order_id);
        $checks = [];
        $add = function (string $key, string $label, bool $ok, string $severity, ?string $detail = null) use (&$checks) {
            $checks[] = compact('key', 'label', 'ok', 'severity') + ['detail' => $ok ? null : $detail];
        };

        // 1. Event chain.
        $chainProblem = $this->chainProblem($blueprint, $events);
        $add('chain', 'Event history is intact (every SHA-256 link recomputes)', $chainProblem === null, self::BLOCK, $chainProblem);

        // 2. Last signed checkpoint.
        $checkpointProblem = $this->checkpointProblem($blueprint, $events);
        $add('checkpoint', 'History matches its last signed checkpoint', $checkpointProblem === null, self::BLOCK, $checkpointProblem);

        // 3. Original transaction.
        $sourceOk = $order !== null && TransactionLedger::transactionType($order) === $blueprint->transaction_type;
        $add('source', 'Original order exists and matches the blueprint', $sourceOk, self::BLOCK, $order ? 'The order type no longer matches.' : 'The original order is missing.');

        if ($order !== null) {
            $state = $this->recordedState($events);

            // 4. Customer.
            $add('customer', 'Customer matches the recorded customer', (int) ($state['customer_id'] ?? 0) === (int) $order->user_id, self::BLOCK,
                'The order now belongs to a different customer than any recorded event shows.');

            // 5. Amounts.
            $amountDiff = [];
            foreach (TransactionLedger::AMOUNT_FIELDS as $field) {
                $recorded = $state['amounts'][$field] ?? null;
                $live = TransactionLedger::money($order->getAttribute($field));
                // Histories recorded before the snapshot read database defaults
                // hold null for an amount the database filled with 0.00.
                if ($recorded === null && $live === '0.00') {
                    continue;
                }
                if ($recorded !== $live) {
                    $amountDiff[] = "{$field}: recorded {$recorded}, now {$live}";
                }
            }
            $add('amounts', 'Order amounts match the recorded history', $amountDiff === [], self::BLOCK, implode('; ', $amountDiff));

            // 6. Payments.
            $paymentDiff = [];
            foreach ($this->paymentsFor($order) as $payment) {
                $recorded = $state['payments'][$payment->id] ?? null;
                if ($recorded === null) {
                    $paymentDiff[] = "{$payment->payment_number} has no recorded event";
                } elseif ($recorded['amount'] !== TransactionLedger::money($payment->amount) || $recorded['to'] !== $payment->status) {
                    $paymentDiff[] = "{$payment->payment_number}: recorded ".($recorded['to'] ?? '?').' ₱'.($recorded['amount'] ?? '?').", now {$payment->status} ₱".TransactionLedger::money($payment->amount);
                }
            }
            $add('payments', 'Payments match the recorded history', $paymentDiff === [], self::BLOCK, implode('; ', $paymentDiff));

            // 7. Rider assignment.
            $delivery = $this->deliveryFor($order);
            $liveRider = $delivery?->rider_id ? (int) $delivery->rider_id : null;
            $add('rider', 'Rider assignment matches the recorded history', ($state['rider_id'] ?? null) === $liveRider, self::BLOCK,
                'The delivery is assigned to a rider no recorded event assigned.');

            // 8. Rider earnings.
            $earningDiff = [];
            foreach (RiderEarning::where('order_id', $order->id)->get() as $earning) {
                $recorded = $state['earnings'][$earning->id] ?? null;
                if ($recorded === null) {
                    $earningDiff[] = "earning #{$earning->id} has no recorded event";
                } elseif (($recorded['total_earning'] ?? null) !== TransactionLedger::money($earning->total_earning)
                    || ($recorded['status'] ?? null) !== $earning->status
                    || (int) ($recorded['rider_id'] ?? 0) !== (int) $earning->rider_id) {
                    $earningDiff[] = "earning #{$earning->id}: recorded ₱".($recorded['total_earning'] ?? '?').' ('.($recorded['status'] ?? '?').'), now ₱'.TransactionLedger::money($earning->total_earning)." ({$earning->status})";
                }
            }
            $add('earnings', 'Rider earnings match the recorded history', $earningDiff === [], self::BLOCK, implode('; ', $earningDiff));

            // 9. Complete history (FLAG).
            $add('history', 'Full history recorded from order creation', ! $blueprint->legacy && ($events->first()?->event_type === 'order_created'), self::FLAG,
                'The ledger started after this order already existed; earlier steps are not in the history.');

            // 10. Completed lifecycle (FLAG): only judged once the order is finished,
            // and not for legacy histories — check 9 already explains their gap.
            if (! $blueprint->legacy && ($blueprint->finalized_at !== null || in_array(TransactionLedger::scalar($order->status), ['completed', 'delivered'], true))) {
                $types = $events->pluck('event_type');
                $missing = [];
                if (! $types->contains('rider_assigned')) {
                    $missing[] = 'rider assignment';
                }
                $completedStates = ['delivered', 'completed'];
                if (! $events->contains(fn ($e) => ($e->event_type === 'delivery_status_changed' && in_array($e->payload['to'] ?? null, $completedStates, true))
                    || ($e->event_type === 'delivery_created' && in_array($e->payload['status'] ?? null, $completedStates, true)))) {
                    $missing[] = 'completion';
                }
                if (! in_array($order->payment_method, ['cash', 'cod'], true) && ! $types->contains('payment_verified')) {
                    $missing[] = 'payment verification';
                }
                $add('lifecycle', 'Assignment, payment and completion were all recorded', $missing === [], self::FLAG, 'Not recorded: '.implode(', ', $missing).'.');
            }

            // 12. Escalations (Stage 5): a refused rejection / refund or a late
            // accepted order is for the Tourism Office to investigate.
            $escalations = $events->where('event_type', 'escalation');
            $add('escalations', 'No escalations awaiting Tourism Office investigation', $escalations->isEmpty(), self::FLAG,
                $escalations->map(fn ($e) => $e->payload['message'] ?? ($e->payload['action'] ?? 'escalation'))->unique()->implode(' '));

            // 13. Earnings ledger (Stage 5): each earning's posted entries
            // (commission + tip) must equal its write-once row; adjustments are
            // separate entries. Missing postings → FLAG; a different amount → BLOCK.
            $ledgerDiff = [];
            $ledgerMissing = [];
            foreach (RiderEarning::where('order_id', $order->id)->get() as $earning) {
                $posted = \App\Models\RiderEarningEntry::where('rider_earning_id', $earning->id)
                    ->whereIn('entry_type', [\App\Models\RiderEarningEntry::EARNING_POSTED, \App\Models\RiderEarningEntry::TIP_POSTED]);
                if (! (clone $posted)->exists()) {
                    $ledgerMissing[] = "earning #{$earning->id}";

                    continue;
                }
                $sum = round((float) $posted->sum('amount'), 2);
                if ($sum !== round((float) $earning->total_earning, 2)) {
                    $ledgerDiff[] = "earning #{$earning->id}: ledger ₱".number_format($sum, 2).', row ₱'.number_format((float) $earning->total_earning, 2);
                }
            }
            $add('earning_ledger', 'Rider earnings match their permanent ledger postings', $ledgerDiff === [], self::BLOCK, implode('; ', $ledgerDiff));
            if ($ledgerMissing !== []) {
                $add('earning_ledger_posted', 'Every rider earning is posted in the ledger', false, self::FLAG, 'Not posted yet (run earnings:ledger-backfill): '.implode(', ', $ledgerMissing).'.');
            }

            // 11. Ride hailing (Stage 4) — all FLAG, never BLOCK.
            if ($blueprint->transaction_type === TransactionBlueprint::TYPE_RIDE && ! $blueprint->legacy) {
                $this->rideChecks($events, $order, $blueprint, $add);
            }
        }

        $failed = collect($checks)->where('ok', false);
        $result = $failed->contains('severity', self::BLOCK) ? TransactionIntegrityCheck::BLOCK
            : ($failed->isNotEmpty() ? TransactionIntegrityCheck::FLAG : TransactionIntegrityCheck::PASS);

        $check = TransactionIntegrityCheck::create([
            'blueprint_id' => $blueprint->id,
            'result' => $result,
            'checks' => $checks,
            'context' => $context,
            'context_id' => $contextId,
            'checked_by' => auth()->id(),
        ]);
        $blueprint->forceFill([
            'integrity_status' => match ($result) {
                TransactionIntegrityCheck::PASS => TransactionBlueprint::STATUS_VERIFIED,
                TransactionIntegrityCheck::FLAG => TransactionBlueprint::STATUS_FLAGGED,
                default => TransactionBlueprint::STATUS_INVALID,
            },
            'last_verified_at' => now(),
        ])->save();

        if ($result === TransactionIntegrityCheck::BLOCK) {
            ActivityLog::record(
                'integrity.blocked',
                'Transaction integrity check BLOCKED order '.($order?->order_number ?? "#{$blueprint->order_id}").': '.$failed->where('severity', self::BLOCK)->pluck('label')->implode('; ').'.',
                $blueprint,
                ActivityLog::TYPE_SECURITY,
            );
        }

        return ['result' => $result, 'blueprint' => $blueprint, 'checks' => $checks, 'check_id' => $check->id];
    }

    /**
     * Ride checks: the fare quote was recorded at booking; every earning equals
     * the recorded rider commission (+ tip); a finished ride has completion
     * location evidence near the destination. Incomplete or unusual evidence
     * is for the Tourism Office to investigate (FLAG), never proof of fraud.
     */
    private function rideChecks(Collection $events, Order $order, TransactionBlueprint $blueprint, callable $add): void
    {
        $quote = $events->firstWhere('event_type', 'ride_quoted')?->payload;
        $add('ride_quote', 'Fare quote recorded at booking', $quote !== null, self::FLAG, 'This ride has no recorded fare quote.');

        if ($quote !== null && isset($quote['distance_km_exact'], $quote['base_fare'], $quote['per_km'], $quote['fare'])) {
            // Stage 5: recompute the booked fare and commission from the
            // recorded inputs (exact distance, rates, commission rate/minimum).
            $base = (float) $quote['base_fare'];
            $fare = round(max($base + round((float) $quote['distance_km_exact'] * (float) $quote['per_km'], 2), $base), 2);
            $commission = round(max((float) ($quote['commission_minimum'] ?? 20), $fare * (float) ($quote['commission_rate'] ?? 0.4)), 2);
            $fareOk = abs($fare - (float) $quote['fare']) < 0.005 && abs($fare - (float) $order->subtotal) < 0.005
                && abs($commission - (float) ($quote['rider_commission'] ?? -1)) < 0.005;
            $add('ride_fare', 'Fare and commission recompute from the recorded quote', $fareOk, self::FLAG, sprintf(
                'Recomputed fare ₱%s / commission ₱%s; recorded fare ₱%s, order ₱%s, commission ₱%s.',
                number_format($fare, 2), number_format($commission, 2), number_format((float) $quote['fare'], 2),
                number_format((float) $order->subtotal, 2), number_format((float) ($quote['rider_commission'] ?? 0), 2)
            ));
        }

        if ($quote !== null) {
            $commission = $quote['rider_commission'] ?? null;
            foreach ($events->where('event_type', 'delivery_fee_changed') as $change) {
                $commission = $change->payload['rider_commission'] ?? $commission;
            }
            $commission = $commission !== null ? round((float) $commission, 2) : null;
            $diff = [];
            foreach (RiderEarning::where('order_id', $order->id)->get() as $earning) {
                $expected = round(($commission ?? 0) + (float) $earning->rider_tip, 2);
                // Stage 5: judged on the ledger total, so an adjustment shows up for review.
                $net = app(\App\Services\RiderEarningLedger::class)->earned($earning->id);
                if ($commission === null || $net !== $expected) {
                    $diff[] = "earning #{$earning->id} is ₱".TransactionLedger::money($net).", the recorded commission is ₱".TransactionLedger::money($commission);
                }
            }
            $add('ride_commission', 'Rider earning equals the commission fixed at booking', $diff === [], self::FLAG, implode('; ', $diff));
        }

        $finished = $blueprint->finalized_at !== null || in_array(TransactionLedger::scalar($order->status), ['completed', 'delivered'], true);
        if ($finished) {
            $evidence = $events->where('event_type', 'trip_evidence')
                ->first(fn ($e) => ($e->payload['step'] ?? null) === 'completed')
                ?? $events->where('event_type', 'trip_evidence')->first(fn ($e) => ($e->payload['step'] ?? null) === 'arrived_destination');
            [$ok, $detail] = $this->completionLocationVerdict($evidence?->payload['evidence'] ?? null);
            $add('ride_completion_location', 'Ride ended near the booked destination', $ok, self::FLAG, $detail);
        }
    }

    /**
     * Stage 5: judge the completion evidence by its quality. Each fix (device,
     * server) counts only when fresh enough; its distance is reduced by its
     * accuracy radius (the rider could be anywhere inside it), and the best
     * fresh fix decides. Missing or only-stale evidence is reported as such.
     * Always a FLAG — never proof of anything on its own.
     *
     * @return array{0: bool, 1: string|null}
     */
    private function completionLocationVerdict(?array $evidence): array
    {
        $radius = (float) config('integrity.ride_completion_flag_radius_m', 200);
        $maxAge = (int) config('integrity.ride_evidence_max_age_s', 120);
        $fresh = [];
        $stale = [];
        foreach (['device', 'server'] as $source) {
            $fix = $evidence[$source] ?? null;
            if (! is_array($fix) || ! isset($fix['distance_m'])) {
                continue;
            }
            $effective = max(0.0, (float) $fix['distance_m'] - (float) ($fix['accuracy_m'] ?? 0));
            $age = $fix['age_s'] ?? null;
            if ($age !== null && (int) $age > $maxAge) {
                $stale[] = sprintf('%s fix %s s old', $source, (int) $age);

                continue;
            }
            $fresh[] = ['source' => $source, 'effective' => $effective, 'distance' => (float) $fix['distance_m'], 'accuracy' => $fix['accuracy_m'] ?? null];
        }

        if ($fresh === []) {
            return [false, $stale === []
                ? 'No location evidence was recorded when the ride ended.'
                : 'Only stale location evidence when the ride ended ('.implode(', ', $stale).').'];
        }
        usort($fresh, fn ($a, $b) => $a['effective'] <=> $b['effective']);
        $best = $fresh[0];
        if ($best['effective'] <= $radius) {
            return [true, null];
        }

        return [false, sprintf(
            'The ride ended %s m from the booked destination by the %s fix (accuracy %s m; flag above %d m).',
            number_format($best['distance']), $best['source'], $best['accuracy'] !== null ? number_format((float) $best['accuracy']) : 'unknown', (int) $radius
        )];
    }

    private function chainProblem(TransactionBlueprint $blueprint, Collection $events): ?string
    {
        $previous = TransactionLedger::GENESIS;
        $expected = 1;
        foreach ($events as $event) {
            if ($event->sequence !== $expected) {
                return "Event #{$expected} is missing.";
            }
            if ($event->previous_hash !== $previous) {
                return "Event #{$event->sequence} does not link to the event before it.";
            }
            if (! hash_equals($event->current_hash, TransactionLedger::hashOf($event, $blueprint->blueprint_uid))) {
                return "Event #{$event->sequence} ({$event->event_type}) was altered after it was recorded.";
            }
            $previous = $event->current_hash;
            $expected++;
        }
        if ($events->count() !== $blueprint->event_count || $previous !== ($blueprint->current_hash ?? TransactionLedger::GENESIS)) {
            return 'The blueprint head does not match its last event.';
        }

        return null;
    }

    private function checkpointProblem(TransactionBlueprint $blueprint, Collection $events): ?string
    {
        $entry = TransactionCheckpointEntry::where('blueprint_id', $blueprint->id)->orderByDesc('checkpoint_id')->first();
        if (! $entry) {
            return null; // not checkpointed yet (recent activity)
        }
        $checkpoint = TransactionCheckpoint::find($entry->checkpoint_id);
        if (! $checkpoint) {
            return 'Its checkpoint record is missing.';
        }
        $verdict = $this->checkpoints->verify($checkpoint);
        if (! $verdict['ok']) {
            return "Checkpoint #{$checkpoint->sequence}: ".implode(' ', $verdict['problems']);
        }
        $pinned = $events->firstWhere('sequence', $entry->event_count);
        if ($pinned === null) {
            return "Events recorded before checkpoint #{$checkpoint->sequence} are missing.";
        }
        if (! hash_equals($entry->head_hash, $pinned->current_hash)) {
            return "The history was rewritten after checkpoint #{$checkpoint->sequence}.";
        }

        return null;
    }

    /** Replay the events into the last recorded state of each tracked value. */
    private function recordedState(Collection $events): array
    {
        $state = ['amounts' => [], 'payments' => [], 'earnings' => [], 'rider_id' => null, 'customer_id' => null];
        foreach ($events as $event) {
            $p = $event->payload ?? [];
            switch ($event->event_type) {
                case 'order_created':
                case 'ledger_opened':
                    $state['customer_id'] = $p['customer_id'] ?? null;
                    foreach (TransactionLedger::AMOUNT_FIELDS as $f) {
                        $state['amounts'][$f] = $p[$f] ?? null;
                    }
                    if ($event->event_type === 'ledger_opened') {
                        $state['rider_id'] = isset($p['rider_id']) ? (int) $p['rider_id'] : null;
                        foreach ($p['payments'] ?? [] as $pay) {
                            $state['payments'][(int) ($pay['payment_id'] ?? 0)] = ['amount' => $pay['amount'] ?? null, 'to' => $pay['to'] ?? null];
                        }
                        foreach ($p['earnings'] ?? [] as $earn) {
                            $state['earnings'][(int) ($earn['earning_id'] ?? 0)] = $earn;
                        }
                    }
                    break;
                case 'order_amounts_changed':
                    $state['amounts'] = array_merge($state['amounts'], $p['to'] ?? []);
                    break;
                case 'order_customer_changed':
                    $state['customer_id'] = $p['to'] ?? null;
                    break;
                case 'payment_verified':
                case 'payment_refund_status':
                case 'payment_status_changed':
                    if (isset($p['payment_id'])) {
                        $state['payments'][(int) $p['payment_id']] = ['amount' => $p['amount'] ?? null, 'to' => $p['to'] ?? null];
                    }
                    break;
                case 'rider_assigned':
                case 'rider_released':
                    $state['rider_id'] = isset($p['rider_id']) ? (int) $p['rider_id'] : null;
                    break;
                case 'earning_posted':
                case 'earning_changed':
                    if (isset($p['earning_id'])) {
                        $state['earnings'][(int) $p['earning_id']] = $p;
                    }
                    break;
            }
        }

        return $state;
    }

    /** @return Collection<int, Payment> */
    private function paymentsFor(Order $order): Collection
    {
        return Payment::query()
            ->where(fn ($q) => $q->where(fn ($o) => $o->where('payable_type', Order::class)->where('payable_id', $order->id))
                ->when($order->group_order_id, fn ($g) => $g->orWhere(fn ($o) => $o->where('payable_type', GroupCheckout::class)->where('payable_id', $order->group_order_id))))
            ->get();
    }

    private function deliveryFor(Order $order): ?Delivery
    {
        return Delivery::where('order_id', $order->id)->first()
            ?? ($order->group_order_id ? Delivery::where('group_checkout_id', $order->group_order_id)->first() : null);
    }
}
