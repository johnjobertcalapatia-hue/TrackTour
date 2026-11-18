<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\Delivery;
use App\Models\Municipality;
use App\Models\Order;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * The Bansud admin Deliveries page is the delivery record of Bansud only:
 * food from Bansud restaurants (including multi-restaurant orders with a
 * Bansud restaurant) and ride-hailing trips by Bansud riders — active trips
 * and the completed / cancelled history.
 */
class AdminDeliveryRecordTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;
    private Municipality $bansud;
    private Municipality $gloria;
    private Business $bansudGrill;
    private Business $gloriaCafe;

    protected function setUp(): void
    {
        parent::setUp();
        $this->bansud = Municipality::create(['name' => 'Bansud', 'district' => 'District 2', 'province' => 'Oriental Mindoro']);
        $this->gloria = Municipality::create(['name' => 'Gloria', 'district' => 'District 2', 'province' => 'Oriental Mindoro']);
        $this->admin = $this->user('bansud_tourism_office', $this->bansud, 'Bansud Admin');
        $owner = $this->user('business_owner', $this->bansud, 'Owner');
        $this->bansudGrill = Business::create(['owner_id' => $owner->id, 'municipality_id' => $this->bansud->id, 'business_name' => 'Bansud Grill', 'status' => 'approved']);
        $this->gloriaCafe = Business::create(['owner_id' => $owner->id, 'municipality_id' => $this->gloria->id, 'business_name' => 'Gloria Cafe', 'status' => 'approved']);
    }

    public function test_only_bansud_deliveries_are_recorded_with_active_and_history(): void
    {
        $rider = $this->user('rider', $this->bansud, 'Juan Rider');
        $active = $this->delivery($this->order('BAN-1', $this->bansudGrill), 'in_transit', $rider);
        $done = $this->delivery($this->order('BAN-2', $this->bansudGrill), 'completed', $rider);
        $cancelled = $this->delivery($this->order('BAN-3', $this->bansudGrill), 'cancelled');
        $gloria = $this->delivery($this->order('GLO-1', $this->gloriaCafe), 'in_transit');

        // Multi-restaurant order whose canonical business is in Gloria but has a Bansud item.
        $mixed = $this->order('MIX-1', $this->gloriaCafe);
        DB::table('order_items')->insert(['order_id' => $mixed->id, 'business_id' => $this->bansudGrill->id, 'product_name' => 'Inihaw', 'quantity' => 1, 'unit_price' => 100, 'subtotal' => 100, 'status' => 'pending', 'created_at' => now(), 'updated_at' => now()]);
        $mixedDelivery = $this->delivery($mixed, 'waiting');

        // Ride-hailing: belongs to the rider's municipality.
        $bansudRide = $this->delivery($this->order('RIDE-1', null, 'transport'), 'in_transit', $rider);
        $gloriaRide = $this->delivery($this->order('RIDE-2', null, 'transport'), 'in_transit', $this->user('rider', $this->gloria, 'Gloria Rider'));

        $all = $this->list(['bucket' => 'all'])->assertOk();
        $ids = collect($all->json('data'))->pluck('id');
        $this->assertEqualsCanonicalizing([$active->id, $done->id, $cancelled->id, $mixedDelivery->id, $bansudRide->id], $ids->all());
        $this->assertNotContains($gloria->id, $ids);
        $this->assertNotContains($gloriaRide->id, $ids);
        $this->assertSame(['active' => 3, 'completed' => 1, 'cancelled' => 1, 'all' => 5], $all->json('meta.counts'));
        $this->assertSame('Bansud', $all->json('meta.municipality.name'));

        $this->assertEqualsCanonicalizing([$active->id, $mixedDelivery->id, $bansudRide->id], collect($this->list([])->json('data'))->pluck('id')->all()); // default: active
        $this->assertSame([$done->id], collect($this->list(['bucket' => 'completed'])->json('data'))->pluck('id')->all());

        $row = collect($all->json('data'))->firstWhere('id', $active->id);
        $this->assertSame('BAN-1', $row['order_number']);
        $this->assertSame('Juan Rider', $row['rider_name']);
        $this->assertSame(['Bansud Grill'], $row['restaurants']);
    }

    public function test_search_type_and_date_filters(): void
    {
        $rider = $this->user('rider', $this->bansud, 'Pedro Santos');
        $food = $this->delivery($this->order('BAN-77', $this->bansudGrill), 'completed', $rider);
        $ride = $this->delivery($this->order('RIDE-9', null, 'transport'), 'completed', $rider);
        $old = $this->delivery($this->order('BAN-OLD', $this->bansudGrill), 'completed');
        $old->forceFill(['created_at' => now()->subDays(40)])->save();

        $this->assertSame([$food->id], collect($this->list(['bucket' => 'all', 'search' => 'BAN-77'])->json('data'))->pluck('id')->all());
        $this->assertEqualsCanonicalizing([$food->id, $ride->id], collect($this->list(['bucket' => 'all', 'search' => 'Pedro'])->json('data'))->pluck('id')->all());
        $this->assertSame([$ride->id], collect($this->list(['bucket' => 'all', 'type' => 'transport'])->json('data'))->pluck('id')->all());
        $this->assertNotContains($old->id, collect($this->list(['bucket' => 'all', 'from' => now('Asia/Manila')->subDays(7)->toDateString()])->json('data'))->pluck('id'));
        $this->list(['bucket' => 'everything'])->assertStatus(422);
    }

    public function test_only_the_bansud_admin_can_read_the_record(): void
    {
        foreach (['tourism_office', 'rider', 'tourist', 'business_owner'] as $role) {
            $this->actingAs($this->user($role, $this->gloria, ucfirst($role)), 'sanctum')->getJson('/api/admin/live/deliveries')->assertForbidden();
        }
    }

    private function list(array $query)
    {
        return $this->actingAs($this->admin, 'sanctum')->getJson('/api/admin/live/deliveries?'.http_build_query($query));
    }

    private function user(string $role, Municipality $m, string $name): User
    {
        return User::create([
            'name' => $name, 'email' => Str::lower($role.'.'.Str::random(8)).'@example.com', 'password' => 'Password123!',
            'role' => $role, 'account_status' => 'approved', 'municipality_id' => $m->id,
        ]);
    }

    private function order(string $number, ?Business $business, string $type = 'delivery'): Order
    {
        return Order::create(['order_number' => $number, 'customer_name' => 'Ana Customer', 'business_id' => $business?->id, 'order_type' => $type, 'total' => 300, 'subtotal' => 250]);
    }

    private function delivery(Order $order, string $status, ?User $rider = null): Delivery
    {
        return Delivery::create(['order_id' => $order->id, 'status' => $status, 'rider_id' => $rider?->id, 'pickup_address' => 'Pag-asa, Bansud', 'delivery_address' => 'Poblacion, Bansud']);
    }
}
