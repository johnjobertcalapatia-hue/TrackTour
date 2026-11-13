<?php

namespace Tests\Feature;

use App\Models\ActivityLog;
use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Delivery;
use App\Models\Municipality;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Payment;
use App\Models\RiderEarning;
use App\Models\TransactionBlueprint;
use App\Models\TransactionCheckpoint;
use App\Models\TransactionEvent;
use App\Models\User;
use App\Services\Integrity\TransactionCheckpointService;
use App\Services\Integrity\TransactionIntegrityService;
use App\Services\Integrity\TransactionLedger;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use LogicException;
use Tests\TestCase;

/**
 * Secure transaction architecture, Stage 2: shared transaction blueprint,
 * append-only SHA-256 event chain, signed checkpoints and the integrity
 * service (docs/secure-transaction-audit.md).
 */
class TransactionIntegrityTest extends TestCase
{
    use RefreshDatabase;

    private User $tourist;

    private User $rider;

    private User $admin;

    private Business $business;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');

        $this->tourist = User::create(['name' => 'Jayvie De Torres', 'email' => 'tourist@example.com', 'password' => Hash::make('x'), 'role' => 'tourist', 'account_status' => 'approved']);
        $this->rider = User::create(['name' => 'Aldrin Robledo', 'email' => 'rider@example.com', 'password' => Hash::make('x'), 'role' => 'rider', 'account_status' => 'approved']);
        $this->admin = User::create(['name' => 'Staff A', 'email' => 'a@bansud.gov.ph', 'password' => Hash::make('x'), 'role' => 'bansud_tourism_office', 'account_status' => 'approved']);
        $owner = User::create(['email' => 'owner@example.com', 'password' => Hash::make('x'), 'role' => 'business_owner', 'account_status' => 'approved']);
        $this->business = Business::create([
            'owner_id' => $owner->id,
            'business_category_id' => BusinessCategory::create(['name' => 'Restaurant'])->id,
            'municipality_id' => Municipality::create(['name' => 'Bansud', 'district' => '2nd', 'province' => 'Oriental Mindoro'])->id,
            'business_name' => 'Ekslusibo Grill',
            'status' => 'approved',
        ]);
    }

    private function order(string $type = 'delivery', string $method = 'gcash'): Order
    {
        $order = Order::create([
            'order_number' => 'TT-'.Str::upper(Str::random(6)),
            'user_id' => $this->tourist->id,
            'business_id' => $type === 'transport' ? null : $this->business->id,
            'customer_name' => 'Jayvie De Torres',
            'order_type' => $type,
            'payment_method' => $method,
            'payment_status' => 'pending',
            'status' => 'pending',
            'subtotal' => 300, 'delivery_fee' => 60, 'rider_tip' => 0, 'system_fee' => 0, 'rider_financed_amount' => 300, 'total' => 360,
        ]);
        if ($type === 'delivery') {
            OrderItem::create(['order_id' => $order->id, 'business_id' => $this->business->id, 'product_name' => 'Chicken Inasal', 'quantity' => 2, 'unit_price' => 150, 'subtotal' => 300, 'status' => 'pending']);
        }

        return $order;
    }

    /** Full lifecycle through the canonical records: paid, assigned, delivered, earned. */
    private function completedOrder(): Order
    {
        $order = $this->order();
        Payment::create([
            'payment_number' => 'PAY-'.Str::upper(Str::random(8)), 'payable_type' => Order::class, 'payable_id' => $order->id, 'user_id' => $this->tourist->id,
            'amount' => 360, 'currency' => 'PHP', 'method' => 'gcash', 'provider' => 'paymongo', 'provider_payment_id' => 'pay_'.Str::random(12), 'status' => 'paid', 'paid_at' => now(),
        ]);
        $order->update(['payment_status' => 'paid']);
        $delivery = Delivery::create(['order_id' => $order->id, 'status' => 'waiting', 'pickup_address' => 'P', 'delivery_address' => 'D', 'rider_commission' => 40]);
        $delivery->update(['rider_id' => $this->rider->id, 'status' => 'assigned']);
        $delivery->update(['status' => 'picked_up', 'picked_up_at' => now()]);
        $delivery->update(['status' => 'delivered', 'delivered_at' => now()]);
        $order->update(['status' => 'completed']);
        RiderEarning::create(['rider_id' => $this->rider->id, 'order_id' => $order->id, 'delivery_fee' => 60, 'rider_tip' => 0, 'total_earning' => 40, 'status' => 'earned', 'earned_at' => now()]);

        return $order->fresh();
    }

    private function blueprint(Order $order): TransactionBlueprint
    {
        return TransactionBlueprint::where('order_id', $order->id)->firstOrFail();
    }

    private function verify(Order $order): array
    {
        return app(TransactionIntegrityService::class)->verifyOrder($order);
    }

    private function failed(array $result): array
    {
        return collect($result['checks'])->where('ok', false)->pluck('key')->values()->all();
    }

    /** Simulates someone with direct database privileges (bypassing the app). */
    private function dropLedgerTriggers(): void
    {
        foreach (['transaction_events', 'transaction_checkpoints', 'transaction_checkpoint_entries'] as $t) {
            DB::unprepared("DROP TRIGGER IF EXISTS {$t}_no_update");
            DB::unprepared("DROP TRIGGER IF EXISTS {$t}_no_delete");
        }
    }

    // ---------------- blueprint + event chain ----------------

    public function test_a_food_order_gets_a_blueprint_and_a_linked_event_chain(): void
    {
        $order = $this->order();
        $bp = $this->blueprint($order);

        $this->assertSame(TransactionBlueprint::TYPE_FOOD, $bp->transaction_type);
        $this->assertSame($this->tourist->id, $bp->customer_id);
        $this->assertFalse($bp->legacy);

        $events = TransactionEvent::where('blueprint_id', $bp->id)->orderBy('sequence')->get();
        $this->assertSame(['order_created', 'order_item_added'], $events->pluck('event_type')->all());
        $this->assertSame(TransactionLedger::GENESIS, $events[0]->previous_hash);
        $this->assertSame($events[0]->current_hash, $events[1]->previous_hash);
        $this->assertSame($events[1]->current_hash, $bp->current_hash);
        $this->assertSame('300.00', $events[1]->payload['subtotal']);
        $this->assertArrayNotHasKey('customer_email', $events[0]->payload); // references, not contact details

        $this->assertSame('pass', $this->verify($order)['result']);
    }

    public function test_a_completed_online_order_records_its_whole_lifecycle_and_passes(): void
    {
        $order = $this->completedOrder();
        $bp = $this->blueprint($order);
        $types = TransactionEvent::where('blueprint_id', $bp->id)->orderBy('sequence')->pluck('event_type');

        foreach (['order_created', 'payment_verified', 'delivery_created', 'rider_assigned', 'delivery_status_changed', 'order_status_changed', 'earning_posted'] as $type) {
            $this->assertContains($type, $types);
        }
        $this->assertSame($this->rider->id, $bp->rider_id);
        $this->assertNotNull($bp->finalized_at);

        $result = $this->verify($order);
        $this->assertSame('pass', $result['result'], json_encode($result['checks']));
        $this->assertContains('lifecycle', collect($result['checks'])->pluck('key'));
        $this->assertSame(TransactionBlueprint::STATUS_VERIFIED, $bp->fresh()->integrity_status);
    }

    public function test_rides_are_ride_hailing_and_pickup_orders_are_out_of_scope(): void
    {
        $this->assertSame(TransactionBlueprint::TYPE_RIDE, $this->blueprint($this->order('transport'))->transaction_type);
        $pickup = $this->order('pickup');
        $this->assertNull(TransactionBlueprint::where('order_id', $pickup->id)->first());
    }

    // ---------------- append-only ----------------

    public function test_events_cannot_be_updated_or_deleted_by_the_app_or_the_database(): void
    {
        $this->order();
        $event = TransactionEvent::firstOrFail();

        try {
            $event->update(['event_type' => 'forged']);
            $this->fail('Model update should be refused.');
        } catch (LogicException) {
        }
        try {
            $event->delete();
            $this->fail('Model delete should be refused.');
        } catch (LogicException) {
        }
        $this->expectException(QueryException::class);
        DB::table('transaction_events')->where('id', $event->id)->update(['event_type' => 'forged']);
    }

    public function test_the_database_also_refuses_deleting_events(): void
    {
        $this->order();
        $this->expectException(QueryException::class);
        DB::table('transaction_events')->delete();
    }

    public function test_a_sequence_number_cannot_be_used_twice(): void
    {
        $order = $this->order();
        $first = TransactionEvent::where('blueprint_id', $this->blueprint($order)->id)->where('sequence', 1)->firstOrFail();

        $this->expectException(QueryException::class);
        DB::table('transaction_events')->insert([
            'blueprint_id' => $first->blueprint_id, 'sequence' => 1, 'event_type' => 'forged', 'actor_role' => 'system',
            'payload' => '{}', 'recorded_at_ms' => 1, 'previous_hash' => TransactionLedger::GENESIS, 'current_hash' => str_repeat('a', 64),
        ]);
    }

    // ---------------- tamper detection ----------------

    public function test_an_earning_edited_directly_in_the_database_is_blocked(): void
    {
        $order = $this->completedOrder();
        DB::table('rider_earnings')->where('order_id', $order->id)->update(['total_earning' => 999]);

        $result = $this->verify($order);
        $this->assertSame('block', $result['result']);
        // Stage 2 history and the Stage 5 earnings ledger both catch it.
        $this->assertEqualsCanonicalizing(['earnings', 'earning_ledger'], $this->failed($result));
        $this->assertSame(TransactionBlueprint::STATUS_INVALID, $this->blueprint($order)->integrity_status);
        $this->assertTrue(ActivityLog::where('action', 'integrity.blocked')->where('type', ActivityLog::TYPE_SECURITY)->exists());
    }

    public function test_amounts_payments_and_rider_changed_outside_the_app_are_blocked(): void
    {
        $order = $this->completedOrder();
        DB::table('orders')->where('id', $order->id)->update(['total' => 3600]);
        DB::table('payments')->where('payable_id', $order->id)->update(['amount' => 3600]);
        DB::table('deliveries')->where('order_id', $order->id)->update(['rider_id' => $this->admin->id]);

        $result = $this->verify($order);
        $this->assertSame('block', $result['result']);
        $this->assertEqualsCanonicalizing(['amounts', 'payments', 'rider'], $this->failed($result));
    }

    public function test_legitimate_changes_through_the_app_stay_verified(): void
    {
        $order = $this->completedOrder();
        // Since Stage 5 an earning is corrected by a ledger adjustment, never an edit.
        app(\App\Services\RiderEarningLedger::class)->adjust(RiderEarning::where('order_id', $order->id)->first(), 5, 'Waiting time', null);
        $order->update(['rider_tip' => 5, 'total' => 365]); // recorded as order_amounts_changed

        $this->assertSame('pass', $this->verify($order)['result']);
        $this->assertTrue(\App\Models\RiderEarningEntry::where('entry_type', 'adjustment')->exists());
    }

    public function test_an_edited_event_breaks_the_chain(): void
    {
        $order = $this->completedOrder();
        $this->dropLedgerTriggers();
        $earning = TransactionEvent::where('event_type', 'earning_posted')->firstOrFail();
        DB::table('transaction_events')->where('id', $earning->id)->update(['payload' => json_encode(['earning_id' => 1, 'total_earning' => '999.00'])]);

        $result = $this->verify($order);
        $this->assertSame('block', $result['result']);
        $this->assertContains('chain', $this->failed($result));
    }

    public function test_a_fully_recomputed_chain_is_caught_by_the_signed_checkpoint(): void
    {
        $order = $this->completedOrder();
        $checkpoint = app(TransactionCheckpointService::class)->create();
        $this->assertNotNull($checkpoint);
        $this->assertTrue(Storage::disk('local')->exists($checkpoint->export_path));

        // An attacker with database access rewrites the earning event AND
        // recomputes every later hash and the blueprint head, so the chain
        // itself looks intact again.
        $this->dropLedgerTriggers();
        $bp = $this->blueprint($order);
        $previous = TransactionLedger::GENESIS;
        foreach (TransactionEvent::where('blueprint_id', $bp->id)->orderBy('sequence')->get() as $event) {
            $payload = $event->payload;
            if ($event->event_type === 'earning_posted') {
                $payload['total_earning'] = '999.00';
            }
            $copy = $event->replicate();
            $copy->setRawAttributes(array_merge($event->getAttributes(), ['previous_hash' => $previous]));
            $copy->payload = $payload;
            $hash = TransactionLedger::hashOf($copy, $bp->blueprint_uid);
            DB::table('transaction_events')->where('id', $event->id)->update(['payload' => json_encode($payload), 'previous_hash' => $previous, 'current_hash' => $hash]);
            $previous = $hash;
        }
        DB::table('transaction_blueprints')->where('id', $bp->id)->update(['current_hash' => $previous]);
        DB::table('rider_earnings')->where('order_id', $order->id)->update(['total_earning' => 999]);

        $result = $this->verify($order);
        $this->assertSame('block', $result['result']);
        $failed = $this->failed($result);
        $this->assertNotContains('chain', $failed);      // the forged chain is self-consistent…
        $this->assertNotContains('earnings', $failed);   // …and matches the forged earning…
        $this->assertContains('checkpoint', $failed);    // …but not the signed checkpoint.
    }

    public function test_a_forged_checkpoint_or_a_differing_export_is_detected(): void
    {
        $order = $this->completedOrder();
        $checkpoint = app(TransactionCheckpointService::class)->create();
        $service = app(TransactionCheckpointService::class);
        $this->assertTrue($service->verify($checkpoint)['ok']);

        Storage::disk('local')->put($checkpoint->export_path, json_encode(['root_hash' => str_repeat('0', 64), 'signature' => 'x', 'entries' => []]));
        $this->assertContains('The database checkpoint differs from its exported copy.', $service->verify($checkpoint)['problems']);

        $this->dropLedgerTriggers();
        DB::table('transaction_checkpoints')->where('id', $checkpoint->id)->update(['root_hash' => str_repeat('b', 64)]);
        $problems = $service->verify(TransactionCheckpoint::find($checkpoint->id))['problems'];
        $this->assertContains('Its signature is not valid.', $problems);
        $this->assertSame('block', $this->verify($order)['result']);
    }

    public function test_a_checkpoint_covers_only_changed_histories_and_chains_to_the_previous_one(): void
    {
        $service = app(TransactionCheckpointService::class);
        $a = $this->completedOrder();
        $first = $service->create();
        $this->assertNull($service->create()); // nothing changed

        $a->update(['status' => 'completed', 'rider_tip' => 2, 'total' => 362]);
        $second = $service->create();
        $this->assertSame(1, $second->entries_count);
        $this->assertSame($first->root_hash, $second->previous_root);
        $this->assertTrue($service->verify($second)['ok']);
        $this->assertSame('pass', $this->verify($a)['result']);
    }

    // ---------------- legacy and lifecycle ----------------

    public function test_orders_from_before_the_ledger_are_flagged_not_blocked(): void
    {
        config(['integrity.enabled' => false]);
        $order = $this->completedOrder();
        config(['integrity.enabled' => true]);
        $this->assertNull(TransactionBlueprint::where('order_id', $order->id)->first());

        $this->artisan('integrity:backfill')->assertSuccessful();
        $bp = $this->blueprint($order);
        $this->assertTrue($bp->legacy);
        $this->assertSame('ledger_opened', TransactionEvent::where('blueprint_id', $bp->id)->value('event_type'));

        $result = $this->verify($order);
        $this->assertSame('flag', $result['result'], json_encode($result['checks']));
        $this->assertContains('history', $this->failed($result));
    }

    public function test_a_finished_online_order_without_a_recorded_payment_is_flagged(): void
    {
        $order = $this->order();
        $delivery = Delivery::create(['order_id' => $order->id, 'rider_id' => $this->rider->id, 'status' => 'assigned', 'pickup_address' => 'P', 'delivery_address' => 'D']);
        $delivery->update(['status' => 'delivered']);

        $result = $this->verify($order);
        $this->assertSame('flag', $result['result']);
        $lifecycle = collect($result['checks'])->firstWhere('key', 'lifecycle');
        $this->assertStringContainsString('payment verification', $lifecycle['detail']);
    }

    // ---------------- commands and API ----------------

    public function test_verify_command_reports_results(): void
    {
        $order = $this->completedOrder();
        DB::table('rider_earnings')->where('order_id', $order->id)->update(['total_earning' => 999]);

        $this->artisan('integrity:verify', ['--all' => true])->expectsOutputToContain('1 block')->assertSuccessful();
        $this->artisan('integrity:checkpoint')->expectsOutputToContain('Checkpoint #1 signed')->assertSuccessful();
    }

    public function test_tourism_office_can_view_and_verify_a_history_and_others_cannot(): void
    {
        $order = $this->completedOrder();

        $data = $this->actingAs($this->admin, 'sanctum')->getJson("/api/admin/integrity/orders/{$order->id}")->assertOk()->json('data');
        $this->assertSame('food_delivery', $data['blueprint']['type']);
        $this->assertSame('order_created', $data['events'][0]['type']);
        $this->assertSame($data['events'][0]['hash'], $data['events'][1]['previous_hash']);

        $this->actingAs($this->admin, 'sanctum')->postJson("/api/admin/integrity/orders/{$order->id}/verify")->assertOk()->assertJsonPath('data.result', 'pass');

        $this->actingAs($this->rider, 'sanctum')->getJson("/api/admin/integrity/orders/{$order->id}")->assertForbidden();
        $this->actingAs($this->tourist, 'sanctum')->postJson("/api/admin/integrity/orders/{$order->id}/verify")->assertForbidden();
    }

    // ---------------- Stage 2 hardening (Stage 3 step A) ----------------

    public function test_rotating_the_checkpoint_key_keeps_older_checkpoints_verifiable(): void
    {
        $service = app(TransactionCheckpointService::class);
        config(['integrity.checkpoint_key' => 'base64:first-key-0000000000000000000000', 'integrity.checkpoint_key_id' => 'k1']);
        $order = $this->completedOrder();
        $first = $service->create();
        $this->assertSame('k1', $first->key_id);

        // Rotate: new current key, the old one retired into OLD_KEYS.
        config([
            'integrity.checkpoint_key' => 'base64:second-key-111111111111111111111',
            'integrity.checkpoint_key_id' => 'k2',
            'integrity.old_keys' => 'k1:base64:first-key-0000000000000000000000',
        ]);
        $order->update(['rider_tip' => 3, 'total' => 363]);
        $second = $service->create();
        $this->assertSame('k2', $second->key_id);
        $this->assertTrue($service->verify($first)['ok']);
        $this->assertTrue($service->verify($second)['ok']);
        $this->assertSame('pass', $this->verify($order)['result']);

        // Losing the retired key is reported, not silently accepted.
        config(['integrity.old_keys' => '']);
        $problems = $service->verify($first)['problems'];
        $this->assertStringContainsString("The key 'k1' that signed it is not configured", implode(' ', $problems));
    }

    public function test_production_refuses_to_sign_without_a_dedicated_key(): void
    {
        $this->completedOrder();
        config(['integrity.checkpoint_key' => null]);
        $this->app['env'] = 'production';
        try {
            $this->artisan('integrity:checkpoint')->expectsOutputToContain('Set a dedicated TRANSACTION_CHECKPOINT_KEY')->assertFailed();
        } finally {
            $this->app['env'] = 'testing';
        }
        $this->assertSame(0, TransactionCheckpoint::count());

        config(['integrity.checkpoint_key' => config('app.key')]);
        $this->artisan('integrity:checkpoint')->expectsOutputToContain('must not equal APP_KEY')->assertFailed();
    }

    public function test_key_command_prints_a_key_without_touching_the_environment(): void
    {
        $this->artisan('integrity:key', ['--id' => 'k9'])
            ->expectsOutputToContain('TRANSACTION_CHECKPOINT_KEY_ID=k9')
            ->expectsOutputToContain('TRANSACTION_CHECKPOINT_KEY=base64:')
            ->assertSuccessful();
    }

    public function test_backfill_is_idempotent_and_records_the_legacy_cutoff(): void
    {
        config(['integrity.enabled' => false]);
        $order = $this->completedOrder();
        config(['integrity.enabled' => true]);

        $this->artisan('integrity:backfill', ['--dry-run' => true])->expectsOutputToContain('1 orders would get a legacy ledger.')->assertSuccessful();
        $this->assertSame(0, TransactionBlueprint::count());

        $this->artisan('integrity:backfill')->expectsOutputToContain('Opened 1 legacy ledgers.')->assertSuccessful();
        $this->artisan('integrity:backfill')->expectsOutputToContain('Opened 0 legacy ledgers.')->assertSuccessful();

        $bp = $this->blueprint($order);
        $this->assertSame(1, TransactionBlueprint::count());
        $this->assertSame(1, $bp->event_count);
        $opened = TransactionEvent::where('blueprint_id', $bp->id)->sole();
        $this->assertNotEmpty($opened->payload['ledger_cutoff']);

        // Missing pre-history is "not recorded" (FLAG), never fraud (BLOCK).
        $result = $this->verify($order);
        $this->assertSame('flag', $result['result']);
        $this->assertSame(['history'], $this->failed($result));
    }
}
