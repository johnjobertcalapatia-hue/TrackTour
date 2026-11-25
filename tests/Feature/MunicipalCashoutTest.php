<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Municipality;
use App\Models\Order;
use App\Models\RiderEarning;
use App\Models\RiderPayout;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\Concerns\MakesVerifiedEarnings;
use Tests\TestCase;

/**
 * Municipal Office plan Stage 4 (decision D2): a municipal Tourism Office
 * reviews, approves and rejects its own riders' cashouts; the Bansud Tourism
 * Office sends every GCash payment and keeps every cashout.
 */
class MunicipalCashoutTest extends TestCase
{
    use MakesVerifiedEarnings;
    use RefreshDatabase;

    private Municipality $gloria;
    private Municipality $bansud;
    private User $gloriaOffice;
    private User $bansudAdmin;
    private User $gloriaRider;
    private User $bansudRider;
    private Business $business;
    private int $minutesAgo = 100;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        $this->bansud = Municipality::create(['name' => 'Bansud', 'district' => '2nd', 'province' => 'Oriental Mindoro']);
        $this->gloria = Municipality::create(['name' => 'Gloria', 'district' => '2nd', 'province' => 'Oriental Mindoro']);
        $this->gloriaOffice = $this->user('tourism_office', $this->gloria, 'Gloria Officer', 'Gloria-pass1');
        $this->bansudAdmin = $this->user('bansud_tourism_office', $this->bansud, 'Bansud Admin', 'Bansud-pass1');
        $this->gloriaRider = $this->user('rider', $this->gloria, 'Gloria Rider');
        $this->bansudRider = $this->user('rider', $this->bansud, 'Bansud Rider');

        $owner = $this->user('business_owner', $this->gloria, 'Owner');
        $this->business = Business::create([
            'owner_id' => $owner->id, 'business_category_id' => BusinessCategory::create(['name' => 'Restaurant'])->id,
            'municipality_id' => $this->gloria->id, 'business_name' => 'Aelia Cafe', 'status' => 'approved',
        ]);
    }

    private function user(string $role, Municipality $m, string $name, string $password = 'x'): User
    {
        return User::create([
            'name' => $name, 'email' => Str::lower($role.'.'.Str::random(8)).'@cashout.test', 'password' => Hash::make($password),
            'role' => $role, 'account_status' => 'approved', 'municipality_id' => $m->id,
        ]);
    }

    /** A verified online earning and the rider's cashout request for it. */
    private function cashoutFor(User $rider, float $amount = 80): int
    {
        $order = Order::create([
            'order_number' => 'TT-'.Str::upper(Str::random(6)), 'business_id' => $this->business->id,
            'customer_name' => 'Ana', 'customer_email' => 'ana@example.com', 'order_type' => 'delivery',
            'payment_method' => 'gcash', 'payment_status' => 'pending', 'status' => 'completed',
            'subtotal' => 300, 'delivery_fee' => 60, 'rider_tip' => 0, 'system_fee' => 0, 'rider_financed_amount' => 300, 'total' => 360,
        ]);
        $this->verifyEarningSource($order, $rider->id);
        RiderEarning::create([
            'rider_id' => $rider->id, 'order_id' => $order->id, 'delivery_fee' => 60, 'rider_tip' => 0,
            'total_earning' => $amount, 'status' => 'earned', 'earned_at' => now()->subMinutes($this->minutesAgo--),
        ]);

        return $this->actingAs($rider, 'sanctum')->postJson('/api/rider/payouts/request', [
            'gcash_number' => '09171234567', 'account_name' => $rider->name,
        ])->assertSuccessful()->json('data.id');
    }

    private function evidence(int $id): array
    {
        return [
            'password' => 'Bansud-pass1', 'reference' => '5012345678901', 'amount' => (float) RiderPayout::find($id)->amount,
            'recipient_number' => '09171234567', 'recipient_name' => 'Gloria Rider', 'paid_at' => now()->subMinute()->toDateTimeString(),
            'proof' => UploadedFile::fake()->image('gcash.jpg'),
        ];
    }

    public function test_the_municipal_office_reviews_and_approves_and_bansud_pays(): void
    {
        $id = $this->cashoutFor($this->gloriaRider);
        $this->actingAs($this->gloriaOffice, 'sanctum');

        $this->getJson("/api/municipal/payouts/{$id}")->assertOk()->assertJsonPath('data.rider.municipality', 'Gloria');
        $this->postJson("/api/municipal/payouts/{$id}/start-review")->assertOk()->assertJsonPath('data.status', 'under_review');
        $this->postJson("/api/municipal/payouts/{$id}/approve", ['password' => 'Gloria-pass1'])->assertOk()
            ->assertJsonPath('data.status', 'approved')
            ->assertJsonPath('message', 'Cashout approved. The Bansud Tourism Office will send the GCash payment.')
            ->assertJsonPath('data.review.approved_by.office', 'Gloria Tourism Office');

        // The payment step is Bansud's: those routes do not exist under /municipal,
        // so the request is a 404 (not a 405 on an existing URI) and changes nothing.
        $this->post("/api/municipal/payouts/{$id}/mark-paid", $this->evidence($id), ['Accept' => 'application/json'])->assertNotFound();
        $this->postJson("/api/municipal/payouts/{$id}/mark-failed", ['password' => 'Gloria-pass1', 'reason' => 'x'])->assertNotFound();
        $this->assertSame('approved', RiderPayout::find($id)->status);

        // Bansud sees who approved and pays (a different person, as the two-person rule wants).
        $this->actingAs($this->bansudAdmin, 'sanctum');
        $list = $this->getJson('/api/admin/payouts?status=approved')->assertOk();
        $this->assertSame('Gloria', $list->json('data.0.rider.municipality'));
        $paid = $this->post("/api/admin/payouts/{$id}/mark-paid", $this->evidence($id), ['Accept' => 'application/json'])->assertOk()->json('data');
        $this->assertSame('paid', $paid['status']);
        $this->assertSame('Bansud Tourism Office', $paid['payment']['paid_by']['office']);
        $this->assertSame('Gloria Tourism Office', $paid['review']['approved_by']['office']);

        // The town can see the payment proof for its own rider.
        $this->actingAs($this->gloriaOffice, 'sanctum')->get("/api/municipal/payouts/{$id}/proof")->assertOk();
    }

    public function test_the_municipal_office_can_reject_with_a_reason(): void
    {
        $id = $this->cashoutFor($this->gloriaRider);

        $this->actingAs($this->gloriaOffice, 'sanctum')->postJson("/api/municipal/payouts/{$id}/reject", ['reason' => 'Earnings under investigation.'])
            ->assertOk()->assertJsonPath('data.status', 'rejected');
    }

    public function test_the_municipal_office_sees_and_touches_only_its_own_riders_cashouts(): void
    {
        $mine = $this->cashoutFor($this->gloriaRider, 80);
        $theirs = $this->cashoutFor($this->bansudRider, 50);
        $this->actingAs($this->gloriaOffice, 'sanctum');

        $this->assertSame([$mine], collect($this->getJson('/api/municipal/payouts')->assertOk()->json('data'))->pluck('id')->all());
        $summary = $this->getJson('/api/municipal/payouts/summary')->assertOk()->json('data');
        $this->assertSame(1, $summary['pending_count']);
        $this->assertEquals(80, $summary['awaiting_review_amount']);

        $this->getJson("/api/municipal/payouts/{$theirs}")->assertNotFound();
        $this->postJson("/api/municipal/payouts/{$theirs}/start-review")->assertNotFound();
        $this->postJson("/api/municipal/payouts/{$theirs}/approve", ['password' => 'Gloria-pass1'])->assertNotFound();
        $this->postJson("/api/municipal/payouts/{$theirs}/reject", ['reason' => 'Not ours.'])->assertNotFound();
        $this->postJson("/api/municipal/payouts/{$theirs}/validate")->assertNotFound();
        $this->get("/api/municipal/payouts/{$theirs}/proof", ['Accept' => 'application/json'])->assertNotFound();
        $earning = RiderEarning::where('rider_id', $this->bansudRider->id)->value('id');
        $this->getJson("/api/municipal/payouts/{$theirs}/earnings/{$earning}")->assertNotFound();

        $this->assertSame('pending', RiderPayout::find($theirs)->status);
    }

    public function test_bansud_keeps_every_cashout_and_can_still_approve_a_towns_rider(): void
    {
        $gloria = $this->cashoutFor($this->gloriaRider, 80);
        $this->cashoutFor($this->bansudRider, 50);
        $this->actingAs($this->bansudAdmin, 'sanctum');

        $this->assertCount(2, $this->getJson('/api/admin/payouts')->json('data'));
        $this->assertSame(2, $this->getJson('/api/admin/payouts/summary')->json('data.pending_count'));
        $this->postJson("/api/admin/payouts/{$gloria}/approve", ['password' => 'Bansud-pass1'])->assertOk()
            ->assertJsonPath('data.review.approved_by.office', 'Bansud Tourism Office');
    }

    public function test_municipal_offices_cannot_use_bansud_cashout_routes_and_others_cannot_use_theirs(): void
    {
        $id = $this->cashoutFor($this->gloriaRider);

        $this->actingAs($this->gloriaOffice, 'sanctum')->getJson('/api/admin/payouts')->assertForbidden();
        $this->actingAs($this->gloriaOffice, 'sanctum')->post("/api/admin/payouts/{$id}/mark-paid", $this->evidence($id), ['Accept' => 'application/json'])->assertForbidden();
        $this->actingAs($this->gloriaRider, 'sanctum')->getJson('/api/municipal/payouts')->assertForbidden();
        $this->actingAs($this->bansudAdmin, 'sanctum')->getJson('/api/municipal/payouts')->assertForbidden();
        $this->assertSame('pending', RiderPayout::find($id)->status);
    }
}
