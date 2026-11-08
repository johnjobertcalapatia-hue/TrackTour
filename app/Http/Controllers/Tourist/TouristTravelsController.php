<?php

namespace App\Http\Controllers\Tourist;

use App\Http\Controllers\Controller;
use App\Models\Booking;
use App\Models\Municipality;
use App\Models\Order;
use App\Services\MunicipalityLocator;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /api/tourist/travels — municipalities the tourist has been to
 * (My Activities → Travels), from real records only:
 *   food   delivered/completed food orders, by delivery address (nearest municipality)
 *   stays  confirmed/checked-in/completed bookings whose check-in date has passed
 *   trips  completed transport rides, by drop-off point
 * Read-only. The client adds places where the app detected the tourist's
 * location ("You were here"), which it keeps on the device.
 */
class TouristTravelsController extends Controller
{
    private const DONE_ORDER = ['delivered', 'completed'];

    private const STAY_STATUSES = ['confirmed', 'checked_in', 'checked_out', 'completed'];

    public function __invoke(Request $request, MunicipalityLocator $locator): JsonResponse
    {
        $user = $request->user();
        $owns = fn ($q) => $q->where(fn ($q) => $q->where('user_id', $user->id)->orWhere('customer_email', $user->email));

        /** @var array<int, array{municipality: Municipality, food: int, stays: int, trips: int, last: ?\Carbon\CarbonInterface}> $visits */
        $visits = [];
        $add = function (?Municipality $m, string $kind, $at) use (&$visits) {
            if (! $m) {
                return;
            }
            $visits[$m->id] ??= ['municipality' => $m, 'food' => 0, 'stays' => 0, 'trips' => 0, 'last' => null];
            $visits[$m->id][$kind]++;
            if ($at && (! $visits[$m->id]['last'] || $at->gt($visits[$m->id]['last']))) {
                $visits[$m->id]['last'] = $at;
            }
        };

        Order::query()->tap($owns)
            ->whereIn('status', self::DONE_ORDER)
            ->whereNotNull('delivery_latitude')->whereNotNull('delivery_longitude')
            ->get(['id', 'order_type', 'delivery_latitude', 'delivery_longitude', 'completed_at', 'created_at'])
            ->each(function (Order $o) use ($locator, $add) {
                $found = $locator->nearest((float) $o->delivery_latitude, (float) $o->delivery_longitude);
                $add($found['municipality'] ?? null, $o->order_type === 'transport' ? 'trips' : 'food', $o->completed_at ?? $o->created_at);
            });

        Booking::query()->tap($owns)
            ->whereIn('status', self::STAY_STATUSES)
            ->whereDate('check_in_date', '<=', now()->toDateString())
            ->with('business.municipality')
            ->get()
            ->each(fn (Booking $b) => $add($b->business?->municipality, 'stays', $b->check_in_date ?? $b->created_at));

        $municipalities = collect($visits)
            ->map(fn (array $v) => [
                'id' => $v['municipality']->id,
                'name' => $v['municipality']->name,
                'province' => $v['municipality']->province,
                'cover_photo' => $v['municipality']->cover_photo,
                'food_orders' => $v['food'],
                'stays' => $v['stays'],
                'trips' => $v['trips'],
                'last_visited_at' => $v['last']?->toIso8601String(),
            ])
            ->sortByDesc('last_visited_at')
            ->values();

        return $this->successResponse(['municipalities' => $municipalities]);
    }
}
