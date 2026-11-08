<?php

namespace Tests\Feature;

use App\Http\Controllers\BusinessOwnerMenuManageController;
use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Municipality;
use App\Models\Offering;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * Edit Menu Item: more than one food photo. Extra photos are stored in
 * offerings.images and shown to tourists after the main image.
 */
class BusinessOwnerMenuGalleryTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;

    private Business $business;

    private Offering $item;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('public');

        $this->owner = User::create(['email' => 'owner@example.com', 'password' => Hash::make('Password123!'), 'role' => 'business_owner', 'account_status' => 'approved']);
        $municipality = Municipality::create(['name' => 'Bansud', 'district' => '1st', 'province' => 'Oriental Mindoro']);
        $this->business = Business::create([
            'owner_id' => $this->owner->id,
            'business_category_id' => BusinessCategory::create(['name' => 'Restaurant'])->id,
            'municipality_id' => $municipality->id,
            'business_name' => 'Ekslusibo Grill',
            'status' => 'approved',
            'accepts_orders' => true,
        ]);
        $this->item = Offering::create([
            'business_id' => $this->business->id,
            'name' => 'Pork Sisig',
            'price' => 199,
            'image' => 'menu-items/main.jpg',
            'is_available' => true,
            'status' => 'available',
        ]);
    }

    /** PUT is sent as POST + _method, exactly like the frontend's put() helper. */
    private function update(array $data, ?User $as = null)
    {
        return $this->actingAs($as ?? $this->owner, 'sanctum')
            ->post("/api/business-owner/menu/{$this->item->id}", array_merge(['_method' => 'PUT', 'name' => 'Pork Sisig', 'price' => 199], $data), ['Accept' => 'application/json']);
    }

    public function test_owner_adds_several_photos_and_gets_them_back_with_urls(): void
    {
        $response = $this->update(['gallery_images' => [
            UploadedFile::fake()->image('a.jpg'),
            UploadedFile::fake()->image('b.png'),
        ]])->assertOk();

        $gallery = $response->json('data.gallery');
        $this->assertCount(2, $gallery);
        foreach ($gallery as $photo) {
            $this->assertStringStartsWith('menu-items/', $photo['path']);
            $this->assertStringEndsWith($photo['path'], $photo['url']);
            Storage::disk('public')->assertExists($photo['path']);
        }
        $this->assertSame(array_column($gallery, 'path'), $this->item->fresh()->images);
        $this->assertSame('menu-items/main.jpg', $this->item->fresh()->image, 'the main image is untouched');

        // The edit page reloads the item with the same gallery.
        $this->actingAs($this->owner, 'sanctum')->getJson("/api/business-owner/menu/{$this->item->id}")
            ->assertOk()
            ->assertJsonPath('data.gallery.1.path', $gallery[1]['path']);
    }

    public function test_removing_a_photo_deletes_it_and_keeps_the_rest_in_order(): void
    {
        $paths = array_column($this->update(['gallery_images' => [
            UploadedFile::fake()->image('a.jpg'),
            UploadedFile::fake()->image('b.jpg'),
            UploadedFile::fake()->image('c.jpg'),
        ]])->json('data.gallery'), 'path');

        $this->update(['remove_gallery' => [$paths[1]], 'gallery_images' => [UploadedFile::fake()->image('d.jpg')]])->assertOk();

        $images = $this->item->fresh()->images;
        $this->assertCount(3, $images);
        $this->assertSame([$paths[0], $paths[2]], array_slice($images, 0, 2));
        Storage::disk('public')->assertMissing($paths[1]);
        Storage::disk('public')->assertExists($images[2]);
    }

    public function test_cannot_delete_files_that_are_not_this_items_photos(): void
    {
        Storage::disk('public')->put('menu-items/other.jpg', 'x');
        $this->update(['remove_gallery' => ['menu-items/other.jpg', 'menu-items/main.jpg']])->assertOk();

        Storage::disk('public')->assertExists('menu-items/other.jpg');
        $this->assertSame('menu-items/main.jpg', $this->item->fresh()->image);
    }

    public function test_limits_extra_photos_and_rejects_non_images(): void
    {
        $max = BusinessOwnerMenuManageController::MAX_GALLERY_IMAGES;
        $this->update(['gallery_images' => array_map(fn ($i) => UploadedFile::fake()->image("p{$i}.jpg"), range(1, $max))])->assertOk();

        $this->update(['gallery_images' => [UploadedFile::fake()->image('one-too-many.jpg')]])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('gallery_images');
        $this->update(['gallery_images' => [UploadedFile::fake()->create('menu.pdf', 10, 'application/pdf')]])
            ->assertUnprocessable();
        $this->assertCount($max, $this->item->fresh()->images);
    }

    public function test_videos_can_be_uploaded_alongside_photos(): void
    {
        $gallery = $this->update(['gallery_images' => [
            UploadedFile::fake()->image('plate.jpg'),
            UploadedFile::fake()->create('sizzling.mp4', 8000, 'video/mp4'),
            UploadedFile::fake()->create('plating.webm', 3000, 'video/webm'),
        ]])->assertOk()->json('data.gallery');

        $this->assertSame(['image', 'video', 'video'], array_column($gallery, 'type'));
        $this->assertStringEndsWith('.mp4', $gallery[1]['path']);
        Storage::disk('public')->assertExists($gallery[1]['path']);

        // Tourists get the video in the food item's media list, after the main image.
        $this->getJson("/api/tourist/food/{$this->item->id}")
            ->assertOk()
            ->assertJsonPath('data.images.2', $gallery[1]['path']);
    }

    public function test_video_and_photo_size_limits(): void
    {
        // Videos: up to 20 MB. Photos: up to 5 MB.
        $this->update(['gallery_images' => [UploadedFile::fake()->create('long.mp4', 21000, 'video/mp4')]])->assertUnprocessable();
        $this->update(['gallery_images' => [UploadedFile::fake()->image('big.jpg')->size(6000)]])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('gallery_images.0');
        $this->update(['gallery_images' => [UploadedFile::fake()->create('ok.mp4', 15000, 'video/mp4')]])->assertOk();
        $this->update(['gallery_images' => [UploadedFile::fake()->create('clip.avi', 100, 'video/x-msvideo')]])->assertUnprocessable();
        $this->assertCount(1, $this->item->fresh()->images);
    }

    public function test_another_owner_cannot_change_the_photos(): void
    {
        $other = User::create(['email' => 'other@example.com', 'password' => Hash::make('Password123!'), 'role' => 'business_owner', 'account_status' => 'approved']);

        $this->update(['gallery_images' => [UploadedFile::fake()->image('x.jpg')]], $other)->assertNotFound();
        $this->assertNull($this->item->fresh()->images);
    }

    public function test_tourists_see_the_main_image_then_the_extra_photos(): void
    {
        $paths = array_column($this->update(['gallery_images' => [
            UploadedFile::fake()->image('a.jpg'),
            UploadedFile::fake()->image('b.jpg'),
        ]])->json('data.gallery'), 'path');

        $this->getJson("/api/tourist/food/{$this->item->id}")
            ->assertOk()
            ->assertJsonPath('data.images', ['menu-items/main.jpg', ...$paths]);
    }

    public function test_deleting_the_item_removes_its_photos(): void
    {
        $paths = array_column($this->update(['gallery_images' => [UploadedFile::fake()->image('a.jpg')]])->json('data.gallery'), 'path');

        $this->actingAs($this->owner, 'sanctum')->deleteJson("/api/business-owner/menu/{$this->item->id}")->assertSuccessful();

        Storage::disk('public')->assertMissing($paths[0]);
    }
}
