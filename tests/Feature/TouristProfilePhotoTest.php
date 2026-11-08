<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * POST/DELETE /api/tourist/profile/photo — tourist profile picture.
 */
class TouristProfilePhotoTest extends TestCase
{
    use RefreshDatabase;

    private User $tourist;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('public');
        $this->tourist = User::create(['email' => 'tourist@example.com', 'password' => Hash::make('Password123!'), 'role' => 'tourist', 'account_status' => 'approved']);
    }

    public function test_uploads_photo_to_avatar_and_returns_it_as_profile_photo(): void
    {
        $response = $this->actingAs($this->tourist, 'sanctum')
            ->post('/api/tourist/profile/photo', ['photo' => UploadedFile::fake()->image('me.jpg', 400, 400)], ['Accept' => 'application/json'])
            ->assertOk();

        $path = $response->json('data.profile_photo');
        $this->assertStringStartsWith('profiles/', $path);
        Storage::disk('public')->assertExists($path);
        $this->assertSame($path, $this->tourist->fresh()->profile->avatar, 'creates the profile row when missing');
        $this->assertSame($path, $this->actingAs($this->tourist, 'sanctum')->getJson('/api/tourist/profile')->json('data.profile_photo'));
    }

    public function test_replacing_deletes_the_old_file_and_remove_clears_it(): void
    {
        $first = $this->actingAs($this->tourist, 'sanctum')
            ->post('/api/tourist/profile/photo', ['photo' => UploadedFile::fake()->image('a.png')], ['Accept' => 'application/json'])
            ->json('data.profile_photo');
        $second = $this->actingAs($this->tourist, 'sanctum')
            ->post('/api/tourist/profile/photo', ['photo' => UploadedFile::fake()->image('b.png')], ['Accept' => 'application/json'])
            ->json('data.profile_photo');

        Storage::disk('public')->assertMissing($first);
        Storage::disk('public')->assertExists($second);

        $this->actingAs($this->tourist, 'sanctum')->deleteJson('/api/tourist/profile/photo')
            ->assertOk()
            ->assertJsonPath('data.profile_photo', null);
        Storage::disk('public')->assertMissing($second);
        $this->assertNull($this->tourist->fresh()->profile->avatar);
    }

    public function test_rejects_non_images_and_oversized_files(): void
    {
        $this->actingAs($this->tourist, 'sanctum')
            ->post('/api/tourist/profile/photo', ['photo' => UploadedFile::fake()->create('notes.pdf', 10, 'application/pdf')], ['Accept' => 'application/json'])
            ->assertUnprocessable();
        $this->actingAs($this->tourist, 'sanctum')
            ->post('/api/tourist/profile/photo', ['photo' => UploadedFile::fake()->image('huge.jpg')->size(3000)], ['Accept' => 'application/json'])
            ->assertUnprocessable();
        $this->actingAs($this->tourist, 'sanctum')
            ->postJson('/api/tourist/profile/photo', [])
            ->assertUnprocessable();
    }

    public function test_requires_a_signed_in_tourist(): void
    {
        $this->postJson('/api/tourist/profile/photo')->assertUnauthorized();

        $rider = User::create(['email' => 'rider@example.com', 'password' => Hash::make('Password123!'), 'role' => 'rider', 'account_status' => 'approved']);
        $this->actingAs($rider, 'sanctum')
            ->post('/api/tourist/profile/photo', ['photo' => UploadedFile::fake()->image('r.jpg')], ['Accept' => 'application/json'])
            ->assertForbidden();
    }
}
