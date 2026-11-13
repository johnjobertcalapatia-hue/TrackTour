<?php

namespace App\Services\Integrity;

use App\Models\Delivery;
use App\Models\GroupCheckout;
use App\Models\Order;
use App\Models\Payment;
use App\Models\Refund;
use App\Models\TransactionBlueprint;
use App\Models\TransactionEvent;
use BackedEnum;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\QueryException;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Secure transaction architecture, Stage 2 — the shared Transaction Blueprint
 * and append-only Event Ledger for food delivery and ride hailing.
 *
 *   current_hash = SHA256(previous_hash + "\n" + canonical(event fields))
 *
 * Events are written by authorised backend operations only (model observers
 * on the canonical records), inside the same database transaction as the
 * change they describe, so a rolled-back change leaves no event behind.
 * Payloads carry references and amounts, never contact details.
 */
class TransactionLedger
{
    public const GENESIS = '0000000000000000000000000000000000000000000000000000000000000000';

    public const SCHEMA_VERSION = 1;

    /** Order fields whose value is part of the financial record. */
    public const AMOUNT_FIELDS = ['subtotal', 'delivery_fee', 'rider_tip', 'system_fee', 'total'];

    public static function transactionType(Order $order): ?string
    {
        return match ($order->order_type) {
            'delivery' => TransactionBlueprint::TYPE_FOOD,
            'transport' => TransactionBlueprint::TYPE_RIDE,
            default => null, // pickup / dine-in / POS orders are not delivery transactions
        };
    }

    /**
     * Append one event to the order's blueprint (opening the blueprint first
     * when needed). Returns null for orders outside the ledger's scope.
     */
    public function record(Order $order, string $eventType, array $payload = [], ?Model $source = null): ?TransactionEvent
    {
        if (! config('integrity.enabled', true)) {
            return null;
        }
        $kind = self::transactionType($order);
        if ($kind === null) {
            return null;
        }

        return DB::transaction(function () use ($order, $kind, $eventType, $payload, $source) {
            $blueprint = $this->blueprintFor($order, $kind, $eventType);

            return $this->append($blueprint, $eventType, $payload, $source);
        });
    }

    /** Record the same event on every order a record belongs to. */
    public function recordForOrders(iterable $orders, string $eventType, array $payload = [], ?Model $source = null): void
    {
        foreach ($orders as $order) {
            $this->record($order, $eventType, $payload, $source);
        }
    }

    public function blueprintFor(Order $order, ?string $kind = null, ?string $firstEvent = null): TransactionBlueprint
    {
        $existing = TransactionBlueprint::where('order_id', $order->id)->first();
        if ($existing) {
            return $existing;
        }

        try {
            $blueprint = TransactionBlueprint::create([
                'blueprint_uid' => (string) Str::uuid(),
                'transaction_type' => $kind ?? self::transactionType($order) ?? TransactionBlueprint::TYPE_FOOD,
                'order_id' => $order->id,
                'customer_id' => $order->user_id,
                'integrity_status' => TransactionBlueprint::STATUS_PENDING,
                'legacy' => $firstEvent !== 'order_created',
                'schema_version' => self::SCHEMA_VERSION,
            ]);
        } catch (QueryException $e) {
            // Another request opened it first (UNIQUE order_id).
            return TransactionBlueprint::where('order_id', $order->id)->firstOrFail();
        }

        // Opened after the order already existed: snapshot what is known now so
        // later events have a baseline. The verifier reports such histories as
        // incomplete (FLAG) rather than pretending they are whole.
        if ($blueprint->legacy) {
            $this->append($blueprint, 'ledger_opened', self::legacyBaseline($order), $order);
        }

        return $blueprint;
    }

    private function append(TransactionBlueprint $blueprint, string $eventType, array $payload, ?Model $source): TransactionEvent
    {
        // Serialise appends per blueprint: the head is read and advanced under a row lock.
        $locked = TransactionBlueprint::whereKey($blueprint->id)->lockForUpdate()->firstOrFail();
        $user = auth()->user();

        $fields = [
            'schema_version' => self::SCHEMA_VERSION,
            'blueprint_uid' => $locked->blueprint_uid,
            'sequence' => $locked->event_count + 1,
            'event_type' => $eventType,
            'actor_id' => $user?->id,
            'actor_role' => $user?->role ?? 'system',
            'source_type' => $source ? class_basename($source) : null,
            'source_id' => $source?->getKey(),
            'payload' => CanonicalJson::normalize($payload),
            'recorded_at_ms' => (int) floor(microtime(true) * 1000),
        ];
        $previous = $locked->current_hash ?? self::GENESIS;
        $hash = self::hash($previous, $fields);

        $event = TransactionEvent::create([
            'blueprint_id' => $locked->id,
            'sequence' => $fields['sequence'],
            'event_type' => $eventType,
            'actor_id' => $fields['actor_id'],
            'actor_role' => $fields['actor_role'],
            'source_type' => $fields['source_type'],
            'source_id' => $fields['source_id'],
            'payload' => $fields['payload'],
            'recorded_at_ms' => $fields['recorded_at_ms'],
            'previous_hash' => $previous,
            'current_hash' => $hash,
            'schema_version' => self::SCHEMA_VERSION,
        ]);

        $update = ['event_count' => $fields['sequence'], 'current_hash' => $hash];
        if ($eventType === 'rider_assigned' && isset($payload['rider_id'])) {
            $update['rider_id'] = $payload['rider_id'];
        }
        if ($eventType === 'rider_released') {
            $update['rider_id'] = null;
        }
        if ($locked->finalized_at === null && self::isFinalising($eventType, $payload)) {
            $update['finalized_at'] = now();
        }
        $locked->forceFill($update)->save();
        $blueprint->setRawAttributes($locked->getAttributes(), true);

        return $event;
    }

    /** Recompute an event's hash from its stored fields (used by the verifier). */
    public static function hashOf(TransactionEvent $event, string $blueprintUid): string
    {
        return self::hash($event->previous_hash, [
            'schema_version' => $event->schema_version,
            'blueprint_uid' => $blueprintUid,
            'sequence' => $event->sequence,
            'event_type' => $event->event_type,
            'actor_id' => $event->actor_id,
            'actor_role' => $event->actor_role,
            'source_type' => $event->source_type,
            'source_id' => $event->source_id,
            'payload' => $event->payload ?? [],
            'recorded_at_ms' => $event->recorded_at_ms,
        ]);
    }

    public static function hash(string $previous, array $fields): string
    {
        return hash('sha256', $previous."\n".CanonicalJson::encode($fields));
    }

    private static function isFinalising(string $eventType, array $payload): bool
    {
        $to = $payload['to'] ?? null;

        return ($eventType === 'delivery_status_changed' && in_array($to, ['delivered', 'completed'], true))
            || ($eventType === 'order_status_changed' && $to === 'completed');
    }

    // ------------------------------------------------------------------
    // Record → order resolution and snapshots
    // ------------------------------------------------------------------

    public static function orderSnapshot(Order $order): array
    {
        $snapshot = [
            'order_number' => $order->order_number,
            'order_type' => $order->order_type,
            'status' => self::scalar($order->status),
            'payment_method' => $order->payment_method,
            'payment_status' => $order->payment_status,
            'customer_id' => $order->user_id,
            'business_id' => $order->business_id,
            'group_order_id' => $order->group_order_id,
        ];
        // Amounts the creating code did not set were filled by column defaults
        // in the database: read them back so the snapshot is what was stored.
        $missing = array_filter(self::AMOUNT_FIELDS, fn ($f) => ! array_key_exists($f, $order->getAttributes()));
        $stored = $missing && $order->exists ? (array) Order::withTrashed()->whereKey($order->id)->first($missing)?->getAttributes() : [];
        foreach (self::AMOUNT_FIELDS as $field) {
            $snapshot[$field] = self::money(array_key_exists($field, $order->getAttributes()) ? $order->getAttribute($field) : ($stored[$field] ?? null));
        }

        return $snapshot;
    }

    /**
     * Baseline for a ledger opened on an existing order: the order snapshot
     * plus the rider, payments and earnings as they stand now, so they are
     * not mistaken for unrecorded edits later.
     */
    public static function legacyBaseline(Order $order): array
    {
        $delivery = Delivery::where('order_id', $order->id)->first()
            ?? ($order->group_order_id ? Delivery::where('group_checkout_id', $order->group_order_id)->first() : null);
        $payments = Payment::query()
            ->where(fn ($q) => $q->where(fn ($o) => $o->where('payable_type', Order::class)->where('payable_id', $order->id))
                ->when($order->group_order_id, fn ($g) => $g->orWhere(fn ($o) => $o->where('payable_type', GroupCheckout::class)->where('payable_id', $order->group_order_id))))
            ->orderBy('id')->get();

        return self::orderSnapshot($order) + [
            // The legacy cutoff: nothing before this moment is in the history,
            // so missing earlier events mean "not recorded", never "fraud".
            'ledger_cutoff' => now()->toIso8601String(),
            'rider_id' => $delivery?->rider_id ? (int) $delivery->rider_id : null,
            'payments' => $payments->map(fn (Payment $p) => ['payment_id' => $p->id, 'amount' => self::money($p->amount), 'to' => $p->status])->all(),
            'earnings' => \App\Models\RiderEarning::where('order_id', $order->id)->orderBy('id')->get()
                ->map(fn ($e) => ['earning_id' => $e->id, 'rider_id' => (int) $e->rider_id, 'total_earning' => self::money($e->total_earning), 'status' => $e->status])->all(),
        ];
    }

    /** @return Collection<int, Order> */
    public static function ordersForDelivery(Delivery $delivery): Collection
    {
        if ($delivery->order_id) {
            return Order::withTrashed()->whereKey($delivery->order_id)->get();
        }

        return $delivery->group_checkout_id
            ? Order::withTrashed()->where('group_order_id', $delivery->group_checkout_id)->get()
            : collect();
    }

    /** @return Collection<int, Order> */
    public static function ordersForPayment(Payment $payment): Collection
    {
        return match ($payment->payable_type) {
            Order::class => Order::withTrashed()->whereKey($payment->payable_id)->get(),
            GroupCheckout::class => Order::withTrashed()->where('group_order_id', $payment->payable_id)->get(),
            default => collect(),
        };
    }

    /** @return Collection<int, Order> */
    public static function ordersForRefund(Refund $refund): Collection
    {
        if ($refund->order_id) {
            return Order::withTrashed()->whereKey($refund->order_id)->get();
        }
        $payment = $refund->payment_id ? Payment::find($refund->payment_id) : null;

        return $payment ? self::ordersForPayment($payment) : collect();
    }

    public static function money(mixed $value): ?string
    {
        return $value === null ? null : number_format((float) $value, 2, '.', '');
    }

    public static function scalar(mixed $value): mixed
    {
        return $value instanceof BackedEnum ? $value->value : $value;
    }
}
