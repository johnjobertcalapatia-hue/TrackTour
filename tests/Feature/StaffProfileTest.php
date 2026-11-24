<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Municipality;
use App\Models\Staff;
use App\Models\StaffActivityLog;
use App\Models\StaffRole;
use App\Models\User;
use App\Models\UserProfile;
use App\Support\StaffPermissions;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * The staff member's own profile (2026-11-24): they see their details and what
 * their roles allow; they change only contact details, photo and password.
 */
class StaffProfileTest extends TestCase
{
    use RefreshDatabase;

    private Staff $staff;

    private User $user;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('public');

        $town = Municipality::create(['name' => 'Bansud', 'district' => '2', 'province' => 'Oriental Mindoro']);
        $owner = User::create(['email' => 'owner@example.com', 'name' => 'owner', 'password' => Hash::make('Password123!'), 'role' => 'business_owner', 'account_status' => 'approved']);
        $grill = Business::create([
            'owner_id' => $owner->id,
            'business_category_id' => BusinessCategory::firstOrCreate(['name' => 'Restaurant'])->id,
            'municipality_id' => $town->id,
            'business_name' => 'Ekslusibo Grill',
            'status' => 'approved',
            'latitude' => 12.86,
            'longitude' => 121.45,
        ]);
        StaffRole::firstOrCreate(['name' => StaffPermissions::ORDER_PICKUP_ROLE]);
        StaffPermissions::seedRolesWithoutGrants();

        $this->user = User::create(['email' => 'maria@staff.test', 'name' => 'maria', 'password' => Hash::make('OldPassword1!'), 'role' => 'staff', 'account_status' => 'approved']);
        UserProfile::create(['user_id' => $this->user->id, 'first_name' => 'Maria', 'last_name' => 'Santos']);
        $this->staff = Staff::create([
            'business_id' => $grill->id,
            'user_id' => $this->user->id,
            'staff_role_id' => StaffRole::where('name', StaffPermissions::ORDER_PICKUP_ROLE)->value('id'),
            'status' => 'active',
            'mobile_number' => '09170000000',
        ]);
    }

    private function token(string $name = 'web'): string
    {
        return $this->user->createToken($name)->plainTextToken;
    }

    public function test_shows_their_own_details_and_roles_without_secrets(): void
    {
        $res = $this->withToken($this->token())->getJson('/api/staff/profile')->assertOk();

        $res->assertJsonPath('data.full_name', 'Maria Santos')
            ->assertJsonPath('data.email', 'maria@staff.test')
            ->assertJsonPath('data.business.name', 'Ekslusibo Grill')
            ->assertJsonPath('data.roles.0', StaffPermissions::ORDER_PICKUP_ROLE);
        $this->assertNotEmpty($res->json('data.permissions'));
        $this->assertStringNotContainsString('password', strtolower($res->getContent()));
        $this->assertStringNotContainsString('OldPassword1', $res->getContent());
    }

    public function test_updates_contact_details_but_nothing_the_owner_controls(): void
    {
        $this->withToken($this->token())->putJson('/api/staff/profile', [
            'mobile_number' => '09171234567',
            'address' => 'Poblacion, Bansud',
            'status' => 'active',
            'staff_role_id' => 999,
            'salary_type' => 'monthly',
            'email' => 'other@example.com',
        ])->assertOk()->assertJsonPath('data.mobile_number', '09171234567');

        $this->staff->refresh();
        $this->assertSame('Poblacion, Bansud', $this->staff->address);
        $this->assertNull($this->staff->salary_type);
        $this->assertSame('maria@staff.test', $this->user->fresh()->email);
        $this->assertSame('09171234567', $this->user->profile->fresh()->mobile_number);
        $this->assertTrue(StaffActivityLog::where('staff_id', $this->staff->id)->where('action', 'staff.contact_updated')->exists());
    }

    public function test_rejects_a_phone_number_with_letters(): void
    {
        $this->withToken($this->token())->putJson('/api/staff/profile', ['mobile_number' => 'call me'])
            ->assertStatus(422)->assertJsonValidationErrors('mobile_number');
    }

    public function test_photo_must_be_jpg_or_png_and_replaces_the_old_one(): void
    {
        $token = $this->token();
        $this->withToken($token)->post('/api/staff/profile/photo', ['photo' => UploadedFile::fake()->create('a.gif', 10, 'image/gif')], ['Accept' => 'application/json'])
            ->assertStatus(422)->assertJsonValidationErrors('photo');

        $first = $this->withToken($token)->post('/api/staff/profile/photo', ['photo' => UploadedFile::fake()->image('a.png')], ['Accept' => 'application/json'])
            ->assertOk()->json('data.profile_picture');
        Storage::disk('public')->assertExists($first);

        $second = $this->withToken($token)->post('/api/staff/profile/photo', ['photo' => UploadedFile::fake()->image('b.jpg')], ['Accept' => 'application/json'])
            ->assertOk()->json('data.profile_picture');
        Storage::disk('public')->assertMissing($first);

        $this->withToken($token)->deleteJson('/api/staff/profile/photo')->assertOk()->assertJsonPath('data.profile_picture', null);
        Storage::disk('public')->assertMissing($second);
    }

    public function test_password_change_needs_the_current_password_and_signs_out_other_devices(): void
    {
        $other = $this->token('phone');
        $current = $this->token('web');

        $this->withToken($current)->putJson('/api/staff/profile/password', [
            'current_password' => 'wrong', 'password' => 'NewPassword1!', 'password_confirmation' => 'NewPassword1!',
        ])->assertStatus(422)->assertJsonPath('errors.current_password.0', 'Your current password is incorrect.');
        $this->assertTrue(Hash::check('OldPassword1!', $this->user->fresh()->password));

        $this->withToken($current)->putJson('/api/staff/profile/password', [
            'current_password' => 'OldPassword1!', 'password' => 'NewPassword1!', 'password_confirmation' => 'NewPassword1!',
        ])->assertOk();
        $this->assertTrue(Hash::check('NewPassword1!', $this->user->fresh()->password));
        $this->assertSame(['web'], $this->user->tokens()->pluck('name')->all());
        $this->assertStringNotContainsString('NewPassword1', StaffActivityLog::where('action', 'staff.password_changed')->value('description'));
        unset($other);
    }

    public function test_suspended_staff_reach_none_of_it(): void
    {
        $token = $this->token();
        $this->staff->update(['status' => 'suspended']);

        $this->withToken($token)->getJson('/api/staff/profile')->assertForbidden();
        $this->withToken($token)->putJson('/api/staff/profile', ['mobile_number' => '0917'])->assertForbidden();
    }

    public function test_other_roles_cannot_use_it(): void
    {
        $owner = User::where('email', 'owner@example.com')->first();
        $this->withToken($owner->createToken('web')->plainTextToken)->getJson('/api/staff/profile')->assertForbidden();
    }
}
