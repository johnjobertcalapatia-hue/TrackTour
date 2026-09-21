<?php

namespace App\Services;

use App\Models\FoodPreparationRecord;
use App\Models\Offering;
use App\Models\Order;
use App\Models\PreparationPredictionLog;
use Illuminate\Support\Facades\DB;

class PreparationPredictionService
{
    private const FALLBACK_DEFAULT_SECONDS = 900; // 15 minutes system default

    private const FALLBACK_THRESHOLD = 4;   // 0-4 records → fallback
    private const HISTORICAL_THRESHOLD = 19; // 5-19 records → historical avg
    // 20+ records → weighted avg

    private const WEIGHTED_RECENT_COUNT = 10;

    /**
     * Check if a restaurant has at least one eligible menu item.
     */
    public function hasEligibleItems(int $restaurantId): bool
    {
        return Offering::where('business_id', $restaurantId)
            ->where('prediction_eligible', true)
            ->exists();
    }

    /**
     * Get prediction eligibility status for a restaurant.
     */
    public function getPredictionStatus(int $restaurantId): array
    {
        $totalMenuItems = Offering::where('business_id', $restaurantId)
            ->where('type', 'menu')
            ->count();

        $eligibleMenuItems = Offering::where('business_id', $restaurantId)
            ->where('type', 'menu')
            ->where('prediction_eligible', true)
            ->count();

        $restaurantSetting = app(\App\Models\Business::class)
            ->withoutGlobalScopes()
            ->find($restaurantId)
            ?->getOrCreateRestaurantSetting();

        return [
            'enabled' => $restaurantSetting?->auto_preparation_prediction_enabled ?? false,
            'eligible_menu_items' => $eligibleMenuItems,
            'total_menu_items' => $totalMenuItems,
            'minimum_records_required' => Offering::MINIMUM_RECORDS_FOR_PREDICTION,
        ];
    }

    /**
     * Predict preparation time for a single order item (menu item).
     *
     * Returns [seconds, source].
     */
    public function predictForMenuItem(int $restaurantId, int $menuItemId): array
    {
        $validRecords = FoodPreparationRecord::where('restaurant_id', $restaurantId)
            ->where('menu_item_id', $menuItemId)
            ->validForTraining()
            ->orderBy('ready_at', 'desc')
            ->get();

        $count = $validRecords->count();

        if ($count === 0) {
            return [self::FALLBACK_DEFAULT_SECONDS, 'restaurant_default'];
        }

        if ($count <= self::FALLBACK_THRESHOLD) {
            $avg = round($validRecords->avg('actual_preparation_seconds'));
            return [$avg, 'restaurant_default'];
        }

        if ($count <= self::HISTORICAL_THRESHOLD) {
            $avg = round($validRecords->avg('actual_preparation_seconds'));
            return [$avg, 'historical_avg'];
        }

        // 20+ records: weighted average giving more weight to recent orders
        $recent = $validRecords->take(self::WEIGHTED_RECENT_COUNT);
        $older = $validRecords->skip(self::WEIGHTED_RECENT_COUNT);

        $recentWeight = 2.0;
        $olderWeight = 1.0;

        $recentSum = $recent->sum('actual_preparation_seconds') * $recentWeight;
        $olderSum = $older->sum('actual_preparation_seconds') * $olderWeight;
        $totalWeight = ($recent->count() * $recentWeight) + ($older->count() * $olderWeight);

        $weightedAvg = round(($recentSum + $olderSum) / $totalWeight);

        return [$weightedAvg, 'weighted_avg'];
    }

    /**
     * Predict complete order ready time for an order.
     *
     * For multi-item orders, the expected ready time is the MAX of all items'
     * predicted times (kitchen waits for the slowest item).
     *
     * If auto prediction is disabled, returns fallback for all items.
     */
    public function predictCompleteOrderReadyTime(Order $order): array
    {
        $restaurantId = $order->business_id;
        $restaurant = $order->business;
        $predictionEnabled = $restaurant?->isAutoPredictionEnabled() ?? false;

        $items = $order->items->load('offering');
        $maxSeconds = 0;
        $sources = [];

        foreach ($items as $item) {
            $menuItemId = $item->offering_id;

            if ($predictionEnabled && $menuItemId) {
                [$seconds, $source] = $this->predictForMenuItem($restaurantId, $menuItemId);
            } else {
                $seconds = self::FALLBACK_DEFAULT_SECONDS;
                $source = 'fallback';
            }

            $sources[$menuItemId ?? $item->id] = [
                'seconds' => $seconds,
                'source' => $source,
                'eligible' => $menuItemId
                    ? ($item->offering?->prediction_eligible ?? false)
                    : false,
            ];

            if ($seconds > $maxSeconds) {
                $maxSeconds = $seconds;
            }
        }

        return [
            'seconds' => $maxSeconds,
            'per_item' => $sources,
        ];
    }

    /**
     * Predict and log the prediction against an order.
     * Respects the restaurant's auto-prediction toggle.
     */
    public function predictAndLog(Order $order): int
    {
        $restaurant = $order->business;
        $predictionEnabled = $restaurant?->isAutoPredictionEnabled() ?? false;

        if ($predictionEnabled) {
            $result = $this->predictCompleteOrderReadyTime($order);
            $seconds = $result['seconds'];

            // Determine overall source from per-item results
            $perItem = $result['per_item'];
            $hasAnyHistorical = collect($perItem)->contains('source', '!=', 'restaurant_default')
                && collect($perItem)->contains('source', '!=', 'fallback');
            $hasWeighted = collect($perItem)->contains('source', 'weighted_avg');
            $source = $hasWeighted ? 'weighted_avg' : ($hasAnyHistorical ? 'historical_avg' : 'restaurant_default');
        } else {
            $seconds = self::FALLBACK_DEFAULT_SECONDS;
            $source = 'fallback';
        }

        $order->update([
            'predicted_preparation_seconds' => $seconds,
            'predicted_ready_at' => now()->addSeconds($seconds),
            'prediction_source' => $source,
        ]);

        $menuItemId = $order->items->first()?->offering_id;

        PreparationPredictionLog::create([
            'restaurant_id' => $order->business_id,
            'menu_item_id' => $menuItemId,
            'restaurant_order_id' => $order->id,
            'prediction_source' => $source,
            'predicted_seconds' => $seconds,
            'model_version' => 'v1.0',
        ]);

        return $seconds;
    }

    /**
     * Record actual preparation result when food is marked ready.
     */
    public function recordActualPreparation(Order $order): void
    {
        if (! $order->preparation_started_at || ! $order->food_ready_at) {
            return;
        }

        $actualSeconds = (int) $order->preparation_started_at->diffInSeconds($order->food_ready_at);
        $predictedSeconds = $order->predicted_preparation_seconds;
        $error = $predictedSeconds ? $actualSeconds - $predictedSeconds : null;
        $errorPercentage = $predictedSeconds
            ? round(($actualSeconds - $predictedSeconds) / $predictedSeconds * 100, 1)
            : null;

        $order->update([
            'actual_preparation_seconds' => $actualSeconds,
            'prediction_error_seconds' => $error,
        ]);

        // Update prediction log with actual result
        $order->predictionLogs()
            ->whereNull('actual_seconds')
            ->latest()
            ->limit(1)
            ->update([
                'actual_seconds' => $actualSeconds,
                'error_seconds' => $error,
            ]);

        // Create preparation record for each item in the order
        $kitchenLoad = $this->calculateKitchenLoad($order->business_id);

        foreach ($order->items as $item) {
            $menuItemId = $item->offering_id;
            if (! $menuItemId) {
                continue;
            }

            FoodPreparationRecord::create([
                'restaurant_id' => $order->business_id,
                'menu_item_id' => $menuItemId,
                'restaurant_order_id' => $order->id,
                'order_item_id' => $item->id,
                'preparation_started_at' => $order->preparation_started_at,
                'ready_at' => $order->food_ready_at,
                'predicted_preparation_seconds' => $predictedSeconds,
                'actual_preparation_seconds' => $actualSeconds,
                'prediction_error_seconds' => $error,
                'quantity' => $item->quantity,
                'day_of_week' => $order->preparation_started_at->dayOfWeek,
                'hour_of_day' => $order->preparation_started_at->hour,
                'kitchen_load_at_start' => $kitchenLoad,
                'is_valid_for_training' => $this->isValidRecord($actualSeconds),
            ]);

            // Refresh the offering's preparation stats
            $offering = Offering::find($menuItemId);
            if ($offering) {
                $offering->refreshPreparationStats();
            }
        }
    }

    /**
     * Get the primary menu item ID from the order.
     */
    private function getMenuItemId(Order $order): ?int
    {
        return $order->items->first()?->offering_id;
    }

    /**
     * Calculate current kitchen load based on active preparations.
     */
    private function calculateKitchenLoad(int $restaurantId): string
    {
        $activePreps = Order::where('business_id', $restaurantId)
            ->where('status', 'preparing')
            ->whereNotNull('preparation_started_at')
            ->whereNull('food_ready_at')
            ->count();

        if ($activePreps >= 6) {
            return 'high';
        }
        if ($activePreps >= 3) {
            return 'medium';
        }

        return 'low';
    }

    /**
     * Validate that a preparation record is reasonable (not corrupted).
     */
    private function isValidRecord(int $actualSeconds): bool
    {
        return $actualSeconds >= 60 && $actualSeconds <= 14400;
    }
}
