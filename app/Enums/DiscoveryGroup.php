<?php

namespace App\Enums;

/**
 * Canonical tourist-facing grouping for business categories.
 *
 * The database remains the source of truth for category names; this enum
 * defines how those names are presented to tourists. Keep the category
 * precedence in mind: a combined hotel/restaurant is accommodation, not food,
 * and accommodation names are checked before the broader "beach"/"park"
 * attraction patterns.
 */
enum DiscoveryGroup: string
{
    case Spot = 'spot';
    case Dining = 'dining';
    case Accommodation = 'accommodation';
    case Other = 'other';

    private const ACCOMMODATION_NAMES = [
        'hotel',
        'resort',
        'hotel & restaurant combination',
        'homestay',
        'camping site',
        'tourist inn',
        'apartel',
        'boutique hotel',
        'motel',
        'beach resort',
        'mountain resort',
        'private resort',
        'stay',
        'lodging',
        'inn',
    ];

    private const SPOT_TERMS = [
        'tourist attraction',
        'attractions',
        'attraction',
        'farm tourism',
        'nature',
        'beach',
        'park',
        'historical site',
        'cultural site',
        'adventure',
        'viewpoint',
        'tourist spot',
        'destination',
        'museum',
    ];

    private const DINING_NAMES = [
        'restaurant',
        'café',
        'cafe',
        'food hub',
        'bakery',
        'fast food',
        'food',
        'carinderia',
        'bar',
    ];

    public static function fromCategoryName(?string $name): self
    {
        $normalized = mb_strtolower(trim((string) $name));

        if ($normalized === '') {
            return self::Other;
        }

        // Combination properties are accommodation-first by architecture.
        if (self::isHotelRestaurantCombination($normalized)) {
            return self::Accommodation;
        }

        if (self::matchesAccommodation($normalized)) {
            return self::Accommodation;
        }

        if (self::matchesSpot($normalized)) {
            return self::Spot;
        }

        if (self::matchesDining($normalized)) {
            return self::Dining;
        }

        return self::Other;
    }

    public function matchesCategoryName(?string $name): bool
    {
        return self::fromCategoryName($name) === $this;
    }

    private static function isHotelRestaurantCombination(string $normalized): bool
    {
        if ($normalized === 'hotel & restaurant combination') {
            return true;
        }

        return str_contains($normalized, 'hotel') && str_contains($normalized, 'restaurant');
    }

    private static function matchesAccommodation(string $normalized): bool
    {
        if (in_array($normalized, self::ACCOMMODATION_NAMES, true)) {
            return true;
        }

        foreach (['resort', 'hotel', 'homestay', 'lodging', 'inn', 'camping', 'apartel', 'motel', 'stay'] as $term) {
            if (str_contains($normalized, $term)) {
                return true;
            }
        }

        return false;
    }

    private static function matchesSpot(string $normalized): bool
    {
        if (in_array($normalized, self::SPOT_TERMS, true)) {
            return true;
        }

        foreach (self::SPOT_TERMS as $term) {
            if (str_contains($normalized, $term)) {
                return true;
            }
        }

        return false;
    }

    private static function matchesDining(string $normalized): bool
    {
        if (in_array($normalized, self::DINING_NAMES, true)) {
            return true;
        }

        foreach (['restaurant', 'café', 'cafe', 'food hub', 'bakery', 'fast food', 'carinderia'] as $term) {
            if (str_contains($normalized, $term)) {
                return true;
            }
        }

        return false;
    }
}
