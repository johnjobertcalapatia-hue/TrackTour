<?php

namespace App\Http\Controllers\Admin;

use App\Exceptions\SosException;
use App\Http\Controllers\Controller;
use App\Models\Delivery;
use App\Models\DeliveryPickupStop;
use App\Models\Municipality;
use App\Models\RiderLocation;
use App\Models\SosAlert;
use App\Models\TouristLocationShare;
use App\Models\User;
use App\Services\SosAlertService;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class AdminLiveController extends Controller
{
    private const TERMINAL = ['delivered', 'completed', 'cancelled'];

    private const BUCKETS = ['active', 'completed', 'cancelled', 'all'];

    /**
     * Delivery record of the Bansud Tourism Office's own municipality.
     *
     * A delivery belongs to Bansud when its order's restaurant — or, for a
     * multi-restaurant order, any of its restaurants — is in Bansud. A
     * ride-hailing trip has no restaurant, so it belongs to its rider's
     * municipality. Active deliveries (live, auto-refreshed) and the history
     * (completed / cancelled) come from the same scoped query.
     */
    public function deliveries(Request $request): JsonResponse
    {
        $v = $request->validate([
            'bucket' => ['nullable', Rule::in(self::BUCKETS)],
            'search' => ['nullable', 'string', 'max:100'],
            'type' => ['nullable', Rule::in(['delivery', 'transport'])],
            'from' => ['nullable', 'date_format:Y-m-d'],
            'to' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:from'],
            'per_page' => ['nullable', 'integer', 'min:5', 'max:100'],
        ]);
        $home = Municipality::whereRaw('LOWER(name) = ?', [strtolower(Municipality::HOME_MUNICIPALITY)])->first();
        abort_if($home === null, 404, 'Municipality not found.');

        $base = fn () => $this->filtered(Delivery::query(), $home->id, $v);
        $bucket = $v['bucket'] ?? 'active';

        $page = $this->inBucket($base(), $bucket)
            ->with(['order:id,order_number,order_type,customer_name,customer_phone,payment_method,total,delivery_fee,business_id,completed_at', 'order.business:id,business_name', 'order.items:id,order_id,business_id', 'order.items.business:id,business_name', 'rider:id,name,email', 'rider.profile', 'codPurchases.business:id,business_name', 'destinationChange'])
            ->orderByRaw($bucket === 'active' ? 'updated_at desc' : 'COALESCE(delivered_at, updated_at) desc')
            ->paginate($v['per_page'] ?? 20);

        $counts = [];
        foreach (self::BUCKETS as $b) {
            $counts[$b] = $this->inBucket($base(), $b)->count();
        }

        return $this->successResponse(
            collect($page->items())->map(fn (Delivery $d) => $this->present($d))->values(),
            'Deliveries retrieved.',
            200,
            [
                'municipality' => ['id' => $home->id, 'name' => $home->name],
                'bucket' => $bucket,
                'counts' => $counts,
                'total' => $page->total(),
                'current_page' => $page->currentPage(),
                'last_page' => $page->lastPage(),
            ]
        );
    }

    private function filtered(Builder $q, int $municipalityId, array $v): Builder
    {
        $inMunicipality = fn ($b) => $b->where('municipality_id', $municipalityId);

        $q->where(function ($w) use ($inMunicipality, $municipalityId) {
            $w->whereHas('order', fn ($o) => $o->whereHas('business', $inMunicipality)->orWhereHas('items.business', $inMunicipality))
                ->orWhere(fn ($t) => $t->whereHas('order', fn ($o) => $o->whereNull('business_id')->where('order_type', 'transport'))
                    ->whereHas('rider', fn ($r) => $r->where('municipality_id', $municipalityId)));
        });

        if (! empty($v['type'])) {
            $q->whereHas('order', fn ($o) => $o->where('order_type', $v['type']));
        }
        if (! empty($v['search'])) {
            $term = '%'.$v['search'].'%';
            $q->where(fn ($w) => $w
                ->whereHas('order', fn ($o) => $o->where('order_number', 'like', $term)->orWhere('customer_name', 'like', $term))
                ->orWhereHas('rider', fn ($r) => $r->where('name', 'like', $term))
                ->orWhere('delivery_address', 'like', $term));
        }
        if (! empty($v['from'])) {
            $q->where('created_at', '>=', CarbonImmutable::parse($v['from'], 'Asia/Manila')->startOfDay()->utc());
        }
        if (! empty($v['to'])) {
            $q->where('created_at', '<=', CarbonImmutable::parse($v['to'], 'Asia/Manila')->endOfDay()->utc());
        }

        return $q;
    }

    private function inBucket(Builder $q, string $bucket): Builder
    {
        return match ($bucket) {
            'active' => $q->whereNotIn('status', self::TERMINAL),
            'completed' => $q->whereIn('status', ['delivered', 'completed']),
            'cancelled' => $q->where('status', 'cancelled'),
            default => $q,
        };
    }

    private function present(Delivery $d): array
    {
        $order = $d->order;
        $restaurants = collect([$order?->business?->business_name])
            ->merge($order?->items?->map(fn ($i) => $i->business?->business_name) ?? [])
            ->filter()->unique()->values();

        return [
            'id' => $d->id,
            'order_id' => $order?->id,
            'order_number' => $order?->order_number,
            'order_type' => $order?->order_type,
            'customer_name' => $order?->customer_name,
            'customer_phone' => $order?->customer_phone,
            'restaurants' => $restaurants,
            'rider_name' => $d->rider?->full_name,
            'rider_phone' => $d->rider?->profile?->mobile_number,
            'status' => $d->status,
            'pickup_address' => $d->pickup_address,
            'delivery_address' => $d->delivery_address,
            'distance_km' => $d->distance_km !== null ? (float) $d->distance_km : null,
            'delivery_fee' => $d->delivery_fee !== null ? (float) $d->delivery_fee : null,
            'total' => $order?->total !== null ? (float) $order->total : null,
            'order' => ['payment_method' => $order?->payment_method],
            'purchasing_cash' => $d->purchasing_cash !== null ? (float) $d->purchasing_cash : null,
            'purchasing_cash_issued_at' => $d->purchasing_cash_issued_at?->toIso8601String(),
            'purchasing_cash_received_at' => $d->purchasing_cash_received_at?->toIso8601String(),
            'cod_purchases' => $d->codPurchases->map(fn ($p) => [
                'id' => $p->id,
                'business_id' => $p->business_id,
                'business_name' => $p->business?->business_name,
                'purchase_amount' => (float) $p->purchase_amount,
                'status' => $p->status,
            ])->values(),
            'assigned_at' => $d->assigned_at?->toIso8601String(),
            'picked_up_at' => $d->picked_up_at?->toIso8601String(),
            'delivered_at' => $d->delivered_at?->toIso8601String(),
            'created_at' => $d->created_at?->toIso8601String(),
            'updated_at' => $d->updated_at?->toIso8601String(),
            // Ride destination change: original vs final destination, when, and the fare adjustment.
            'destination_change' => $d->destinationChange?->present(),
        ];
    }

    /** Trip statuses where the rider is still heading to (or at) the pickup. */
    private const PICKUP_STAGE = ['assigned', 'en_route_pickup', 'arrived_pickup'];

    /** Trip statuses that put a rider on the live map as "on a trip". */
    private const LIVE_TRIP = ['assigned', 'en_route_pickup', 'arrived_pickup', 'picked_up', 'in_transit', 'arrived_destination'];

    /**
     * GET /admin/live/riders — every rider who is on duty (online, available
     * or busy) or holding a live trip, across all municipalities, with their
     * latest GPS fix and the trip they are on: stage, remaining pickup stops
     * and the drop-off, so the live map can draw the route.
     *
     * Read-only: pickup stops are read as stored, never seeded from here.
     */
    public function riders(): JsonResponse
    {
        $onDuty = [User::RIDER_STATUS_ONLINE, User::RIDER_STATUS_AVAILABLE, User::RIDER_STATUS_BUSY];

        $riders = User::query()
            ->where('role', User::ROLE_RIDER)
            ->where(fn ($q) => $q
                ->whereHas('riderDetail', fn ($d) => $d->whereIn('rider_status', $onDuty))
                ->orWhereIn('id', Delivery::query()->select('rider_id')->whereNotNull('rider_id')->whereIn('status', self::LIVE_TRIP)))
            ->with(['profile:id,user_id,first_name,last_name,mobile_number,avatar', 'riderDetail', 'municipality:id,name'])
            ->get();

        $ids = $riders->pluck('id');

        $locations = RiderLocation::query()
            ->whereIn('id', RiderLocation::query()->selectRaw('MAX(id)')->whereIn('rider_id', $ids)->groupBy('rider_id'))
            ->get()
            ->keyBy('rider_id');

        $trips = Delivery::query()
            ->whereIn('rider_id', $ids)
            ->whereIn('status', self::LIVE_TRIP)
            ->with(['order:id,order_number,order_type,customer_name,delivery_address,business_id', 'order.business:id,business_name,latitude,longitude'])
            ->orderByDesc('id')
            ->get()
            ->unique('rider_id')
            ->keyBy('rider_id');

        $stops = DeliveryPickupStop::query()
            ->whereIn('delivery_id', $trips->pluck('id'))
            ->with('business:id,business_name')
            ->orderBy('sequence')
            ->get()
            ->groupBy('delivery_id');

        $data = $riders->map(function (User $rider) use ($locations, $trips, $stops) {
            $loc = $locations->get($rider->id);
            $trip = $trips->get($rider->id);
            $detail = $rider->riderDetail;

            return [
                'id' => $rider->id,
                'name' => $rider->full_name ?: $rider->name,
                'phone' => $rider->profile?->mobile_number,
                // A photo whose file is gone is reported as none (initials show instead).
                'photo' => ($avatar = $rider->profile?->avatar) && \Illuminate\Support\Facades\Storage::disk('public')->exists($avatar) ? $avatar : null,
                'municipality' => $rider->municipality?->name,
                'rider_status' => $detail?->rider_status ?? User::RIDER_STATUS_OFFLINE,
                'service' => $detail?->current_service,
                'vehicle_type' => $detail?->vehicle_type,
                'plate_number' => $detail?->vehicle_plate_number,
                // available | busy | delivering | transporting
                'activity' => $trip
                    ? ($trip->order?->order_type === 'transport' ? 'transporting' : 'delivering')
                    : ($detail?->rider_status === User::RIDER_STATUS_BUSY ? 'busy' : 'available'),
                'location' => $loc ? [
                    'lat' => (float) $loc->latitude,
                    'lng' => (float) $loc->longitude,
                    'accuracy_m' => $loc->accuracy_m !== null ? (float) $loc->accuracy_m : null,
                    'at' => $loc->recorded_at?->toIso8601String(),
                ] : null,
                'trip' => $trip ? $this->presentLiveTrip($trip, $stops->get($trip->id, collect())) : null,
            ];
        })->values();

        return $this->successResponse($data, 'Live riders retrieved.');
    }

    /**
     * GET /admin/live/tourists — tourists who opted in to share their location
     * with the tourism office and whose app reported it in the last few
     * minutes. Latest position only; tourists who never opted in never appear.
     */
    public function tourists(): JsonResponse
    {
        $shares = TouristLocationShare::query()
            ->live()
            ->whereHas('user', fn ($u) => $u->where('role', User::ROLE_TOURIST))
            ->with('user:id,name,email', 'user.profile:id,user_id,first_name,last_name,mobile_number,avatar')
            ->orderByDesc('location_at')
            ->get();

        $data = $shares->map(function (TouristLocationShare $s) {
            $avatar = $s->user?->profile?->avatar;

            return [
                'id' => $s->user_id,
                // Account name, else the name on the profile.
                'name' => trim((string) $s->user?->name) ?: (trim(($s->user?->profile?->first_name ?? '').' '.($s->user?->profile?->last_name ?? '')) ?: null),
                'phone' => $s->user?->profile?->mobile_number,
                'photo' => $avatar && \Illuminate\Support\Facades\Storage::disk('public')->exists($avatar) ? $avatar : null,
                'location' => [
                    'lat' => (float) $s->latitude,
                    'lng' => (float) $s->longitude,
                    'accuracy_m' => $s->accuracy_m,
                    'at' => $s->location_at?->toIso8601String(),
                ],
            ];
        })->values();

        return $this->successResponse($data, 'Live tourists retrieved.');
    }

    private function presentLiveTrip(Delivery $trip, $stops): array
    {
        $order = $trip->order;
        $isRide = $order?->order_type === 'transport';
        // status is cast to the TripStatus enum; compare its string value.
        $status = $trip->status instanceof \BackedEnum ? $trip->status->value : (string) $trip->status;
        $toPickup = in_array($status, self::PICKUP_STAGE, true);
        $point = fn ($lat, $lng) => $lat !== null && $lng !== null && (float) $lat != 0.0 && (float) $lng != 0.0
            ? ['lat' => (float) $lat, 'lng' => (float) $lng]
            : null;

        // Food pickups: the stored restaurant stops, else the order's restaurant.
        // Rides: the passenger's pickup point.
        $pickups = collect();
        if (! $isRide) {
            $pickups = $stops->map(fn (DeliveryPickupStop $s) => [
                'name' => $s->business?->business_name,
                'address' => $s->pickup_address,
                'collected' => $s->status === DeliveryPickupStop::STATUS_COLLECTED,
            ] + ($point($s->pickup_latitude, $s->pickup_longitude) ?? ['lat' => null, 'lng' => null]))->values();
        }
        if ($pickups->isEmpty()) {
            $pickups = collect([[
                'name' => $isRide ? 'Passenger pickup' : $order?->business?->business_name,
                'address' => $trip->pickup_address,
                'collected' => ! $toPickup,
            ] + ($point($trip->pickup_latitude, $trip->pickup_longitude)
                ?? $point($order?->business?->latitude, $order?->business?->longitude)
                ?? ['lat' => null, 'lng' => null])]);
        }

        return [
            'id' => $trip->id,
            'order_number' => $order?->order_number,
            'type' => $isRide ? 'ride' : 'food',
            'status' => $status,
            'stage' => $toPickup ? 'to_pickup' : 'to_dropoff',
            'customer_name' => $order?->customer_name,
            'pickups' => $pickups,
            'dropoff' => [
                'address' => $trip->delivery_address ?: $order?->delivery_address,
            ] + ($point($trip->delivery_latitude, $trip->delivery_longitude) ?? ['lat' => null, 'lng' => null]),
            'assigned_at' => $trip->assigned_at?->toIso8601String(),
            'picked_up_at' => $trip->picked_up_at?->toIso8601String(),
        ];
    }

    /*
     * SOS alerts (2026-11-18): raised by a tourist during a ride or a rider
     * during any trip; handled here: acknowledge → send help → resolve.
     */

    /** GET /admin/live/sos?filter=active|resolved|all — active ones on top, newest first. */
    public function sos(Request $request, SosAlertService $service): JsonResponse
    {
        $filter = in_array($request->query('filter'), ['active', 'resolved', 'all'], true) ? $request->query('filter') : 'active';
        $alerts = SosAlert::query()
            ->when($filter === 'active', fn ($q) => $q->whereIn('status', SosAlert::ACTIVE))
            ->when($filter === 'resolved', fn ($q) => $q->where('status', SosAlert::STATUS_RESOLVED))
            ->orderByRaw("CASE status WHEN 'pending' THEN 0 WHEN 'acknowledged' THEN 1 WHEN 'responding' THEN 2 ELSE 3 END")
            ->latest('raised_at')
            ->limit(100)
            ->get();

        return $this->successResponse([
            'data' => $alerts->map(fn ($a) => $service->presentForAdmin($a))->values(),
            'summary' => $this->sosCounts(),
        ]);
    }

    /** GET /admin/live/sos/summary — for the alarm banner on every admin page. */
    public function sosSummary(): JsonResponse
    {
        $latest = SosAlert::with('sender:id,name')
            ->where('status', SosAlert::STATUS_PENDING)
            ->latest('raised_at')
            ->first();

        return $this->successResponse($this->sosCounts() + [
            'latest_pending' => $latest ? [
                'id' => $latest->id,
                'reference' => $latest->reference,
                'raised_by_role' => $latest->raised_by_role,
                'service' => $latest->service,
                'name' => $latest->sender?->name,
                'raised_at' => $latest->raised_at?->toIso8601String(),
            ] : null,
        ]);
    }

    private function sosCounts(): array
    {
        $counts = SosAlert::whereIn('status', SosAlert::ACTIVE)
            ->selectRaw('status, COUNT(*) as n')->groupBy('status')->pluck('n', 'status');

        return [
            'active' => (int) $counts->sum(),
            'pending' => (int) ($counts[SosAlert::STATUS_PENDING] ?? 0),
        ];
    }

    public function acknowledgeSos(Request $request, SosAlertService $service, string $id): JsonResponse
    {
        return $this->sosAction(fn () => $service->acknowledge($request->user(), (int) $id), $service, 'SOS acknowledged.');
    }

    public function respondSos(Request $request, SosAlertService $service, string $id): JsonResponse
    {
        $data = $request->validate([
            'responder' => ['required', 'string', 'min:2', 'max:120'],
            'note' => ['nullable', 'string', 'max:1000'],
        ]);

        return $this->sosAction(fn () => $service->respond($request->user(), (int) $id, $data['responder'], $data['note'] ?? null), $service, 'Help sent.');
    }

    public function resolveSos(Request $request, SosAlertService $service, string $id): JsonResponse
    {
        $data = $request->validate([
            'outcome' => ['required', Rule::in([SosAlert::OUTCOME_HANDLED, SosAlert::OUTCOME_FALSE_ALARM])],
            'note' => ['required', 'string', 'min:3', 'max:1000'],
        ]);

        return $this->sosAction(fn () => $service->resolve($request->user(), (int) $id, $data['outcome'], $data['note']), $service, 'SOS resolved.');
    }

    private function sosAction(callable $action, SosAlertService $service, string $message): JsonResponse
    {
        try {
            $alert = $action();
        } catch (SosException $e) {
            return $this->errorResponse($e->getMessage(), $e->status);
        }

        return $this->successResponse($service->presentForAdmin($alert), $message);
    }
}
