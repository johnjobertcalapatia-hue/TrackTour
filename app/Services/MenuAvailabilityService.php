<?php

namespace App\Services;

use App\Models\MenuAvailabilityEvent;
use App\Models\Offering;
use App\Models\OfferingVariation;
use App\Services\Integrity\TransactionLedger;
use Illuminate\Support\Facades\DB;

/**
 * Manual menu availability (Stage 3). Availability is a Yes/No flag set by
 * the business owner or staff — never an inventory quantity.
 *
 * This service is the authoritative writer: it saves the item and appends
 * the history event in ONE database transaction. Appends to a business's
 * SHA-256 chain are serialised by locking that business's chain head row,
 * with UNIQUE (business_id, sequence) as the backstop. While the service is
 * writing, the fallback observer stays silent, so a change is never recorded
 * twice; the observer only records writes that bypass the service.
 */
class MenuAvailabilityService
{
    public const SCHEMA_VERSION = 1;

    private static int $active = 0;

    public static function isActive(): bool
    {
        return self::$active > 0;
    }

    /** Update an existing item (any attributes); records an event when availability changes. */
    public function update(Offering $offering, array $attributes, string $source, ?string $reason = null): Offering
    {
        return $this->run(function () use ($offering, $attributes, $source, $reason) {
            // Read the committed value under a row lock: concurrent toggles and
            // checkouts of this item are serialised here.
            $current = Offering::withTrashed()->whereKey($offering->id)->lockForUpdate()->value('is_available');
            $offering->fill($attributes)->save();
            $new = (bool) $offering->is_available;
            if ($current === null || (bool) $current !== $new) {
                $this->record($offering, null, $current === null ? null : (bool) $current, $new, $source, $reason);
            }

            return $offering;
        });
    }

    /** Apply the same change to several items (bulk actions), item by item, in one transaction. */
    public function bulk(iterable $offerings, array $attributes, string $source): int
    {
        return $this->run(function () use ($offerings, $attributes, $source) {
            $count = 0;
            foreach ($offerings as $offering) {
                $this->update($offering, $attributes, $source);
                $count++;
            }

            return $count;
        });
    }

    /** Create an item through $creator (which returns the new Offering) and record its initial availability. */
    public function create(callable $creator, string $source): ?Offering
    {
        return $this->run(function () use ($creator, $source) {
            $offering = $creator();
            if ($offering instanceof Offering) {
                $this->record($offering, null, null, $this->storedAvailability($offering), $source, null);
            }

            return $offering;
        });
    }

    /** Save a new, unsaved item (e.g. a duplicate) and record its initial availability. */
    public function saveNew(Offering $offering, string $source): Offering
    {
        return $this->run(function () use ($offering, $source) {
            $offering->save();
            $this->record($offering, null, null, $this->storedAvailability($offering), $source, null);

            return $offering;
        });
    }

    public function updateVariation(OfferingVariation $variation, array $attributes, string $source): OfferingVariation
    {
        return $this->run(function () use ($variation, $attributes, $source) {
            $current = OfferingVariation::whereKey($variation->id)->lockForUpdate()->value('is_available');
            $variation->fill($attributes)->save();
            $new = (bool) $variation->is_available;
            if ($current === null || (bool) $current !== $new) {
                $this->record($variation->offering()->withTrashed()->first(), $variation, $current === null ? null : (bool) $current, $new, $source, null);
            }

            return $variation;
        });
    }

    public function createVariation(callable $creator, string $source): OfferingVariation
    {
        return $this->run(function () use ($creator, $source) {
            /** @var OfferingVariation $variation */
            $variation = $creator();
            $new = (bool) ($variation->is_available ?? OfferingVariation::whereKey($variation->id)->value('is_available'));
            $this->record($variation->offering()->withTrashed()->first(), $variation, null, $new, $source, null);

            return $variation;
        });
    }

    /**
     * Fallback for a write that bypassed the service (called by the observer).
     * Runs in its own transaction; the item itself was already saved.
     */
    public function recordUnrouted(Offering|OfferingVariation $model, ?bool $previous, bool $new): void
    {
        DB::transaction(function () use ($model, $previous, $new) {
            $offering = $model instanceof Offering ? $model : $model->offering()->withTrashed()->first();
            $this->record($offering, $model instanceof OfferingVariation ? $model : null, $previous, $new, 'unrouted', null);
        });
    }

    /**
     * Re-verify a business's availability chain.
     *
     * @return list<string> problems (empty = intact)
     */
    public function verifyChain(int $businessId): array
    {
        $problems = [];
        $previous = TransactionLedger::GENESIS;
        $expected = 1;
        foreach (MenuAvailabilityEvent::where('business_id', $businessId)->orderBy('sequence')->cursor() as $event) {
            if ($event->sequence !== $expected) {
                $problems[] = "Availability event #{$expected} is missing.";
                break;
            }
            if ($event->previous_hash !== $previous) {
                $problems[] = "Availability event #{$event->sequence} does not link to the one before it.";
                break;
            }
            if (! hash_equals($event->current_hash, TransactionLedger::hash($previous, self::fieldsOf($event)))) {
                $problems[] = "Availability event #{$event->sequence} was altered after it was recorded.";
                break;
            }
            $previous = $event->current_hash;
            $expected++;
        }
        $head = DB::table('menu_availability_chains')->where('business_id', $businessId)->first();
        if ($problems === [] && $head && ((int) $head->last_sequence !== $expected - 1 || $head->head_hash !== $previous)) {
            $problems[] = 'The availability chain head does not match its last event.';
        }

        return $problems;
    }

    // ------------------------------------------------------------------

    private function run(callable $fn): mixed
    {
        self::$active++;
        try {
            return DB::transaction($fn);
        } finally {
            self::$active--;
        }
    }

    private function record(?Offering $offering, ?OfferingVariation $variation, ?bool $previous, bool $new, string $source, ?string $reason): void
    {
        if ($offering === null) {
            return;
        }
        $businessId = (int) $offering->business_id;

        // Serialise appends for this business: create the head row once, then
        // lock it. Two concurrent changes can never claim the same sequence.
        DB::table('menu_availability_chains')->insertOrIgnore([
            'business_id' => $businessId, 'last_sequence' => 0, 'head_hash' => TransactionLedger::GENESIS, 'updated_at' => now(),
        ]);
        $chain = DB::table('menu_availability_chains')->where('business_id', $businessId)->lockForUpdate()->first();

        $user = auth()->user();
        $event = new MenuAvailabilityEvent([
            'business_id' => $businessId,
            'sequence' => (int) $chain->last_sequence + 1,
            'offering_id' => $offering->id,
            'offering_variation_id' => $variation?->id,
            'item_name' => $variation ? "{$offering->name} — {$variation->name}" : (string) $offering->name,
            'previous_available' => $previous,
            'new_available' => $new,
            'actor_id' => $user?->id,
            'actor_role' => $user?->role ?? 'system',
            'source' => $source,
            'reason' => $reason !== null ? mb_substr($reason, 0, 255) : null,
            'recorded_at_ms' => (int) floor(microtime(true) * 1000),
            'previous_hash' => $chain->head_hash,
        ]);
        $event->current_hash = TransactionLedger::hash($chain->head_hash, self::fieldsOf($event));
        $event->save();

        DB::table('menu_availability_chains')->where('business_id', $businessId)->update([
            'last_sequence' => $event->sequence, 'head_hash' => $event->current_hash, 'updated_at' => now(),
        ]);
    }

    private static function fieldsOf(MenuAvailabilityEvent $event): array
    {
        return [
            'schema_version' => self::SCHEMA_VERSION,
            'business_id' => $event->business_id,
            'sequence' => $event->sequence,
            'offering_id' => $event->offering_id,
            'offering_variation_id' => $event->offering_variation_id,
            'item_name' => $event->item_name,
            'previous_available' => $event->previous_available,
            'new_available' => $event->new_available,
            'actor_id' => $event->actor_id,
            'actor_role' => $event->actor_role,
            'source' => $event->source,
            'reason' => $event->reason,
            'recorded_at_ms' => $event->recorded_at_ms,
        ];
    }

    private function storedAvailability(Offering $offering): bool
    {
        return (bool) ($offering->getAttribute('is_available') ?? Offering::withTrashed()->whereKey($offering->id)->value('is_available'));
    }
}
