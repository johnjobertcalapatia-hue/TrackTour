<?php

namespace App\Models;

use App\Enums\PriceRange;
use App\Services\RestaurantWalletService;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Database\Eloquent\Relations\MorphMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Facades\Cache;

class Business extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'owner_id',
        'municipality_id',
        'barangay_id',
        'business_category_id',
        'business_name',
        'business_description',
        'tagline',
        'contact_number',
        'email',
        'website',
        'facebook',
        'instagram',
        'other_social_media',
        'address',
        'building_number',
        'postal_code',
        'landmark',
        'navigation_instructions',
        'latitude',
        'longitude',
        'legal_entity_type',
        'tin',
        'dti_sec_reg_number',
        'year_established',
        'opening_date',
        'number_of_employees',
        'business_size',
        'gross_floor_area',
        'initial_capital',
        'occupancy_status',
        'opening_time',
        'closing_time',
        'business_days',
        'business_hours',
        'force_closed',
        'holiday_schedule',
        'price_range',
        'dining_style',
        'accepts_reservation',
        'reservation_required',
        'average_wait_time',
        'facilities',
        'services',
        'payment_methods',
        'special_offers',
        'welcome_message',
        'signature_dishes',
        'featured_banner',
        'featured_video',
        'logo',
        'cover_photo',
        'status',
        'popularity_score',
        'booking_count',
        'favorite_count',
        'review_count',
        'average_rating',
    ];

    protected $appends = ['name', 'is_open', 'is_accepting_orders', 'availability_status', 'open_status', 'schedule_summary'];

    public function getNameAttribute(): ?string
    {
        return $this->business_name;
    }

    public function getIsOpenAttribute(): bool
    {
        return $this->isOpenNow();
    }

    public function getIsAcceptingOrdersAttribute(): bool
    {
        return $this->isAcceptingOrders();
    }

    public function getAvailabilityStatusAttribute(): string
    {
        return $this->availability();
    }

    public function getOpenStatusAttribute(): array
    {
        return $this->openStatusLabel();
    }

    public function getScheduleSummaryAttribute(): string
    {
        return $this->scheduleSummary();
    }

    protected function casts(): array
    {
        return [
            'business_days' => 'array',
            'business_hours' => 'array',
            'force_closed' => 'boolean',
            'dining_style' => 'array',
            'facilities' => 'array',
            'services' => 'array',
            'payment_methods' => 'array',
            'signature_dishes' => 'array',
            'latitude' => 'decimal:7',
            'longitude' => 'decimal:7',
            'accepts_reservation' => 'boolean',
            'reservation_required' => 'boolean',
            'average_wait_time' => 'integer',
            'popularity_score' => 'integer',
            'booking_count' => 'integer',
            'favorite_count' => 'integer',
            'review_count' => 'integer',
            'average_rating' => 'float',
        ];
    }

    public function getPriceRangeEnum(): ?PriceRange
    {
        return $this->price_range ? PriceRange::tryFrom($this->price_range) : null;
    }

    public function owner(): BelongsTo
    {
        return $this->belongsTo(User::class, 'owner_id');
    }

    public function municipality(): BelongsTo
    {
        return $this->belongsTo(Municipality::class);
    }

    public function barangay(): BelongsTo
    {
        return $this->belongsTo(Barangay::class);
    }

    public function category(): BelongsTo
    {
        return $this->belongsTo(BusinessCategory::class, 'business_category_id');
    }

    public function details(): HasMany
    {
        return $this->hasMany(BusinessDetail::class);
    }

    public function documents(): HasMany
    {
        return $this->hasMany(BusinessDocument::class);
    }

    public function staff(): HasMany
    {
        return $this->hasMany(Staff::class);
    }

    public function media(): HasMany
    {
        return $this->hasMany(BusinessMedia::class);
    }

    public function statusLogs(): HasMany
    {
        return $this->hasMany(BusinessStatusLog::class);
    }

    public function offeringCategories(): HasMany
    {
        return $this->hasMany(OfferingCategory::class);
    }

    public function offerings(): HasMany
    {
        return $this->hasMany(Offering::class);
    }

    public function orders(): HasMany
    {
        return $this->hasMany(Order::class);
    }

    public function restaurantSetting(): HasOne
    {
        return $this->hasOne(RestaurantSetting::class, 'restaurant_id');
    }

    public function restaurantWallet(): HasOne
    {
        return $this->hasOne(RestaurantWallet::class, 'business_id');
    }

    public function getOrCreateRestaurantSetting(): RestaurantSetting
    {
        return $this->restaurantSetting()->firstOrCreate(
            ['restaurant_id' => $this->id],
            ['auto_preparation_prediction_enabled' => false]
        );
    }

    public function isAutoPredictionEnabled(): bool
    {
        return $this->getOrCreateRestaurantSetting()->auto_preparation_prediction_enabled;
    }

    public function bookings(): HasMany
    {
        return $this->hasMany(Booking::class);
    }

    public function promotions(): HasMany
    {
        return $this->hasMany(Promotion::class);
    }

    public function reviews(): HasMany
    {
        return $this->hasMany(Review::class);
    }

    public function favorites(): MorphMany
    {
        return $this->morphMany(Favorite::class, 'favoritable');
    }

    public function modules(): BelongsToMany
    {
        return $this->belongsToMany(BusinessModule::class, 'business_module_assignments', 'business_id', 'business_module_id')
            ->withPivot('is_active')
            ->withTimestamps();
    }

    public function activeModules(): BelongsToMany
    {
        return $this->modules()->wherePivot('is_active', true);
    }

    public function getModuleCodesAttribute(): array
    {
        return Cache::remember("business_{$this->id}_modules", 3600, function () {
            return $this->activeModules()->pluck('code')->toArray();
        });
    }

    public function hasModule(string $code): bool
    {
        return in_array($code, $this->module_codes);
    }

    public function syncModulesFromCategory(): void
    {
        $moduleIds = $this->category?->modules()->pluck('business_modules.id') ?? collect();
        $this->modules()->sync($moduleIds->mapWithKeys(fn ($id) => [$id => ['is_active' => true]]));
        Cache::forget("business_{$this->id}_modules");
    }

    public function isRestaurant(): bool
    {
        return in_array($this->category?->name, ['Restaurant', 'Café', 'Food Hub / Food Park']);
    }

    public function isAccommodation(): bool
    {
        return in_array($this->category?->name, [
            'Hotel', 'Resort', 'Homestay', 'Camping Site',
        ]);
    }

    /**
     * Weekday map: Carbon's englishDayOfWeek (lowercased) -> canonical day key.
     */
    public static function dayKeyFromName(string $name): string
    {
        return strtolower($name);
    }

    /**
     * Normalize a stored period array into [{open:'HH:MM', close:'HH:MM'}, ...].
     */
    public function getScheduleForDay(?string $day): array
    {
        if (! $day) {
            return [];
        }

        $hours = is_array($this->business_hours) ? $this->business_hours : [];
        $periods = $hours[$day] ?? [];

        $normalized = [];
        foreach ($periods as $period) {
            if (! is_array($period)) {
                continue;
            }
            $open = $period['open'] ?? $period[0] ?? null;
            $close = $period['close'] ?? $period[1] ?? null;
            if ($open === null || $close === null || $open === '' || $close === '') {
                continue;
            }
            $normalized[] = ['open' => $open, 'close' => $close];
        }

        return $normalized;
    }

    /**
     * Human-readable schedule summary, e.g. "Mon-Fri: 8:00 AM - 9:00 PM".
     */
    public function scheduleSummary(): string
    {
        $days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
        $labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

        if (! is_array($this->business_hours)) {
            if ($this->opening_time && $this->closing_time) {
                return date('g:i A', strtotime($this->opening_time)).' - '.date('g:i A', strtotime($this->closing_time));
            }

            return 'Hours not set';
        }

        $parts = [];
        foreach ($days as $i => $day) {
            $periods = $this->getScheduleForDay($day);
            if (empty($periods)) {
                $parts[] = $labels[$i].': Closed';

                continue;
            }
            $ranges = collect($periods)->map(fn ($p) => date('g:i A', strtotime($p['open'])).' - '.date('g:i A', strtotime($p['close'])))->implode(' · ');
            $parts[] = $labels[$i].': '.$ranges;
        }

        return implode(', ', $parts);
    }

    /**
     * True if the business is NOT forced closed and currently falls within one of
     * today's opening periods (Philippine local time).
     */
    public function isOpenNow(): bool
    {
        if ($this->force_closed) {
            return false;
        }

        return $this->isWithinScheduleNow();
    }

    /**
     * True if a business can currently accept food orders (status approved + open).
     */
    public function isAcceptingOrders(): bool
    {
        return $this->status === 'approved' && $this->isOpenNow();
    }

    /**
     * Whether the current Philippine local time falls inside today's periods.
     */
    public function isWithinScheduleNow(): bool
    {
        $now = now()->timezone('Asia/Manila');
        $day = strtolower($now->format('l'));
        $currentMin = (int) $now->format('G') * 60 + (int) $now->format('i');

        if ($this->isInsidePeriods($this->getScheduleForDay($day), $currentMin)) {
            return true;
        }

        // Overnight spillover: the previous day's period may extend past midnight
        // into this morning (e.g. Sunday 20:00 -> Monday 02:00).
        $days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
        $previousDay = $days[(array_search($day, $days) + 6) % 7];
        $previousPeriods = collect($this->getScheduleForDay($previousDay))
            ->filter(fn ($p) => $this->toMinutes($p['open']) !== null
                && $this->toMinutes($p['close']) !== null
                && $this->toMinutes($p['open']) > $this->toMinutes($p['close']))
            ->values()
            ->all();

        return $this->isInsidePeriods($previousPeriods, $currentMin, true);
    }

    protected function isInsidePeriods(array $periods, int $currentMin, bool $isOvernightSet = false): bool
    {
        foreach ($periods as $period) {
            $open = $this->toMinutes($period['open']);
            $close = $this->toMinutes($period['close']);
            if ($open === null || $close === null) {
                continue;
            }
            if ($isOvernightSet) {
                // Previous-day overnight periods only cover the morning hours (00:00 -> close).
                if ($currentMin < $close) {
                    return true;
                }

                continue;
            }
            if ($open <= $close && $currentMin >= $open && $currentMin < $close) {
                return true;
            }
            // Overnight period on the current day (e.g. 20:00 -> 02:00): covers late night.
            if ($open > $close && ($currentMin >= $open || $currentMin < $close)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Human label describing availability for the tourist UI.
     * Returns one of: 'open', 'closed', 'temporarily_closed'.
     */
    public function availability(): string
    {
        if ($this->force_closed && ! $this->isWithinScheduleNow()) {
            return 'temporarily_closed';
        }
        if ($this->force_closed) {
            return 'temporarily_closed';
        }

        return $this->isWithinScheduleNow() ? 'open' : 'closed';
    }

    /**
     * Text shown on the UI when the restaurant is open, e.g. "Open now".
     */
    public function openStatusLabel(): array
    {
        if ($this->force_closed) {
            return ['status' => 'temporarily_closed', 'label' => 'Temporarily Closed'];
        }
        if ($this->isWithinScheduleNow()) {
            return ['status' => 'open', 'label' => 'Open now'];
        }

        return ['status' => 'closed', 'label' => $this->nextOpeningLabel()];
    }

    /**
     * Human string describing when the restaurant next opens, e.g. "Opens today at 5:00 PM".
     */
    public function nextOpeningLabel(): string
    {
        $now = now()->timezone('Asia/Manila');
        $currentDay = strtolower($now->format('l'));
        $currentMin = (int) $now->format('G') * 60 + (int) $now->format('i');
        $days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
        $dayLabels = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

        for ($offset = 0; $offset <= 7; $offset++) {
            $dayKey = $days[(array_search($currentDay, $days) + $offset) % 7];
            $periods = collect($this->getScheduleForDay($dayKey))->sortBy(fn ($p) => $this->toMinutes($p['open']));
            foreach ($periods as $period) {
                $openMin = $this->toMinutes($period['open']);
                if ($openMin === null) {
                    continue;
                }
                if ($offset === 0 && $openMin <= $currentMin) {
                    continue;
                }
                $timeLabel = date('g:i A', strtotime($period['open']));
                if ($offset === 0) {
                    return 'Opens today at '.$timeLabel;
                }
                if ($offset === 1) {
                    return 'Opens tomorrow at '.$timeLabel;
                }

                return 'Opens '.$dayLabels[(array_search($currentDay, $days) + $offset) % 7].' at '.$timeLabel;
            }
        }

        return 'Closed';
    }

    protected function toMinutes(string $time): ?int
    {
        $ts = strtotime($time);
        if ($ts === false) {
            return null;
        }

        return (int) date('G', $ts) * 60 + (int) date('i', $ts);
    }

    public function updatePopularityScore(): void
    {
        $score = ($this->booking_count * 3)
            + ($this->review_count * 2)
            + ($this->favorite_count * 1)
            + (int) ($this->average_rating * 10);

        if ($this->popularity_score !== $score) {
            $this->updateQuietly(['popularity_score' => $score]);
        }
    }

    protected static function booted(): void
    {
        static::saved(function ($business) {
            Cache::forget("business_{$business->id}_modules");

            // Wallet creation is account provisioning only. No balances or
            // financial transactions are created until the P12 settlement path.
            app(RestaurantWalletService::class)->ensureForBusiness($business);
        });
    }
}
