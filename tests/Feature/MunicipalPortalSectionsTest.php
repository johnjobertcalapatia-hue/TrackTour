<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\BusinessDocument;
use App\Models\Municipality;
use App\Models\Order;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Municipal portal sections beyond account management: documents queue,
 * reports, activity logs, office profile, and the platform-settings boundary.
 */
class MunicipalPortalSectionsTest extends TestCase
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

    public function test_document_queue_lists_only_own_municipality_documents(): void
    {
        $mine = $this->business($this->gloria, 'under_review');
        $theirs = $this->business($this->roxas, 'under_review');
        $pending = $this->document($mine, 'pending');
        $this->document($mine, 'flagged');
        $this->document($theirs, 'pending');
        $this->user(User::ROLE_RIDER, $this->gloria, User::ACCOUNT_STATUS_PENDING);

        $response = $this->actingAs($this->gloriaOfficer, 'sanctum')
            ->getJson('/api/municipal/documents')
            ->assertOk()
            ->assertJsonPath('meta.stats.business_pending', 1)
            ->assertJsonPath('meta.stats.business_flagged', 1)
            ->assertJsonPath('meta.stats.riders_pending', 1);

        $this->assertEquals([$pending->id], collect($response->json('data'))->pluck('id')->all());
        $response->assertJsonPath('data.0.business.id', $mine->id);

        $this->actingAs($this->gloriaOfficer, 'sanctum')
            ->getJson('/api/municipal/documents?type=rider')
            ->assertOk()
            ->assertJsonCount(1, 'data');
    }

    public function test_activity_log_shows_only_this_municipalitys_office_actions(): void
    {
        $gloriaRider = $this->user(User::ROLE_RIDER, $this->gloria, User::ACCOUNT_STATUS_PENDING);
        $roxasRider = $this->user(User::ROLE_RIDER, $this->roxas, User::ACCOUNT_STATUS_PENDING);

        $this->actingAs($this->gloriaOfficer, 'sanctum')->postJson("/api/municipal/riders/{$gloriaRider->id}/approve")->assertOk();
        $this->actingAs($this->roxasOfficer, 'sanctum')->postJson("/api/municipal/riders/{$roxasRider->id}/approve")->assertOk();

        $logs = $this->actingAs($this->gloriaOfficer, 'sanctum')
            ->getJson('/api/municipal/activity-logs?area=rider')
            ->assertOk()
            ->json('data');

        $this->assertCount(1, $logs);
        $this->assertSame('rider.approved', $logs[0]['action']);
        $this->assertStringContainsString($gloriaRider->email, $logs[0]['description']);
        $this->assertStringNotContainsString('Tourism Office]', $logs[0]['description']);

        $this->actingAs($this->gloriaOfficer, 'sanctum')
            ->getJson('/api/municipal/dashboard')
            ->assertOk()
            ->assertJsonCount(1, 'data.recent_activity');

        // A removed office account's history stays visible through the audit prefix.
        $this->gloriaOfficer->update(['municipality_id' => null]);
        $replacement = $this->user(User::ROLE_TOURISM_OFFICE, $this->gloria);
        $this->actingAs($replacement, 'sanctum')
            ->getJson('/api/municipal/activity-logs')
            ->assertOk()
            ->assertJsonCount(1, 'data');
    }

    public function test_bansud_can_monitor_one_municipalitys_office_activity(): void
    {
        $rider = $this->user(User::ROLE_RIDER, $this->gloria, User::ACCOUNT_STATUS_PENDING);
        $this->actingAs($this->gloriaOfficer, 'sanctum')->postJson("/api/municipal/riders/{$rider->id}/approve")->assertOk();
        $other = $this->user(User::ROLE_RIDER, $this->roxas, User::ACCOUNT_STATUS_PENDING);
        $this->actingAs($this->roxasOfficer, 'sanctum')->postJson("/api/municipal/riders/{$other->id}/approve")->assertOk();

        $logs = $this->actingAs($this->user(User::ROLE_BANSUD_TOURISM_OFFICE, null), 'sanctum')
            ->getJson("/api/admin/audit-logs?municipality_id={$this->gloria->id}")
            ->assertOk()
            ->json('data');

        $this->assertCount(1, $logs);
        $this->assertSame($this->gloriaOfficer->id, $logs[0]['user_id']);
    }

    public function test_reports_count_only_this_municipalitys_share_of_a_group_checkout(): void
    {
        $gloriaGrill = $this->business($this->gloria, 'approved');
        $roxasCafe = $this->business($this->roxas, 'approved');
        $tourist = $this->user(User::ROLE_TOURIST, null);

        // One canonical order with items from two municipalities (AGENTS §4.1).
        $order = Order::create([
            'order_number' => 'ORD-'.Str::upper(Str::random(8)),
            'user_id' => $tourist->id,
            'business_id' => $roxasCafe->id,
            'customer_name' => 'Kim',
            'status' => 'completed',
            'total' => 500,
        ]);
        $this->item($order, $gloriaGrill, 300);
        $this->item($order, $roxasCafe, 200);
        $this->item($order, $gloriaGrill, 999, 'cancelled');

        // Single-restaurant orders leave order_items.business_id empty; the
        // order's own business owns the item.
        $single = Order::create([
            'order_number' => 'ORD-'.Str::upper(Str::random(8)),
            'user_id' => $tourist->id,
            'business_id' => $gloriaGrill->id,
            'customer_name' => 'Kim',
            'status' => 'delivered',
            'total' => 150,
        ]);
        $this->item($single, null, 150);

        $report = $this->actingAs($this->gloriaOfficer, 'sanctum')
            ->getJson('/api/municipal/reports')
            ->assertOk();

        $data = $report->json('data');
        $this->assertSame(2, $data['orders']['total']);
        $this->assertSame(2, $data['orders']['completed']);
        $this->assertEquals(450, $data['orders']['item_sales']);
        $this->assertSame(2, $data['top_businesses'][0]['orders']);
        $this->assertSame($gloriaGrill->id, $data['top_businesses'][0]['id']);
        $this->assertSame(1, $data['tourists']['active_in_range']);
        $this->assertCount(30, $data['orders']['trend']);

        $roxas = $this->actingAs($this->roxasOfficer, 'sanctum')->getJson('/api/municipal/reports')->json('data');
        $this->assertEquals(200, $roxas['orders']['item_sales']);

        $this->actingAs($this->gloriaOfficer, 'sanctum')
            ->getJson('/api/municipal/reports?from=2024-01-01&to=2026-01-01')
            ->assertStatus(422);
    }

    public function test_office_profile_updates_only_own_municipality(): void
    {
        Storage::fake('public');

        $this->actingAs($this->gloriaOfficer, 'sanctum')
            ->getJson('/api/municipal/profile')
            ->assertOk()
            ->assertJsonPath('data.office_name', 'Gloria Tourism Office')
            ->assertJsonPath('data.municipality.name', 'Gloria');

        $response = $this->actingAs($this->gloriaOfficer, 'sanctum')
            ->post('/api/municipal/profile', [
                'office_name' => 'Gloria Municipal Tourism Office',
                'phone' => '0917 000 1111',
                'municipality_id' => $this->roxas->id, // ignored: scope comes from the account
                'logo' => UploadedFile::fake()->image('logo.png'),
            ], ['Accept' => 'application/json'])
            ->assertOk()
            ->assertJsonPath('data.office_name', 'Gloria Municipal Tourism Office');

        $logo = $response->json('data.logo_url');
        $this->assertStringStartsWith('/storage/municipalities/'.$this->gloria->id.'/', $logo);
        Storage::disk('public')->assertExists(str_replace('/storage/', '', $logo));
        $this->assertSame($logo, $this->gloria->fresh()->logo);
        $this->assertNull($this->roxas->fresh()->logo);
        $this->assertDatabaseHas('tourism_settings', ['municipality_id' => $this->gloria->id, 'key' => 'office_phone', 'value' => '0917 000 1111']);
        $this->assertDatabaseMissing('tourism_settings', ['municipality_id' => $this->roxas->id]);
        $this->assertDatabaseMissing('tourism_settings', ['municipality_id' => null, 'key' => 'office_name']);

        $this->actingAs($this->roxasOfficer, 'sanctum')
            ->getJson('/api/municipal/profile')
            ->assertJsonPath('data.office_name', 'Roxas Tourism Office');
    }

    public function test_municipal_offices_cannot_change_platform_wide_settings(): void
    {
        $before = DB::table('tourism_settings')->count();

        $this->actingAs($this->gloriaOfficer, 'sanctum')
            ->putJson('/api/tourism-office/landing-content', ['hero_title' => 'Hijacked'])
            ->assertForbidden();
        $this->actingAs($this->gloriaOfficer, 'sanctum')
            ->postJson('/api/tourism-office/categories', ['name' => 'Beaches'])
            ->assertForbidden();
        $this->actingAs($this->gloriaOfficer, 'sanctum')
            ->postJson('/api/tourism-office/documents', ['name' => 'Permit'])
            ->assertForbidden();

        $this->assertSame($before, DB::table('tourism_settings')->count());
        $this->assertDatabaseMissing('tourism_categories', ['name' => 'Beaches']);
    }

    private function user(string $role, ?Municipality $municipality, string $status = User::ACCOUNT_STATUS_APPROVED): User
    {
        return User::create([
            'name' => ucfirst($role).' '.Str::random(4),
            'email' => Str::lower($role.'.'.Str::random(10)).'@example.com',
            'password' => 'Password123!',
            'role' => $role,
            'account_status' => $status,
            'municipality_id' => $municipality?->id,
        ]);
    }

    private function business(Municipality $municipality, string $status): Business
    {
        return Business::create([
            'owner_id' => $this->user(User::ROLE_BUSINESS_OWNER, $municipality)->id,
            'business_category_id' => $this->category->id,
            'municipality_id' => $municipality->id,
            'business_name' => 'Biz '.Str::random(6),
            'business_description' => 'Test business',
            'status' => $status,
        ]);
    }

    private function document(Business $business, string $status): BusinessDocument
    {
        return BusinessDocument::create([
            'business_id' => $business->id,
            'file_path' => 'businesses/documents/'.Str::random(6).'.pdf',
            'verification_status' => $status,
        ]);
    }

    private function item(Order $order, ?Business $business, float $subtotal, string $status = 'ready'): void
    {
        DB::table('order_items')->insert([
            'order_id' => $order->id,
            'business_id' => $business?->id,
            'product_name' => 'Dish',
            'quantity' => 1,
            'unit_price' => $subtotal,
            'subtotal' => $subtotal,
            'status' => $status,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
