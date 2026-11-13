<?php

namespace App\Observers;

use App\Models\Offering;
use App\Models\OfferingVariation;
use App\Services\MenuAvailabilityService;
use Illuminate\Database\Eloquent\Model;
use Throwable;

/**
 * Safety net for menu availability history (Stage 3). MenuAvailabilityService
 * is the authoritative writer and records its own changes; while it is
 * writing, this observer does nothing (no duplicate events). It only records
 * an availability change made by a write path that bypassed the service,
 * tagged source "unrouted" so it can be found and routed properly.
 */
class MenuAvailabilityObserver
{
    public function __construct(private readonly MenuAvailabilityService $availability) {}

    public function created(Model $model): void
    {
        if (MenuAvailabilityService::isActive()) {
            return;
        }
        $this->safely(fn () => $this->availability->recordUnrouted($this->subject($model), null, (bool) $model->getAttribute('is_available')));
    }

    public function updated(Model $model): void
    {
        if (MenuAvailabilityService::isActive() || ! $model->wasChanged('is_available')) {
            return;
        }
        $previous = $model->getOriginal('is_available');
        $this->safely(fn () => $this->availability->recordUnrouted($this->subject($model), $previous === null ? null : (bool) $previous, (bool) $model->getAttribute('is_available')));
    }

    private function subject(Model $model): Offering|OfferingVariation
    {
        return $model;
    }

    private function safely(callable $fn): void
    {
        try {
            $fn();
        } catch (Throwable $e) {
            report($e);
        }
    }
}
