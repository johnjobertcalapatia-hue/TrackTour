<?php

namespace App\Services;

use App\Events\DeliveryStatusChanged;
use App\Models\ActivityLog;
use App\Models\Delivery;
use App\Models\DeliveryPickupStop;
use App\Models\Order;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use InvalidArgumentException;

/**
 * The canonical food-trip path, and how to bring a trip back onto it.
 *
 *   accepted
 *   → for each restaurant, in route order:
 *       arrive (≤ 50 m) → [COD: restaurant confirms payment] → food ready → confirm pickup
 *   → leave for the tourist → arrive at the tourist (≤ 50 m)
 *   → tourist confirms with the delivery photo → [COD: settle the cash]
 *
 * diagnose() works out where a trip really is from the recorded facts, lists
 * every step (done / current / to do) and the one next thing to do, and finds
 * where the stored state disagrees with the path. Three kinds of finding:
 *
 *   fix     a mismatch in DERIVED state, re-synced to the recorded facts
 *           (the rider may apply these; so may the Tourism Office)
 *   reset   REOPEN a recorded step so it must be done again (Tourism Office
 *           only, with a written reason) — e.g. redo an arrival
 *   person  waiting on someone (restaurant payment / food, the rider's
 *           position, the tourist's photo): reported, never forced
 *
 * Nothing here ever marks a step done that was not done: no arrival, pickup,
 * delivery, payment confirmation or food-ready is invented. Every fix and
 * reset is written to the activity log, and the transaction ledger records
 * each changed row.
 */
class TripPathDiagnostics
{
    public const FIX = 'fix';
    public const RESET = 'reset';
    public const PERSON = 'person';
    public const OK = 'ok';

    public const RESET_PICKUP_ARRIVAL = 'redo_pickup_arrival';
    public const RESET_DROPOFF_ARRIVAL = 'redo_dropoff_arrival';

    private const PICKUP_STAGE = ['assigned', 'en_route_pickup', 'arrived_pickup'];
    private const AFTER_PICKUP = ['picked_up', 'in_transit', 'arrived_destination', 'delivered', 'completed'];
    private const AT_DROPOFF = ['arrived_destination', 'delivered', 'completed'];
    private const DELIVERED = ['delivered', 'completed'];

    public function __construct(
        private PickupSequenceService $pickup,
        private PickupDeliveryTransitionService $transitions,
    ) {}

    /**
     * @return array{
     *   delivery_id: int, order_number: ?string, status: string, covered: bool,
     *   path: list<array{key: string, label: string, state: string}>,
     *   next_step: string,
     *   findings: list<array{code: string, kind: string, status: string, title: string, message: string}>,
     *   resets: list<array{action: string, business_id: ?int, label: string, description: string}>,
     *   repaired: list<string>
     * }
     */
    public function diagnose(Delivery $delivery, bool $fix = false, ?User $actor = null, bool $log = true): array
    {
        $repaired = [];
        $findings = [];
        $order = $delivery->primaryOrder();
        $label = $order?->order_number ?? "#{$delivery->id}";
        $isFood = strtolower((string) ($order?->order_type ?? '')) === 'delivery';

        if (! $isFood) {
            return $this->result($delivery, $label, false, [], 'Ride trips are not covered by trip diagnostics yet.', [], [], []);
        }

        // ── Fixes: derived state that disagrees with the recorded facts ──
        $findings = array_merge($findings, $this->fixMissingStops($delivery, $label, $fix, $repaired));
        $findings = array_merge($findings, $this->fixFoodReady($delivery, $fix, $repaired));
        $findings = array_merge($findings, $this->fixArrivalNotReflected($delivery, $label, $fix, $repaired));
        $findings = array_merge($findings, $this->fixPickupsDone($delivery, $label, $fix, $repaired));
        $delivery->refresh();

        // ── The path, from the (possibly re-synced) facts ──
        [$path, $current] = $this->path($delivery);

        // Moved past the pickups without confirming them: never "fixed" by
        // pretending the food was collected — the Tourism Office reviews it.
        $status = $this->status($delivery);
        $stops = $this->stops($delivery);
        if (in_array($status, self::AFTER_PICKUP, true) && $stops->isNotEmpty() && ! $this->pickup->allConfirmed($delivery)) {
            $findings[] = $this->finding('pickups_skipped', self::PERSON, 'needs_action', 'Delivery',
                "Order {$label} moved on before every restaurant pickup was confirmed. The Tourism Office must review this trip.");
        }

        $guidance = $this->guidance($delivery, $current, $label);
        if ($guidance !== null) {
            $findings[] = $guidance;
        }

        // (The rider's own diagnostics log these as rider_self_repair.)
        foreach ($log ? $repaired : [] as $what) {
            ActivityLog::create([
                'user_id' => $actor?->id,
                'action' => 'trip_diagnostics.fix',
                'type' => 'delivery',
                'description' => "Delivery #{$delivery->id} ({$label}): {$what}",
                'model_type' => Delivery::class,
                'model_id' => $delivery->id,
            ]);
        }

        return $this->result($delivery, $label, true, $path, $current['next'] ?? 'This delivery is complete.', $findings, $this->availableResets($delivery), $repaired);
    }

    /**
     * Tourism Office only: reopen a recorded step so it must be done again.
     * The previous record is kept in the activity log.
     *
     * @throws InvalidArgumentException when the step cannot be reopened
     */
    public function reset(Delivery $delivery, string $action, ?int $businessId, string $reason, User $admin): array
    {
        if (mb_strlen(trim($reason)) < 10) {
            throw new InvalidArgumentException('Write the reason for the reset (at least 10 characters).');
        }

        $result = DB::transaction(function () use ($delivery, $action, $businessId) {
            $locked = Delivery::lockForUpdate()->findOrFail($delivery->id);
            $status = $this->status($locked);

            if ($action === self::RESET_PICKUP_ARRIVAL) {
                if (! in_array($status, self::PICKUP_STAGE, true)) {
                    throw new InvalidArgumentException('A restaurant arrival can only be redone while the trip is at the pickup stage.');
                }
                $stop = DeliveryPickupStop::where('delivery_id', $locked->id)->where('business_id', (int) $businessId)->lockForUpdate()->first();
                if (! $stop || $stop->arrived_at === null) {
                    throw new InvalidArgumentException('There is no recorded arrival at this restaurant to redo.');
                }
                if ($this->pickup->stopConfirmed($locked, $stop)) {
                    throw new InvalidArgumentException('This restaurant pickup is already confirmed; its arrival cannot be redone.');
                }

                $previous = ['arrived_at' => $stop->arrived_at?->toIso8601String(), 'arrival_evidence' => $stop->arrival_evidence];
                $stop->update(['arrived_at' => null, 'arrival_evidence' => null]);

                // With no other restaurant reached, the trip is back on the way.
                $anyArrived = DeliveryPickupStop::where('delivery_id', $locked->id)->whereNotNull('arrived_at')->exists();
                if (! $anyArrived && $status === 'arrived_pickup') {
                    $locked->update(['status' => 'en_route_pickup', 'arrived_pickup_at' => null]);
                }

                return ['previous' => $previous, 'old_status' => $status, 'new_status' => $this->status($locked->fresh()),
                    'what' => 'Reopened the arrival at '.($stop->business?->business_name ?? "business #{$businessId}").': the rider must confirm arrival again (within the pickup radius).'];
            }

            if ($action === self::RESET_DROPOFF_ARRIVAL) {
                if ($status !== 'arrived_destination') {
                    throw new InvalidArgumentException('The arrival at the tourist can only be redone before the delivery is confirmed.');
                }
                $previous = ['arrived_destination_at' => $locked->arrived_destination_at?->toIso8601String()];
                $locked->update(['status' => 'in_transit', 'arrived_destination_at' => null]);

                return ['previous' => $previous, 'old_status' => $status, 'new_status' => 'in_transit',
                    'what' => 'Reopened the arrival at the tourist: the rider must tap "I\'ve Arrived" again (within the drop-off radius).'];
            }

            throw new InvalidArgumentException('Unknown reset.');
        });

        ActivityLog::create([
            'user_id' => $admin->id,
            'action' => 'trip_diagnostics.reset',
            'type' => 'delivery',
            // The previous record is kept here (the step itself is cleared).
            'description' => "Delivery #{$delivery->id}: {$result['what']} Reason: ".trim($reason)
                .' | Previous: '.json_encode($result['previous'], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
            'model_type' => Delivery::class,
            'model_id' => $delivery->id,
        ]);

        if ($result['old_status'] !== $result['new_status']) {
            DeliveryStatusChanged::dispatch($delivery->fresh()->load('order.business'), $result['old_status'], $result['new_status']);
        }

        return $this->diagnose($delivery->fresh(), false, $admin) + ['reset' => $result['what']];
    }

    // ─────────────────────────── fixes ───────────────────────────

    /** @param list<string> $repaired */
    private function fixMissingStops(Delivery $delivery, string $label, bool $fix, array &$repaired): array
    {
        if (! in_array($this->status($delivery), self::PICKUP_STAGE, true)
            || DeliveryPickupStop::where('delivery_id', $delivery->id)->exists()
            || app(PurchasingCashService::class)->routeStops($delivery)->isEmpty()) {
            return [];
        }
        if ($fix) {
            $this->pickup->ensureStops($delivery);
            if (DeliveryPickupStop::where('delivery_id', $delivery->id)->exists()) {
                $repaired[] = "Rebuilt the restaurant pickup list for order {$label}.";

                return [$this->finding('stops_missing', self::FIX, 'fixed', 'Delivery', 'The restaurant pickup list was missing and has been rebuilt.')];
            }
        }

        return [$this->finding('stops_missing', self::FIX, 'needs_action', 'Delivery', 'The restaurant pickup list is missing. Tap "Fix problems".')];
    }

    /**
     * The restaurant marked its order READY but the items stayed behind, so
     * the pickup gate (which reads the items) says "still preparing" forever
     * (TT-04544). The order is the restaurant's own declaration; its items are
     * carried to ready. Another restaurant's items are never touched.
     *
     * @param  list<string>  $repaired
     */
    private function fixFoodReady(Delivery $delivery, bool $fix, array &$repaired): array
    {
        if (! in_array($this->status($delivery), self::PICKUP_STAGE, true)) {
            return [];
        }
        $findings = [];
        foreach ($this->stops($delivery) as $stop) {
            if ($this->pickup->stopConfirmed($delivery, $stop)) {
                continue;
            }
            $order = $stop->order_id ? Order::find($stop->order_id) : $delivery->primaryOrder();
            if (! $order || $order->status !== 'ready' || (int) $order->business_id !== (int) $stop->business_id
                || $this->pickup->businessReady($delivery, (int) $stop->business_id)) {
                continue;
            }
            $name = $stop->business?->business_name ?? 'The restaurant';
            if ($fix) {
                $order->markOwnItemsReady();
                $repaired[] = "{$name} had marked order {$order->order_number} ready but its items were still \"preparing\"; the items now match.";
                $findings[] = $this->finding('food_ready_mismatch', self::FIX, 'fixed', 'Food ready',
                    "{$name} had marked the order ready, but the food items had not followed, so Confirm Pick Up stayed locked. Fixed — you can confirm the pickup now.");

                continue;
            }
            $findings[] = $this->finding('food_ready_mismatch', self::FIX, 'needs_action', 'Food ready',
                "{$name} marked the order ready, but its food items did not follow, so Confirm Pick Up stays locked. Tap \"Fix problems\".");
        }

        return $findings;
    }

    /** An arrival is recorded at a restaurant but the trip status never moved to "arrived". */
    private function fixArrivalNotReflected(Delivery $delivery, string $label, bool $fix, array &$repaired): array
    {
        if (! in_array($this->status($delivery), ['assigned', 'en_route_pickup'], true)
            || ! DeliveryPickupStop::where('delivery_id', $delivery->id)->whereNotNull('arrived_at')->exists()) {
            return [];
        }
        if ($fix) {
            $moved = DB::transaction(function () use ($delivery) {
                $locked = Delivery::lockForUpdate()->find($delivery->id);

                return $locked ? $this->transitions->arriveAtPickup($locked) : null;
            });
            if ($moved) {
                DeliveryStatusChanged::dispatch($delivery->fresh()->load('order.business'), $moved['old_status'], $moved['new_status']);
                $repaired[] = "Order {$label}: your restaurant arrival was saved but the trip had not moved to \"arrived\"; it now has.";

                return [$this->finding('arrival_not_reflected', self::FIX, 'fixed', 'Arrival', 'Your arrival was saved but the trip had not moved on. It now shows you at the restaurant.')];
            }
        }

        return [$this->finding('arrival_not_reflected', self::FIX, 'needs_action', 'Arrival', 'Your arrival was saved but the trip did not move on. Tap "Fix problems".')];
    }

    /** Every restaurant pickup confirmed, but the trip is still at the pickup stage. */
    private function fixPickupsDone(Delivery $delivery, string $label, bool $fix, array &$repaired): array
    {
        if ($this->status($delivery) !== 'arrived_pickup' || $this->stops($delivery)->isEmpty() || ! $this->pickup->allConfirmed($delivery)) {
            return [];
        }
        if ($fix) {
            $moved = DB::transaction(function () use ($delivery) {
                $locked = Delivery::lockForUpdate()->find($delivery->id);

                return $locked ? $this->transitions->pickUp($locked) : null;
            });
            if ($moved) {
                DeliveryStatusChanged::dispatch($delivery->fresh()->load('order.business'), $moved['old_status'], $moved['new_status']);
                $repaired[] = "Moved order {$label} on to delivery: every restaurant pickup was already confirmed.";

                return [$this->finding('pickups_done_not_advanced', self::FIX, 'fixed', 'Delivery', 'All pickups were confirmed but the trip did not move on. It is now on the way to the tourist.')];
            }
        }

        return [$this->finding('pickups_done_not_advanced', self::FIX, 'needs_action', 'Delivery', 'All pickups are confirmed but the trip has not moved on. Tap "Fix problems".')];
    }

    // ─────────────────────────── path ───────────────────────────

    /** @return array{0: list<array{key: string, label: string, state: string}>, 1: ?array{key: string, next: string, business_id: ?int}} */
    private function path(Delivery $delivery): array
    {
        $status = $this->status($delivery);
        $isCod = app(NearestRiderService::class)->isCodDelivery($delivery);
        $steps = [['key' => 'accepted', 'label' => 'Rider accepted the delivery', 'done' => $delivery->rider_id !== null, 'next' => 'Wait for a rider to accept.', 'business_id' => null]];

        foreach ($this->stops($delivery) as $stop) {
            $bid = (int) $stop->business_id;
            $name = $stop->business?->business_name ?? 'the restaurant';
            $collected = $this->pickup->stopConfirmed($delivery, $stop);
            $steps[] = ['key' => "arrive:{$bid}", 'label' => "Arrive at {$name}", 'done' => $collected || $stop->arrived_at !== null, 'next' => "Head to {$name} and confirm your arrival.", 'business_id' => $bid];
            if ($isCod) {
                $steps[] = ['key' => "payment:{$bid}", 'label' => "{$name} confirms your payment", 'done' => $collected || $this->pickup->paymentConfirmation($delivery, $bid) !== false, 'next' => "Pay {$name} and wait for it to confirm \"Payment received\".", 'business_id' => $bid];
            }
            $steps[] = ['key' => "ready:{$bid}", 'label' => "Food ready at {$name}", 'done' => $collected || $this->pickup->businessReady($delivery, $bid), 'next' => "{$name} is still preparing your order. Confirm Pick Up unlocks when it marks the food ready.", 'business_id' => $bid];
            $steps[] = ['key' => "pickup:{$bid}", 'label' => "Confirm pickup at {$name}", 'done' => $collected, 'next' => "The food at {$name} is ready. Tap Confirm Pick Up.", 'business_id' => $bid];
        }

        $steps[] = ['key' => 'depart', 'label' => 'Leave for the tourist', 'done' => in_array($status, self::AFTER_PICKUP, true), 'next' => 'All food is collected. Head to the tourist.', 'business_id' => null];
        $steps[] = ['key' => 'arrive_dropoff', 'label' => 'Arrive at the tourist', 'done' => in_array($status, self::AT_DROPOFF, true), 'next' => 'Go to the delivery address and tap "I\'ve Arrived".', 'business_id' => null];
        $steps[] = ['key' => 'confirm_delivery', 'label' => 'Tourist confirms with the delivery photo', 'done' => in_array($status, self::DELIVERED, true), 'next' => 'Take the delivery photo with the tourist to finish the delivery.', 'business_id' => null];
        if ($isCod) {
            $steps[] = ['key' => 'settle', 'label' => 'Settle the cash', 'done' => $status === 'completed', 'next' => 'Settle the cash collected to complete the delivery.', 'business_id' => null];
        }

        $cancelled = $status === 'cancelled';
        $current = null;
        $path = [];
        foreach ($steps as $step) {
            $state = $step['done'] ? 'done' : ($cancelled ? 'cancelled' : ($current === null ? 'current' : 'todo'));
            if ($state === 'current') {
                $current = ['key' => $step['key'], 'next' => $step['next'], 'business_id' => $step['business_id']];
            }
            $path[] = ['key' => $step['key'], 'label' => $step['label'], 'state' => $state];
        }

        return [$path, $cancelled ? ['key' => 'cancelled', 'next' => 'This delivery was cancelled.', 'business_id' => null] : $current];
    }

    /** What the rider must do now (a rule, not a bug). */
    private function guidance(Delivery $delivery, ?array $current, string $label): ?array
    {
        if ($current === null) {
            return $this->finding('next_step', self::OK, 'ok', 'Delivery', "Order {$label} is complete.");
        }
        if ($current['key'] === 'cancelled') {
            return $this->finding('next_step', self::OK, 'ok', 'Delivery', "Order {$label} was cancelled.");
        }

        [$kind] = explode(':', $current['key']) + [null];
        $riderId = (int) $delivery->rider_id;

        if (in_array($kind, ['arrive', 'payment', 'ready', 'pickup'], true)) {
            $stop = $this->stops($delivery)->firstWhere('business_id', $current['business_id']);
            $name = $stop?->business?->business_name ?? 'the restaurant';
            $radius = (float) config('tracking.pickup_radius_meters', 50);
            $location = $riderId ? $this->pickup->latestRiderLocation($riderId) : null;
            $distance = ($location && $stop && $stop->pickup_latitude !== null && $stop->pickup_longitude !== null)
                ? $this->pickup->distanceMeters((float) $location['latitude'], (float) $location['longitude'], (float) $stop->pickup_latitude, (float) $stop->pickup_longitude)
                : null;

            if ($distance !== null && $distance > $radius) {
                return $this->finding('next_step', self::PERSON, 'needs_action', 'Delivery',
                    "Go back to {$name}: you are {$this->away($distance)} away and must be within ".((int) $radius).' m to '.($stop?->arrived_at ? 'confirm the pickup' : 'confirm your arrival').'.');
            }

            return match ($kind) {
                'payment' => $this->finding('next_step', self::PERSON, 'needs_action', 'Delivery', $current['next']),
                'ready' => $this->finding('next_step', self::PERSON, 'ok', 'Delivery', $current['next']),
                default => $this->finding('next_step', self::OK, 'ok', 'Delivery', $current['next']),
            };
        }

        if ($kind === 'arrive_dropoff' && $riderId && $delivery->delivery_latitude !== null && $delivery->delivery_longitude !== null) {
            $location = $this->pickup->latestRiderLocation($riderId);
            $maxAge = (int) config('tracking.proof_location_max_age_seconds', 120);
            if (! $location || ! $location['recorded_at'] || $location['recorded_at']->lt(now()->subSeconds($maxAge))) {
                return $this->finding('next_step', self::PERSON, 'needs_action', 'Delivery', 'We need your current location. Keep the map open with location on, then tap "I\'ve Arrived" at the delivery address.');
            }
            $distance = $this->pickup->distanceMeters((float) $location['latitude'], (float) $location['longitude'], (float) $delivery->delivery_latitude, (float) $delivery->delivery_longitude);
            $radius = (float) config('tracking.dropoff_radius_meters', 50);
            if ($distance > $radius) {
                return $this->finding('next_step', self::PERSON, 'ok', 'Delivery', "Head to the tourist: you are {$this->away($distance)} away; \"I've Arrived\" unlocks within ".((int) $radius).' m.');
            }
        }

        return $this->finding('next_step', self::OK, 'ok', 'Delivery', $current['next']);
    }

    /** Steps the Tourism Office could reopen right now. */
    private function availableResets(Delivery $delivery): array
    {
        $status = $this->status($delivery);
        $resets = [];
        if (in_array($status, self::PICKUP_STAGE, true)) {
            foreach ($this->stops($delivery) as $stop) {
                if ($stop->arrived_at !== null && ! $this->pickup->stopConfirmed($delivery, $stop)) {
                    $name = $stop->business?->business_name ?? "business #{$stop->business_id}";
                    $resets[] = ['action' => self::RESET_PICKUP_ARRIVAL, 'business_id' => (int) $stop->business_id,
                        'label' => "Redo arrival at {$name}", 'description' => 'Clears the recorded arrival; the rider must confirm arrival again within the pickup radius.'];
                }
            }
        }
        if ($status === 'arrived_destination') {
            $resets[] = ['action' => self::RESET_DROPOFF_ARRIVAL, 'business_id' => null,
                'label' => 'Redo arrival at the tourist', 'description' => 'Moves the trip back to "on the way"; the rider must tap "I\'ve Arrived" again within the drop-off radius.'];
        }

        return $resets;
    }

    // ─────────────────────────── helpers ───────────────────────────

    private function stops(Delivery $delivery)
    {
        return DeliveryPickupStop::where('delivery_id', $delivery->id)->with('business')->orderBy('sequence')->get();
    }

    private function status(Delivery $delivery): string
    {
        return (string) ($delivery->status->value ?? $delivery->status);
    }

    private function away(float $meters): string
    {
        return $meters < 1000 ? ((int) round($meters)).' m' : number_format($meters / 1000, 1).' km';
    }

    private function finding(string $code, string $kind, string $status, string $title, string $message): array
    {
        return compact('code', 'kind', 'status', 'title', 'message');
    }

    private function result(Delivery $delivery, string $label, bool $covered, array $path, string $next, array $findings, array $resets, array $repaired): array
    {
        return [
            'delivery_id' => $delivery->id,
            'order_number' => $label,
            'status' => $this->status($delivery),
            'covered' => $covered,
            'path' => $path,
            'next_step' => $next,
            'findings' => $findings,
            'resets' => $resets,
            'repaired' => $repaired,
        ];
    }
}
