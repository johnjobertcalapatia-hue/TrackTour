<?php

namespace Tests\Feature;

use App\Models\Municipality;
use App\Models\TourismAnnouncement;
use App\Models\TourismCategory;
use App\Models\TourismEvent;
use App\Models\TouristDestination;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * Municipal Office plan Stage 0 (docs/municipal-office-plan.md): a municipal
 * Tourism Office could create, edit and delete ANY municipality's destinations,
 * events and announcements through /tourism-office. Now it only sees and
 * changes its own municipality; the Bansud Tourism Office still manages all.
 */
class TourismContentMunicipalScopeTest extends TestCase
{
    use RefreshDatabase;

    private Municipality $gloria;
    private Municipality $bongabong;
    private User $gloriaOffice;
    private User $bansud;
    private TourismCategory $category;
    private TouristDestination $gloriaSpot;
    private TouristDestination $bongabongSpot;
    private TourismEvent $bongabongEvent;
    private TourismAnnouncement $bongabongNotice;

    protected function setUp(): void
    {
        parent::setUp();
        $this->gloria = Municipality::create(['name' => 'Gloria', 'district' => '1st', 'province' => 'Oriental Mindoro']);
        $this->bongabong = Municipality::create(['name' => 'Bongabong', 'district' => '2nd', 'province' => 'Oriental Mindoro']);
        $this->gloriaOffice = $this->office('tourism_office', $this->gloria);
        $this->bansud = $this->office('bansud_tourism_office');
        $this->category = TourismCategory::create(['name' => 'Beach', 'slug' => 'beach']);

        $this->gloriaSpot = $this->destination('Gloria Falls', $this->gloria);
        $this->bongabongSpot = $this->destination('Bongabong Beach', $this->bongabong);
        $this->bongabongEvent = TourismEvent::create(['municipality_id' => $this->bongabong->id, 'name' => 'Bongabong Fiesta', 'description' => 'x', 'location' => 'Plaza', 'start_date' => now()->addWeek(), 'end_date' => now()->addWeek(), 'status' => 'upcoming']);
        TourismEvent::create(['municipality_id' => $this->gloria->id, 'name' => 'Gloria Fiesta', 'description' => 'x', 'location' => 'Plaza', 'start_date' => now()->addWeek(), 'end_date' => now()->addWeek(), 'status' => 'upcoming']);
        $this->bongabongNotice = TourismAnnouncement::create(['municipality_id' => $this->bongabong->id, 'title' => 'Bongabong road closure', 'content' => 'x', 'type' => 'general', 'status' => 'published']);
    }

    private function office(string $role, ?Municipality $municipality = null): User
    {
        return User::create([
            'email' => $role.'.'.($municipality?->id ?? 'district').'@scope.test',
            'password' => Hash::make('Password123!'),
            'role' => $role,
            'account_status' => 'approved',
            'municipality_id' => $municipality?->id,
        ]);
    }

    private function destination(string $name, Municipality $municipality): TouristDestination
    {
        return TouristDestination::create([
            'municipality_id' => $municipality->id, 'category_id' => $this->category->id,
            'name' => $name, 'slug' => str($name)->slug(), 'description' => 'x', 'address' => 'x',
            'latitude' => 12.9, 'longitude' => 121.4, 'status' => 'active',
        ]);
    }

    private function destinationPayload(array $extra = []): array
    {
        return [
            'name' => 'New Spot', 'description' => 'x', 'address' => 'x',
            'latitude' => 12.9, 'longitude' => 121.4, 'category_id' => $this->category->id,
        ] + $extra;
    }

    // ─── Municipal office: own municipality only ──────────────────────────

    public function test_municipal_office_lists_only_its_own_content(): void
    {
        $this->actingAs($this->gloriaOffice, 'sanctum');

        $this->assertSame(['Gloria Falls'], collect($this->getJson('/api/tourism-office/destinations')->assertOk()->json('data.data'))->pluck('name')->all());
        $this->assertSame(['Gloria Fiesta'], collect($this->getJson('/api/tourism-office/events')->assertOk()->json('data.data'))->pluck('name')->all());
        $this->assertSame([], $this->getJson('/api/tourism-office/announcements')->assertOk()->json('data.data'));

        $stats = $this->getJson('/api/tourism-office/management/dashboard')->assertOk()->json('data.stats');
        $this->assertSame(1, $stats['total_destinations']);
        $this->assertSame(1, $stats['total_events']);
        $this->assertSame(0, $stats['total_announcements']);
    }

    public function test_municipal_office_cannot_read_change_or_delete_another_municipalitys_content(): void
    {
        $this->actingAs($this->gloriaOffice, 'sanctum');

        $this->getJson("/api/tourism-office/destinations/{$this->bongabongSpot->id}")->assertNotFound();
        $this->putJson("/api/tourism-office/destinations/{$this->bongabongSpot->id}", ['name' => 'Hijacked'])->assertNotFound();
        $this->deleteJson("/api/tourism-office/destinations/{$this->bongabongSpot->id}")->assertNotFound();
        $this->putJson("/api/tourism-office/events/{$this->bongabongEvent->id}", ['name' => 'Hijacked'])->assertNotFound();
        $this->deleteJson("/api/tourism-office/events/{$this->bongabongEvent->id}")->assertNotFound();
        $this->putJson("/api/tourism-office/announcements/{$this->bongabongNotice->id}", ['title' => 'Hijacked'])->assertNotFound();
        $this->deleteJson("/api/tourism-office/announcements/{$this->bongabongNotice->id}")->assertNotFound();

        $this->assertSame('Bongabong Beach', $this->bongabongSpot->fresh()->name);
        $this->assertSame('Bongabong Fiesta', $this->bongabongEvent->fresh()->name);
        $this->assertSame('Bongabong road closure', $this->bongabongNotice->fresh()->title);
    }

    public function test_municipal_office_creates_content_in_its_own_municipality(): void
    {
        $this->actingAs($this->gloriaOffice, 'sanctum');

        // No municipality given: it is filled from the account.
        $id = $this->postJson('/api/tourism-office/destinations', $this->destinationPayload())->assertCreated()->json('data.id');
        $this->assertSame($this->gloria->id, TouristDestination::find($id)->municipality_id);

        $id = $this->postJson('/api/tourism-office/events', ['name' => 'Night Market', 'description' => 'x', 'location' => 'x', 'start_date' => now()->addDay()->toDateString(), 'end_date' => now()->addDays(2)->toDateString()])->assertCreated()->json('data.id');
        $this->assertSame($this->gloria->id, TourismEvent::find($id)->municipality_id);

        $id = $this->postJson('/api/tourism-office/announcements', ['title' => 'Welcome', 'content' => 'x', 'type' => 'general'])->assertCreated()->json('data.id');
        $this->assertSame($this->gloria->id, TourismAnnouncement::find($id)->municipality_id);
    }

    public function test_municipal_office_cannot_create_or_move_content_into_another_municipality(): void
    {
        $this->actingAs($this->gloriaOffice, 'sanctum');
        $before = TouristDestination::count();

        $this->postJson('/api/tourism-office/destinations', $this->destinationPayload(['municipality_id' => $this->bongabong->id]))->assertForbidden();
        $this->postJson('/api/tourism-office/announcements', ['title' => 'x', 'content' => 'x', 'type' => 'general', 'municipality_id' => $this->bongabong->id])->assertForbidden();
        $this->putJson("/api/tourism-office/destinations/{$this->gloriaSpot->id}", ['municipality_id' => $this->bongabong->id])->assertForbidden();

        $this->assertSame($before, TouristDestination::count());
        $this->assertSame($this->gloria->id, $this->gloriaSpot->fresh()->municipality_id);
    }

    public function test_municipal_office_can_edit_and_delete_its_own_content(): void
    {
        $this->actingAs($this->gloriaOffice, 'sanctum');

        $this->putJson("/api/tourism-office/destinations/{$this->gloriaSpot->id}", ['name' => 'Gloria Twin Falls'])->assertOk();
        $this->assertSame('Gloria Twin Falls', $this->gloriaSpot->fresh()->name);

        $this->deleteJson("/api/tourism-office/destinations/{$this->gloriaSpot->id}")->assertOk();
        $this->assertNull(TouristDestination::find($this->gloriaSpot->id));
    }

    public function test_unassigned_or_suspended_municipal_office_is_refused(): void
    {
        $unassigned = $this->office('tourism_office');
        $suspended = User::create(['email' => 'suspended@scope.test', 'password' => Hash::make('x'), 'role' => 'tourism_office', 'account_status' => 'suspended', 'municipality_id' => $this->gloria->id]);

        foreach ([$unassigned, $suspended] as $officer) {
            $this->actingAs($officer, 'sanctum')->getJson('/api/tourism-office/destinations')->assertForbidden();
            $this->actingAs($officer, 'sanctum')->postJson('/api/tourism-office/destinations', $this->destinationPayload(['municipality_id' => $this->gloria->id]))->assertForbidden();
        }
    }

    // ─── Bansud: unchanged, district-wide ─────────────────────────────────

    public function test_bansud_still_manages_every_municipality(): void
    {
        $this->actingAs($this->bansud, 'sanctum');

        $this->assertCount(2, $this->getJson('/api/tourism-office/destinations')->assertOk()->json('data.data'));
        $this->putJson("/api/tourism-office/destinations/{$this->bongabongSpot->id}", ['name' => 'Bongabong White Beach'])->assertOk();
        $this->assertSame('Bongabong White Beach', $this->bongabongSpot->fresh()->name);

        $id = $this->postJson('/api/tourism-office/destinations', $this->destinationPayload(['municipality_id' => $this->bongabong->id]))->assertCreated()->json('data.id');
        $this->assertSame($this->bongabong->id, TouristDestination::find($id)->municipality_id);

        // Bansud must still say which municipality.
        $this->postJson('/api/tourism-office/destinations', $this->destinationPayload())->assertUnprocessable();

        $this->assertSame(2, $this->getJson('/api/tourism-office/management/dashboard')->json('data.stats.total_events'));
    }
}
