<?php

namespace Tests\Feature;

use App\Models\ActivityLog;
use App\Models\TourismSetting;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * Bansud Tourism Office profile (Admin sidebar "Signed in as" → /admin/profile).
 *
 * The office identity is municipal-wide branding stored in the canonical
 * tourism_settings key/value store, so these tests lock down:
 * - RBAC (admin only; the Tourism Office API role is not enough)
 * - defaults before anything is configured
 * - text details, partial updates and clearing
 * - logo / cover upload, replacement (old file deleted) and removal
 * - invalid uploads and the audit-trail entry
 */
class AdminOfficeProfileTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private User $tourist;

    private User $tourismOffice;

    protected function setUp(): void
    {
        parent::setUp();

        Storage::fake('public');

        // Multipart posts must still get JSON validation errors, not redirects.
        $this->withHeader('Accept', 'application/json');

        $this->admin = User::create([
            'name' => 'Bansud Tourism Office',
            'email' => 'office.profile@bansud.gov.ph',
            'password' => 'Password123!',
            'role' => 'bansud_tourism_office',
            'account_status' => 'approved',
        ]);

        $this->tourist = User::create([
            'name' => 'Tourist Profile',
            'email' => 'tourist.profile@example.com',
            'password' => 'Password123!',
            'role' => 'tourist',
            'account_status' => 'approved',
        ]);

        $this->tourismOffice = User::create([
            'name' => 'Tourism Office Staff',
            'email' => 'tourism.office@bansud.gov.ph',
            'password' => 'Password123!',
            'role' => 'tourism_office',
            'account_status' => 'approved',
        ]);
    }

    private function storedSetting(string $key): ?string
    {
        return TourismSetting::query()
            ->whereNull('municipality_id')
            ->where('key', $key)
            ->value('value');
    }

    public function test_the_office_profile_is_admin_only(): void
    {
        $this->getJson('/api/admin/profile')->assertUnauthorized();

        $this->actingAs($this->tourist, 'sanctum')
            ->getJson('/api/admin/profile')
            ->assertForbidden();

        // The Tourism Office API role cannot reach the Admin surface.
        $this->actingAs($this->tourismOffice, 'sanctum')
            ->getJson('/api/admin/profile')
            ->assertForbidden();

        $this->actingAs($this->tourismOffice, 'sanctum')
            ->postJson('/api/admin/profile', ['name' => 'Hijacked Office'])
            ->assertForbidden();

        $this->assertNull($this->storedSetting('office_name'));
    }

    public function test_defaults_are_returned_before_the_office_configures_anything(): void
    {
        $response = $this->actingAs($this->admin, 'sanctum')
            ->getJson('/api/admin/profile')
            ->assertOk()
            ->assertJsonPath('data.name', 'Bansud Tourism Office')
            ->assertJsonPath('data.about', '')
            ->assertJsonPath('data.email', '')
            ->assertJsonPath('data.phone', '')
            ->assertJsonPath('data.address', 'Municipal Hall, Bansud, Oriental Mindoro')
            ->assertJsonPath('data.logo_url', null)
            ->assertJsonPath('data.cover_url', null);

        $this->assertSame(0, TourismSetting::where('key', 'like', 'office_%')->count());
    }

    public function test_text_details_are_saved_to_the_municipal_settings_store(): void
    {
        $this->actingAs($this->admin, 'sanctum')
            ->postJson('/api/admin/profile', [
                'name' => 'Bansud Tourism & Cultural Office',
                'about' => 'Promoting the beauty of Bansud, Oriental Mindoro.',
                'email' => 'tourism@bansud.gov.ph',
                'phone' => '0917 000 0000',
                'address' => 'Municipal Hall, Poblacion, Bansud, Oriental Mindoro',
            ])
            ->assertOk()
            ->assertJsonPath('data.name', 'Bansud Tourism & Cultural Office')
            ->assertJsonPath('data.email', 'tourism@bansud.gov.ph')
            ->assertJsonPath('message', 'Bansud Tourism Office profile updated successfully.');

        // Municipal-wide values, never a per-municipality override.
        $this->assertSame('Bansud Tourism & Cultural Office', $this->storedSetting('office_name'));
        $this->assertSame('tourism@bansud.gov.ph', $this->storedSetting('office_email'));
        $this->assertSame(1, TourismSetting::where('key', 'office_name')->count());
        $this->assertSame(0, TourismSetting::whereNotNull('municipality_id')->count());
    }

    public function test_a_partial_update_does_not_wipe_untouched_details(): void
    {
        $this->actingAs($this->admin, 'sanctum')
            ->postJson('/api/admin/profile', [
                'name' => 'Bansud Tourism Office',
                'about' => 'First description',
                'phone' => '0917 111 1111',
            ])
            ->assertOk();

        $this->actingAs($this->admin, 'sanctum')
            ->postJson('/api/admin/profile', ['about' => 'Updated description'])
            ->assertOk()
            ->assertJsonPath('data.about', 'Updated description')
            ->assertJsonPath('data.phone', '0917 111 1111');

        $this->assertSame('Bansud Tourism Office', $this->storedSetting('office_name'));
    }

    public function test_an_empty_value_clears_a_detail(): void
    {
        $this->actingAs($this->admin, 'sanctum')
            ->postJson('/api/admin/profile', ['email' => 'tourism@bansud.gov.ph'])
            ->assertOk();

        $this->actingAs($this->admin, 'sanctum')
            ->postJson('/api/admin/profile', ['email' => ''])
            ->assertOk()
            ->assertJsonPath('data.email', '');

        $this->assertNull($this->storedSetting('office_email'));
    }

    public function test_the_logo_is_uploaded_and_replacing_it_removes_the_old_file(): void
    {
        $first = $this->actingAs($this->admin, 'sanctum')
            ->post('/api/admin/profile', [
                'logo' => UploadedFile::fake()->image('bansud-seal.png', 400, 400),
            ])
            ->assertOk();

        $firstLogo = $first->json('data.logo_url');
        $this->assertIsString($firstLogo);
        $this->assertStringStartsWith('/storage/office/logo/', $firstLogo);

        $firstPath = str_replace('/storage/', '', $firstLogo);
        Storage::disk('public')->assertExists($firstPath);

        $second = $this->actingAs($this->admin, 'sanctum')
            ->post('/api/admin/profile', [
                'logo' => UploadedFile::fake()->image('bansud-seal-v2.png', 400, 400),
            ])
            ->assertOk();

        $secondLogo = $second->json('data.logo_url');
        $this->assertNotSame($firstLogo, $secondLogo);
        Storage::disk('public')->assertMissing($firstPath);
        Storage::disk('public')->assertExists(str_replace('/storage/', '', $secondLogo));

        // Only one logo row, always the current file.
        $this->assertSame(1, TourismSetting::where('key', 'office_logo')->count());
        $this->assertSame($secondLogo, $this->storedSetting('office_logo'));
    }

    public function test_the_cover_photo_is_uploaded_and_can_be_removed(): void
    {
        $response = $this->actingAs($this->admin, 'sanctum')
            ->post('/api/admin/profile', [
                'cover' => UploadedFile::fake()->image('bansud-cover.jpg', 1600, 600),
            ])
            ->assertOk();

        $cover = $response->json('data.cover_url');
        $this->assertStringStartsWith('/storage/office/cover/', $cover);
        $path = str_replace('/storage/', '', $cover);
        Storage::disk('public')->assertExists($path);

        $this->actingAs($this->admin, 'sanctum')
            ->post('/api/admin/profile', ['remove_cover' => true])
            ->assertOk()
            ->assertJsonPath('data.cover_url', null);

        Storage::disk('public')->assertMissing($path);
        $this->assertNull($this->storedSetting('office_cover'));
    }

    public function test_the_logo_can_be_removed_without_touching_the_cover(): void
    {
        $this->actingAs($this->admin, 'sanctum')
            ->post('/api/admin/profile', [
                'logo' => UploadedFile::fake()->image('seal.png', 300, 300),
                'cover' => UploadedFile::fake()->image('cover.png', 1200, 400),
            ])
            ->assertOk();

        $response = $this->actingAs($this->admin, 'sanctum')
            ->post('/api/admin/profile', ['remove_logo' => true])
            ->assertOk();

        $this->assertNull($response->json('data.logo_url'));
        $this->assertNotNull($response->json('data.cover_url'));
        $this->assertNull($this->storedSetting('office_logo'));
        $this->assertNotNull($this->storedSetting('office_cover'));
    }

    public function test_invalid_uploads_are_rejected(): void
    {
        $this->actingAs($this->admin, 'sanctum')
            ->post('/api/admin/profile', [
                'logo' => UploadedFile::fake()->create('seal.pdf', 100, 'application/pdf'),
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('logo');

        $this->actingAs($this->admin, 'sanctum')
            ->post('/api/admin/profile', [
                'cover' => UploadedFile::fake()->create('cover.exe', 100),
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('cover');

        // 6 MB logo > the 5 MB limit.
        $this->actingAs($this->admin, 'sanctum')
            ->post('/api/admin/profile', [
                'logo' => UploadedFile::fake()->image('huge.png', 200, 200)->size(6144),
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('logo');

        $this->assertNull($this->storedSetting('office_logo'));
        $this->assertNull($this->storedSetting('office_cover'));
    }

    public function test_a_blank_office_name_is_rejected(): void
    {
        $this->actingAs($this->admin, 'sanctum')
            ->postJson('/api/admin/profile', ['name' => '   '])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('name');
    }

    public function test_the_update_is_recorded_in_the_audit_trail(): void
    {
        $this->actingAs($this->admin, 'sanctum')
            ->post('/api/admin/profile', [
                'name' => 'Bansud Tourism Office',
                'logo' => UploadedFile::fake()->image('seal.png', 300, 300),
            ])
            ->assertOk();

        $log = ActivityLog::where('action', 'office.profile_updated')->first();

        $this->assertNotNull($log);
        $this->assertSame(ActivityLog::TYPE_SETTINGS, $log->type);
        $this->assertSame($this->admin->id, $log->user_id);
        $this->assertStringContainsString('logo', $log->description);
    }
}
