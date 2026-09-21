<?php

namespace App\Enums;

enum PriceRange: string
{
    case BUDGET = 'budget';
    case AFFORDABLE = 'affordable';
    case MID_RANGE = 'mid_range';
    case PREMIUM = 'premium';
    case LUXURY = 'luxury';

    public function label(): string
    {
        return match ($this) {
            self::BUDGET => 'Budget',
            self::AFFORDABLE => 'Affordable',
            self::MID_RANGE => 'Mid-range',
            self::PREMIUM => 'Premium',
            self::LUXURY => 'Luxury',
        };
    }

    public function description(): string
    {
        return match ($this) {
            self::BUDGET => 'Affordable meals and local eateries',
            self::AFFORDABLE => 'Casual restaurants and cafés',
            self::MID_RANGE => 'Family restaurants and specialty dining',
            self::PREMIUM => 'Fine dining and upscale restaurants',
            self::LUXURY => 'High-end dining experience',
        };
    }

    public function min(): string
    {
        return match ($this) {
            self::BUDGET => '₱1',
            self::AFFORDABLE => '₱200',
            self::MID_RANGE => '₱500',
            self::PREMIUM => '₱1,000',
            self::LUXURY => '₱2,000',
        };
    }

    public function max(): string
    {
        return match ($this) {
            self::BUDGET => '₱199',
            self::AFFORDABLE => '₱499',
            self::MID_RANGE => '₱999',
            self::PREMIUM => '₱1,999',
            self::LUXURY => '₱2,000+',
        };
    }

    public function range(): string
    {
        return $this->min().'–'.$this->max();
    }

    public function color(): string
    {
        return match ($this) {
            self::BUDGET => 'green',
            self::AFFORDABLE => 'green',
            self::MID_RANGE => 'yellow',
            self::PREMIUM => 'orange',
            self::LUXURY => 'red',
        };
    }

    public function badgeClasses(): string
    {
        return match ($this) {
            self::BUDGET => 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
            self::AFFORDABLE => 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
            self::MID_RANGE => 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
            self::PREMIUM => 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
            self::LUXURY => 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
        };
    }

    public function icon(): string
    {
        return match ($this) {
            self::BUDGET => '🟢',
            self::AFFORDABLE => '🟢',
            self::MID_RANGE => '🟡',
            self::PREMIUM => '🟠',
            self::LUXURY => '🔴',
        };
    }

    public static function options(): array
    {
        return array_map(fn ($case) => [
            'value' => $case->value,
            'label' => $case->label().' ('.$case->range().')',
            'description' => $case->description(),
        ], self::cases());
    }
}
