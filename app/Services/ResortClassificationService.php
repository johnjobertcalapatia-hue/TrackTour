<?php

namespace App\Services;

use App\Models\Business;
use App\Models\ResortFacility;
use App\Models\ResortType;
use Illuminate\Support\Facades\DB;

/**
 * Resort classification (Stage 1 of the dynamic resort system, see
 * docs/resort-reservation-architecture.md): multiple resort types and a
 * structured facility list per resort business.
 *
 * Also backfills from the free-form details captured at registration
 * (business_details: resort_type, swimming_pool, beach_access, parking,
 * number_of_cottages). Backfill only adds missing links, never removes.
 */
class ResortClassificationService
{
    /** Seeded catalogue (slug => [name, description]). */
    public const TYPES = [
        'pool' => ['Pool Resort', 'Swimming pools, open and private cottages, function areas'],
        'nature' => ['Nature Resort', 'Native cottages, gardens, camping areas, nature trails'],
        'beach' => ['Beach Resort', 'Beach access, cottages, water activities, equipment rental'],
        'riverside' => ['Riverside Resort', 'River access, picnic cottages, swimming areas'],
        'adventure' => ['Adventure Resort', 'Adventure activities, equipment, camping, guided experiences'],
        'farm' => ['Farm Resort', 'Farm activities, gardens, cottages, food experiences'],
        'other' => ['Other Resort', 'Custom facilities and services'],
    ];

    public const FACILITIES = [
        'swimming_pool' => 'Swimming pool',
        'beach_access' => 'Beach access',
        'river_access' => 'River access',
        'cottages' => 'Cottages',
        'camping_area' => 'Camping area',
        'gardens' => 'Gardens',
        'nature_trails' => 'Nature trails',
        'function_area' => 'Function area',
        'grilling_area' => 'Grilling area',
        'water_activities' => 'Water activities',
        'restaurant' => 'Restaurant',
        'parking' => 'Parking',
        'restrooms' => 'Restrooms & showers',
        'wifi' => 'Wi-Fi',
        'playground' => "Kids' playground",
    ];

    /** Registration `resort_type` values → type slug. */
    private const LEGACY_TYPE_MAP = [
        'beach resort' => 'beach',
        'mountain resort' => 'nature',
        'lake resort' => 'nature',
        'spring resort' => 'pool',
        'private resort' => 'pool',
    ];

    /** Seeds the catalogue (idempotent). */
    public function seedCatalogue(): void
    {
        $now = now();
        $i = 0;
        foreach (self::TYPES as $slug => [$name, $description]) {
            DB::table('resort_types')->updateOrInsert(['slug' => $slug], ['name' => $name, 'description' => $description, 'sort_order' => $i++, 'updated_at' => $now, 'created_at' => $now]);
        }
        $i = 0;
        foreach (self::FACILITIES as $slug => $name) {
            DB::table('resort_facilities')->updateOrInsert(['slug' => $slug], ['name' => $name, 'sort_order' => $i++, 'updated_at' => $now, 'created_at' => $now]);
        }
    }

    /**
     * Adds types/facilities implied by a resort's registration details.
     *
     * @return array{types: list<string>, facilities: list<string>} slugs added
     */
    public function backfillFromDetails(Business $business): array
    {
        $details = $business->details()->pluck('field_value', 'field_name');
        $truthy = fn (?string $v) => in_array(strtolower(trim((string) $v)), ['1', 'true', 'yes', 'on'], true);

        $types = [];
        $legacy = strtolower(trim((string) ($details['resort_type'] ?? '')));
        if ($legacy !== '') {
            $types[] = self::LEGACY_TYPE_MAP[$legacy] ?? 'other';
        }
        $facilities = [];
        if ($truthy($details['swimming_pool'] ?? null)) {
            $facilities[] = 'swimming_pool';
            $types[] = 'pool';
        }
        if ($truthy($details['beach_access'] ?? null)) {
            $facilities[] = 'beach_access';
            $types[] = 'beach';
        }
        if ($truthy($details['parking'] ?? null)) {
            $facilities[] = 'parking';
        }
        if ((int) ($details['number_of_cottages'] ?? 0) > 0) {
            $facilities[] = 'cottages';
        }

        $types = array_values(array_unique($types));
        $facilities = array_values(array_unique($facilities));

        $typeIds = ResortType::whereIn('slug', $types)->pluck('id')->all();
        $facilityIds = ResortFacility::whereIn('slug', $facilities)->pluck('id')->all();
        $business->resortTypes()->syncWithoutDetaching($typeIds);
        $business->resortFacilities()->syncWithoutDetaching($facilityIds);

        return ['types' => $types, 'facilities' => $facilities];
    }

    /** Backfills every Resort-category business. Returns how many were processed. */
    public function backfillAllResorts(): int
    {
        $count = 0;
        Business::query()
            ->whereHas('category', fn ($q) => $q->where('name', 'Resort'))
            ->each(function (Business $b) use (&$count) {
                $this->backfillFromDetails($b);
                $count++;
            });

        return $count;
    }

    /** Only Resort-category businesses use the resort engine (scope decision, Stage 1). */
    public static function isResort(Business $business): bool
    {
        return strcasecmp((string) $business->category?->name, 'Resort') === 0;
    }
}
