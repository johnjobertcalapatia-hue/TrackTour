<?php

namespace Tests\Feature;

use App\Models\ActivityLog;
use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\BusinessDocument;
use App\Models\Municipality;
use App\Models\Order;
use App\Models\RiderDetail;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Municipality Tourism Admin (`tourism_office`) portal: every read and write
 * is confined to the officer's own municipality (users.municipality_id).
 */
class MunicipalAdminTest extends TestCase
{
    use RefreshDatabase;

    private Municipality $gloria;
    private Municipality $roxas;
    private User $gloriaOfficer;
    private User $roxasOfficer;
    private BusinessCategory $category;

    protected function setUp(): void
    {
        parent::setUp();

        $this->gloria = Municipality::create(['name' => 'Gloria', 'district' => 'District 2', 'province' => 'Oriental Mindoro']);
        $this->roxas = Municipality::create(['name' => 'Roxas', 'district' => 'District 2', 'province' => 'Oriental Mindoro']);
        $this->gloriaOfficer = $this->user(User::ROLE_TOURISM_OFFICE, $this->gloria);
        $this->roxasOfficer = $this->user(User::ROLE_TOURISM_OFFICE, $this->roxas);
        $this->category = BusinessCategory::create(['name' => 'Restaurant']);
    }

    // ------------------------------------------------------------------
    // Access control
    // ------------------------------------------------------------------

    public function test_non_municipal_roles_are_denied(): void
    {
        foreach ([User::ROLE_TOURIST, User::ROLE_RIDER, User::ROLE_BUSINESS_OWNER, User::ROLE_BANSUD_TOURISM_OFFICE] as $role) {
            $this->actingAs($this->user($role, $this->gloria), 'sanctum')
                ->getJson('/api/municipal/dashboard')
                ->assertForbidden();
        }
    }

    public function test_guests_are_unauthenticated(): void
    {
        $this->getJson('/api/municipal/dashboard')->assertUnauthorized();
    }

    public function test_officer_without_an_active_municipality_is_denied(): void
    {
        $unassigned = $this->user(User::ROLE_TOURISM_OFFICE, null);
        $this->actingAs($unassigned, 'sanctum')
            ->getJson('/api/municipal/dashboard')
            ->assertForbidden()
            ->assertJsonPath('success', false);

        $this->roxas->delete();
        $this->actingAs($this->roxasOfficer->fresh(), 'sanctum')
            ->getJson('/api/municipal/dashboard')
            ->assertForbidden();
    }

    public function test_suspended_officer_is_denied(): void
    {
        $this->gloriaOfficer->update(['account_status' => User::ACCOUNT_STATUS_SUSPENDED]);

        $this->actingAs($this->gloriaOfficer, 'sanctum')
            ->getJson('/api/municipal/riders')
            ->assertForbidden();
    }

    public function test_municipal_officer_cannot_use_district_municipality_management(): void
    {
        $this->actingAs($this->gloriaOfficer, 'sanctum')
            ->postJson('/api/admin/municipalities', ['name' => 'Pola', 'district' => 'D1', 'province' => 'Oriental Mindoro'])
            ->assertForbidden();

        $this->actingAs($this->gloriaOfficer, 'sanctum')
            ->postJson("/api/admin/municipalities/{$this->gloria->id}/admins", [])
            ->assertForbidden();

        $this->assertDatabaseMissing('municipalities', ['name' => 'Pola']);
    }

    // ------------------------------------------------------------------
    // Dashboard
    // ------------------------------------------------------------------

    public function test_dashboard_counts_only_the_officers_municipality(): void
    {
        $gloriaOwner = $this->user(User::ROLE_BUSINESS_OWNER, $this->gloria, User::ACCOUNT_STATUS_PENDING);
        $this->business($gloriaOwner, $this->gloria, 'under_review');
        $this->business($gloriaOwner, $this->gloria, 'approved');
        $this->user(User::ROLE_RIDER, $this->gloria, User::ACCOUNT_STATUS_PENDING);
        $onlineRider = $this->user(User::ROLE_RIDER, $this->gloria);
        RiderDetail::create(['user_id' => $onlineRider->id, 'rider_status' => 'available']);

        $roxasOwner = $this->user(User::ROLE_BUSINESS_OWNER, $this->roxas, User::ACCOUNT_STATUS_PENDING);
        $this->business($roxasOwner, $this->roxas, 'under_review');
        $this->user(User::ROLE_RIDER, $this->roxas, User::ACCOUNT_STATUS_PENDING);

        $response = $this->actingAs($this->gloriaOfficer, 'sanctum')
            ->getJson('/api/municipal/dashboard')
            ->assertOk();

        $response->assertJsonPath('data.municipality.name', 'Gloria')
            ->assertJsonPath('data.stats.business_owners.total', 1)
            ->assertJsonPath('data.stats.business_owners.pending', 1)
            ->assertJsonPath('data.stats.businesses.total', 2)
            ->assertJsonPath('data.stats.businesses.pending', 1)
            ->assertJsonPath('data.stats.businesses.approved', 1)
            ->assertJsonPath('data.stats.riders.total', 2)
            ->assertJsonPath('data.stats.riders.pending', 1)
            ->assertJsonPath('data.stats.riders.active_now', 1);

        $this->assertCount(1, $response->json('data.pending.businesses'));
        $this->assertCount(1, $response->json('data.pending.riders'));
    }

    // ------------------------------------------------------------------
    // Business owners
    // ------------------------------------------------------------------

    public function test_business_owner_list_is_scoped_and_matches_profile_or_business_municipality(): void
    {
        // Registration writes the owner's municipality on the profile only.
        $profileOwner = $this->user(User::ROLE_BUSINESS_OWNER, null);
        $profileOwner->profile()->create(['first_name' => 'Profile', 'last_name' => 'Owner', 'municipality_id' => $this->gloria->id]);
        // An owner whose account sits elsewhere but runs a business in Gloria.
        $businessOwner = $this->user(User::ROLE_BUSINESS_OWNER, $this->roxas);
        $this->business($businessOwner, $this->gloria, 'approved');
        $outsider = $this->user(User::ROLE_BUSINESS_OWNER, $this->roxas);

        $ids = collect($this->actingAs($this->gloriaOfficer, 'sanctum')
            ->getJson('/api/municipal/business-owners')
            ->assertOk()
            ->json('data'))->pluck('id');

        $this->assertTrue($ids->contains($profileOwner->id));
        $this->assertTrue($ids->contains($businessOwner->id));
        $this->assertFalse($ids->contains($outsider->id));
    }

    public function test_officer_can_approve_and_suspend_own_business_owner_with_audit(): void
    {
        $owner = $this->user(User::ROLE_BUSINESS_OWNER, $this->gloria, User::ACCOUNT_STATUS_PENDING);

        $this->actingAs($this->gloriaOfficer, 'sanctum')
            ->postJson("/api/municipal/business-owners/{$owner->id}/approve")
            ->assertOk();
        $this->assertSame(User::ACCOUNT_STATUS_APPROVED, $owner->fresh()->account_status);
        $this->assertDatabaseHas('approval_requests', ['user_id' => $owner->id, 'status' => 'approved', 'reviewed_by' => $this->gloriaOfficer->id]);

        $log = ActivityLog::where('action', 'business_owner.approved')->where('model_id', $owner->id)->first();
        $this->assertNotNull($log);
        $this->assertSame($this->gloriaOfficer->id, $log->user_id);
        $this->assertStringStartsWith('[Gloria Tourism Office]', $log->description);

        $this->actingAs($this->gloriaOfficer, 'sanctum')
            ->postJson("/api/municipal/business-owners/{$owner->id}/suspend")
            ->assertStatus(422);

        $this->actingAs($this->gloriaOfficer, 'sanctum')
            ->postJson("/api/municipal/business-owners/{$owner->id}/suspend", ['remarks' => 'Expired permit'])
            ->assertOk();
        $this->assertSame(User::ACCOUNT_STATUS_SUSPENDED, $owner->fresh()->account_status);
    }

    public function test_officer_cannot_touch_another_municipalitys_business_owner(): void
    {
        $owner = $this->user(User::ROLE_BUSINESS_OWNER, $this->roxas, User::ACCOUNT_STATUS_PENDING);

        $this->actingAs($this->gloriaOfficer, 'sanctum')
            ->getJson("/api/municipal/business-owners/{$owner->id}")
            ->assertNotFound();

        $this->actingAs($this->gloriaOfficer, 'sanctum')
            ->postJson("/api/municipal/business-owners/{$owner->id}/approve")
            ->assertNotFound();

        $this->assertSame(User::ACCOUNT_STATUS_PENDING, $owner->fresh()->account_status);
        $this->assertDatabaseMissing('approval_requests', ['user_id' => $owner->id]);
    }

    public function test_business_owner_routes_never_moderate_other_roles(): void
    {
        $rider = $this->user(User::ROLE_RIDER, $this->gloria, User::ACCOUNT_STATUS_PENDING);

        $this->actingAs($this->gloriaOfficer, 'sanctum')
            ->postJson("/api/municipal/business-owners/{$rider->id}/approve")
            ->assertNotFound();

        $this->actingAs($this->gloriaOfficer, 'sanctum')
            ->postJson("/api/municipal/business-owners/{$this->gloriaOfficer->id}/suspend", ['remarks' => 'x'])
            ->assertNotFound();

        $this->assertSame(User::ACCOUNT_STATUS_PENDING, $rider->fresh()->account_status);
        $this->assertSame(User::ACCOUNT_STATUS_APPROVED, $this->gloriaOfficer->fresh()->account_status);
    }

    // ------------------------------------------------------------------
    // Businesses
    // ------------------------------------------------------------------

    public function test_business_list_is_scoped(): void
    {
        $owner = $this->user(User::ROLE_BUSINESS_OWNER, $this->gloria);
        $mine = $this->business($owner, $this->gloria, 'under_review');
        $theirs = $this->business($owner, $this->roxas, 'under_review');

        $response = $this->actingAs($this->gloriaOfficer, 'sanctum')
            ->getJson('/api/municipal/businesses?status=pending')
            ->assertOk()
            ->assertJsonPath('meta.stats.pending', 1);

        $ids = collect($response->json('data'))->pluck('id');
        $this->assertTrue($ids->contains($mine->id));
        $this->assertFalse($ids->contains($theirs->id));
    }

    public function test_business_approval_requires_verified_documents_then_succeeds(): void
    {
        $owner = $this->user(User::ROLE_BUSINESS_OWNER, $this->gloria);
        $business = $this->business($owner, $this->gloria, 'under_review');
        $document = BusinessDocument::create([
            'business_id' => $business->id,
            'file_path' => 'businesses/documents/permit.pdf',
            'verification_status' => 'pending',
        ]);

        $this->actingAs($this->gloriaOfficer, 'sanctum')
            ->postJson("/api/municipal/businesses/{$business->id}/approve")
            ->assertStatus(422);
        $this->assertSame('under_review', $business->fresh()->status);

        $this->actingAs($this->gloriaOfficer, 'sanctum')
            ->putJson("/api/municipal/businesses/{$business->id}/documents/{$document->id}/review", ['verification_status' => 'verified'])
            ->assertOk();

        $this->actingAs($this->gloriaOfficer, 'sanctum')
            ->postJson("/api/municipal/businesses/{$business->id}/approve")
            ->assertOk()
            ->assertJsonPath('data.status', 'approved');

        $this->assertDatabaseHas('business_status_logs', ['business_id' => $business->id, 'status' => 'approved', 'reviewed_by' => $this->gloriaOfficer->id]);
    }

    public function test_officer_cannot_moderate_or_review_another_municipalitys_business(): void
    {
        $owner = $this->user(User::ROLE_BUSINESS_OWNER, $this->roxas);
        $business = $this->business($owner, $this->roxas, 'approved');
        $document = BusinessDocument::create([
            'business_id' => $business->id,
            'file_path' => 'businesses/documents/permit.pdf',
            'verification_status' => 'verified',
        ]);

        $this->actingAs($this->gloriaOfficer, 'sanctum')->getJson("/api/municipal/businesses/{$business->id}")->assertNotFound();
        $this->actingAs($this->gloriaOfficer, 'sanctum')
            ->postJson("/api/municipal/businesses/{$business->id}/suspend", ['remarks' => 'Not yours'])
            ->assertNotFound();
        $this->actingAs($this->gloriaOfficer, 'sanctum')
            ->putJson("/api/municipal/businesses/{$business->id}/documents/{$document->id}/review", ['verification_status' => 'flagged'])
            ->assertNotFound();

        $this->assertSame('approved', $business->fresh()->status);
        $this->assertSame('verified', $document->fresh()->verification_status);
    }

    // ------------------------------------------------------------------
    // Riders
    // ------------------------------------------------------------------

    public function test_rider_list_and_moderation_are_scoped(): void
    {
        $mine = $this->user(User::ROLE_RIDER, $this->gloria, User::ACCOUNT_STATUS_PENDING);
        $theirs = $this->user(User::ROLE_RIDER, $this->roxas, User::ACCOUNT_STATUS_PENDING);

        $ids = collect($this->actingAs($this->gloriaOfficer, 'sanctum')
            ->getJson('/api/municipal/riders')->assertOk()->json('data'))->pluck('id');
        $this->assertEquals([$mine->id], $ids->all());

        $this->actingAs($this->gloriaOfficer, 'sanctum')
            ->postJson("/api/municipal/riders/{$mine->id}/approve")
            ->assertOk();
        $this->assertSame(User::ACCOUNT_STATUS_APPROVED, $mine->fresh()->account_status);
        $this->assertDatabaseHas('rider_reviews', ['rider_id' => $mine->id, 'admin_id' => $this->gloriaOfficer->id, 'decision' => 'approved']);

        $this->actingAs($this->gloriaOfficer, 'sanctum')
            ->postJson("/api/municipal/riders/{$theirs->id}/approve")
            ->assertNotFound();
        $this->assertSame(User::ACCOUNT_STATUS_PENDING, $theirs->fresh()->account_status);
        $this->assertDatabaseMissing('rider_reviews', ['rider_id' => $theirs->id]);
    }

    public function test_rider_reject_requires_remarks_and_reactivate_restores_access(): void
    {
        $rider = $this->user(User::ROLE_RIDER, $this->gloria);

        $this->actingAs($this->gloriaOfficer, 'sanctum')
            ->postJson("/api/municipal/riders/{$rider->id}/suspend")
            ->assertStatus(422);

        $this->actingAs($this->gloriaOfficer, 'sanctum')
            ->postJson("/api/municipal/riders/{$rider->id}/suspend", ['remarks' => 'Unsafe driving report'])
            ->assertOk();
        $this->assertSame(User::ACCOUNT_STATUS_SUSPENDED, $rider->fresh()->account_status);

        $this->actingAs($this->gloriaOfficer, 'sanctum')
            ->postJson("/api/municipal/riders/{$rider->id}/reactivate")
            ->assertOk();
        $this->assertSame(User::ACCOUNT_STATUS_APPROVED, $rider->fresh()->account_status);
    }

    public function test_unknown_moderation_action_is_not_routable(): void
    {
        $rider = $this->user(User::ROLE_RIDER, $this->gloria, User::ACCOUNT_STATUS_PENDING);

        $this->actingAs($this->gloriaOfficer, 'sanctum')
            ->postJson("/api/municipal/riders/{$rider->id}/delete")
            ->assertNotFound();

        $this->assertSame(User::ACCOUNT_STATUS_PENDING, $rider->fresh()->account_status);
    }

    // ------------------------------------------------------------------
    // Tourists (read-only)
    // ------------------------------------------------------------------

    public function test_tourists_are_those_who_ordered_from_the_municipality_and_are_read_only(): void
    {
        $owner = $this->user(User::ROLE_BUSINESS_OWNER, $this->gloria);
        $gloriaBusiness = $this->business($owner, $this->gloria, 'approved');
        $roxasBusiness = $this->business($owner, $this->roxas, 'approved');

        $gloriaTourist = $this->user(User::ROLE_TOURIST, null);
        $roxasTourist = $this->user(User::ROLE_TOURIST, null);
        $this->order($gloriaTourist, $gloriaBusiness);
        $this->order($roxasTourist, $roxasBusiness);

        $response = $this->actingAs($this->gloriaOfficer, 'sanctum')
            ->getJson('/api/municipal/tourists')
            ->assertOk()
            ->assertJsonPath('meta.stats.total', 1);

        $this->assertEquals([$gloriaTourist->id], collect($response->json('data'))->pluck('id')->all());
        $this->assertSame(1, $response->json('data.0.orders_count'));

        $this->actingAs($this->gloriaOfficer, 'sanctum')
            ->getJson("/api/municipal/tourists/{$gloriaTourist->id}")
            ->assertOk()
            ->assertJsonCount(1, 'data.orders');

        $this->actingAs($this->gloriaOfficer, 'sanctum')
            ->getJson("/api/municipal/tourists/{$roxasTourist->id}")
            ->assertNotFound();

        $this->actingAs($this->gloriaOfficer, 'sanctum')
            ->postJson("/api/municipal/tourists/{$gloriaTourist->id}/suspend", ['remarks' => 'x'])
            ->assertNotFound();
        $this->assertSame(User::ACCOUNT_STATUS_APPROVED, $gloriaTourist->fresh()->account_status);
    }

    // ------------------------------------------------------------------
    // Cross-municipality leaks in the shared endpoints
    // ------------------------------------------------------------------

    public function test_private_documents_are_limited_to_the_officers_municipality(): void
    {
        Storage::fake('local');
        Storage::disk('local')->put('businesses/documents/permit.pdf', 'permit');
        Storage::disk('local')->put('riders/license.jpg', 'license');

        $owner = $this->user(User::ROLE_BUSINESS_OWNER, $this->roxas);
        $business = $this->business($owner, $this->roxas, 'under_review');
        $document = BusinessDocument::create([
            'business_id' => $business->id,
            'file_path' => 'businesses/documents/permit.pdf',
            'verification_status' => 'pending',
        ]);
        $rider = $this->user(User::ROLE_RIDER, $this->roxas);
        $detail = RiderDetail::create(['user_id' => $rider->id, 'drivers_license_front' => 'riders/license.jpg']);

        $this->actingAs($this->gloriaOfficer, 'sanctum')
            ->getJson("/api/business-documents/{$document->id}/file")->assertNotFound();
        $this->actingAs($this->gloriaOfficer, 'sanctum')
            ->getJson("/api/rider-details/{$detail->id}/verification-documents/drivers-license-front")->assertNotFound();

        $this->actingAs($this->roxasOfficer, 'sanctum')
            ->getJson("/api/business-documents/{$document->id}/file")->assertOk();
        $this->actingAs($this->roxasOfficer, 'sanctum')
            ->getJson("/api/rider-details/{$detail->id}/verification-documents/drivers-license-front")->assertOk();

        $this->actingAs($this->user(User::ROLE_BANSUD_TOURISM_OFFICE, null), 'sanctum')
            ->getJson("/api/business-documents/{$document->id}/file")->assertOk();
    }

    public function test_legacy_tourism_office_owner_endpoints_are_scoped_for_municipal_officers(): void
    {
        $mine = $this->user(User::ROLE_BUSINESS_OWNER, $this->gloria, User::ACCOUNT_STATUS_PENDING);
        $theirs = $this->user(User::ROLE_BUSINESS_OWNER, $this->roxas, User::ACCOUNT_STATUS_PENDING);

        $ids = collect($this->actingAs($this->gloriaOfficer, 'sanctum')
            ->getJson('/api/tourism-office/business-owners')->assertOk()->json('data'))->pluck('id');
        $this->assertTrue($ids->contains($mine->id));
        $this->assertFalse($ids->contains($theirs->id));

        $this->actingAs($this->gloriaOfficer, 'sanctum')
            ->patchJson("/api/tourism-office/business-owners/{$theirs->id}/status", ['status' => 'approved'])
            ->assertNotFound();
        $this->assertSame(User::ACCOUNT_STATUS_PENDING, $theirs->fresh()->account_status);

        // The district admin keeps the district-wide view.
        $districtIds = collect($this->actingAs($this->user(User::ROLE_BANSUD_TOURISM_OFFICE, null), 'sanctum')
            ->getJson('/api/tourism-office/business-owners')->assertOk()->json('data'))->pluck('id');
        $this->assertTrue($districtIds->contains($theirs->id));
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private function user(string $role, ?Municipality $municipality, string $status = User::ACCOUNT_STATUS_APPROVED): User
    {
        return User::create([
            'name' => ucfirst(str_replace('_', ' ', $role)).' '.Str::random(4),
            'email' => Str::lower($role.'.'.Str::random(10)).'@example.com',
            'password' => 'Password123!',
            'role' => $role,
            'account_status' => $status,
            'municipality_id' => $municipality?->id,
        ]);
    }

    private function business(User $owner, Municipality $municipality, string $status): Business
    {
        return Business::create([
            'owner_id' => $owner->id,
            'business_category_id' => $this->category->id,
            'municipality_id' => $municipality->id,
            'business_name' => 'Biz '.Str::random(6),
            'business_description' => 'Test business',
            'status' => $status,
        ]);
    }

    private function order(User $tourist, Business $business): Order
    {
        return Order::create([
            'order_number' => 'ORD-'.Str::upper(Str::random(8)),
            'user_id' => $tourist->id,
            'business_id' => $business->id,
            'customer_name' => $tourist->name,
            'status' => 'delivered',
        ]);
    }
}
