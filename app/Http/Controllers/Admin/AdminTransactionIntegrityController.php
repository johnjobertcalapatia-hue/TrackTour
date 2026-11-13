<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\Order;
use App\Models\TransactionBlueprint;
use App\Models\TransactionEvent;
use App\Models\User;
use App\Services\Integrity\TransactionIntegrityService;
use Illuminate\Http\JsonResponse;

/**
 * Read-only view of an order's transaction blueprint and its hash-chained
 * history, plus an on-demand integrity verification (Tourism Office only).
 */
class AdminTransactionIntegrityController extends Controller
{
    public function __construct(private readonly TransactionIntegrityService $integrity) {}

    public function show(int $order): JsonResponse
    {
        $model = Order::withTrashed()->findOrFail($order);
        $blueprint = TransactionBlueprint::where('order_id', $model->id)->first();
        if (! $blueprint) {
            return $this->successResponse(['order_number' => $model->order_number, 'blueprint' => null, 'events' => [], 'last_check' => null], 'No transaction history recorded.');
        }

        $events = TransactionEvent::where('blueprint_id', $blueprint->id)->orderBy('sequence')->get();
        $actors = User::whereIn('id', $events->pluck('actor_id')->filter()->unique())->pluck('name', 'id');
        $last = $blueprint->checks()->first();

        return $this->successResponse([
            'order_number' => $model->order_number,
            'blueprint' => [
                'uid' => $blueprint->blueprint_uid,
                'type' => $blueprint->transaction_type,
                'integrity_status' => $blueprint->integrity_status,
                'event_count' => $blueprint->event_count,
                'current_hash' => $blueprint->current_hash,
                'legacy' => $blueprint->legacy,
                'finalized_at' => $blueprint->finalized_at,
                'last_verified_at' => $blueprint->last_verified_at,
            ],
            'events' => $events->map(fn (TransactionEvent $e) => [
                'sequence' => $e->sequence,
                'type' => $e->event_type,
                'actor' => $e->actor_id ? ($actors[$e->actor_id] ?? "User #{$e->actor_id}") : 'System',
                'actor_role' => $e->actor_role,
                'source' => $e->source_type ? "{$e->source_type} #{$e->source_id}" : null,
                'payload' => $e->payload,
                'recorded_at' => \Illuminate\Support\Carbon::createFromTimestampMs($e->recorded_at_ms)->toIso8601String(),
                'previous_hash' => $e->previous_hash,
                'hash' => $e->current_hash,
            ])->values(),
            'last_check' => $last ? ['result' => $last->result, 'checks' => $last->checks, 'context' => $last->context, 'at' => $last->created_at] : null,
        ], 'Transaction history.');
    }

    public function verify(int $order): JsonResponse
    {
        $result = $this->integrity->verifyOrder(Order::withTrashed()->findOrFail($order), 'manual');

        return $this->successResponse([
            'result' => $result['result'],
            'checks' => $result['checks'],
            'integrity_status' => $result['blueprint']?->integrity_status,
        ], 'Integrity verified.');
    }
}
