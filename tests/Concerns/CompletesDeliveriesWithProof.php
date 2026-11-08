<?php

namespace Tests\Concerns;

use App\Models\Delivery;
use App\Models\RiderLocation;
use App\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;

/**
 * Food delivery completion (decision 2026-11-08): the RIDER completes it at
 * the drop-off with a proof photo (POST /rider/deliveries/{d}/complete); for
 * COD that also records the tourist's cash payment (exact cash due). Replaces
 * the retired tourist confirm-delivery + separate settle-cod steps in tests.
 */
trait CompletesDeliveriesWithProof
{
    /** Put the rider at the drop-off (fresh GPS) and complete with a photo. */
    protected function riderCompletesDelivery(Delivery $delivery, User $rider): TestResponse
    {
        Storage::fake('public');
        $delivery->refresh();

        RiderLocation::create([
            'rider_id' => $rider->id,
            'latitude' => (float) $delivery->delivery_latitude,
            'longitude' => (float) $delivery->delivery_longitude,
            'recorded_at' => now(),
        ]);

        return $this->withToken($rider->createToken('proof')->plainTextToken)
            ->post(
                '/api/rider/deliveries/'.$delivery->id.'/complete',
                ['photo' => UploadedFile::fake()->image('delivered.jpg', 640, 480)],
                ['Accept' => 'application/json'],
            );
    }
}
