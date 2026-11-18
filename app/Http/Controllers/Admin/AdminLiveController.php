<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\Delivery;
use App\Models\Municipality;
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

    public function sos(): JsonResponse
    {
        return $this->successResponse([]);
    }

    public function acknowledgeSos(string $id): JsonResponse
    {
        return $this->successResponse(null, 'SOS acknowledged.');
    }

    public function respondSos(string $id): JsonResponse
    {
        return $this->successResponse(null, 'Response dispatched.');
    }

    public function resolveSos(string $id): JsonResponse
    {
        return $this->successResponse(null, 'SOS resolved.');
    }
}
