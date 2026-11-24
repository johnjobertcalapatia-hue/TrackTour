<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\BusinessPost;
use App\Models\Municipality;
use App\Models\Offering;
use App\Models\Staff;
use App\Models\StaffRole;
use App\Models\User;
use App\Support\StaffPermissions;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Promotions Part B: business posts. Up to 10 photos or one video (MP4, MOV,
 * WebM, 100 MB); only approved businesses publish; hidden and deleted posts
 * never reach tourists; one like per tourist; owner and Menu & Promotions
 * staff only.
 */
class BusinessPostsTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;

    private User $tourist;

    private Business $grill;

    private Business $cafe;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('public');
        Carbon::setTestNow(Carbon::parse('2026-11-23 10:00', 'Asia/Manila'));
        $town = Municipality::create(['name' => 'Bansud', 'district' => '2', 'province' => 'Oriental Mindoro']);
        BusinessCategory::create(['name' => 'Restaurant']);
        $this->owner = $this->user('owner@example.com', 'business_owner');
        $this->tourist = $this->user('tourist@example.com', 'tourist');
        $this->grill = $this->business($this->owner, 'Ekslusibo Grill', $town);
        $this->cafe = $this->business($this->user('cafe@example.com', 'business_owner'), 'Kape Bansud', $town);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function user(string $email, string $role): User
    {
        return User::create(['email' => $email, 'name' => Str::before($email, '@'), 'password' => Hash::make('Password123!'), 'role' => $role, 'account_status' => 'approved']);
    }

    private function business(User $owner, string $name, Municipality $town, string $status = 'approved'): Business
    {
        return Business::create(['owner_id' => $owner->id, 'business_category_id' => BusinessCategory::where('name', 'Restaurant')->value('id'), 'municipality_id' => $town->id, 'business_name' => $name, 'status' => $status, 'latitude' => 12.86, 'longitude' => 121.45]);
    }

    private function photos(int $n): array
    {
        return array_map(fn ($i) => UploadedFile::fake()->image("sisig-{$i}.jpg", 400, 300), range(1, $n));
    }

    private function createPost(array $data, ?User $as = null, string $prefix = 'business-owner')
    {
        return $this->actingAs($as ?? $this->owner, 'sanctum')->post("/api/{$prefix}/posts", $data + ['business_id' => $this->grill->id], ['Accept' => 'application/json']);
    }

    private function feed(array $query = [])
    {
        return $this->getJson('/api/tourist/posts'.($query ? '?'.http_build_query($query) : ''));
    }

    public function test_owner_posts_photos_and_tourists_see_them_in_the_feed(): void
    {
        $res = $this->createPost(['caption' => 'Fresh sisig today!', 'photos' => $this->photos(3)])->assertCreated()
            ->assertJsonPath('data.status', 'published')
            ->assertJsonCount(3, 'data.media');
        $path = $res->json('data.media.0.path');
        Storage::disk('public')->assertExists($path);
        $this->assertStringStartsWith("businesses/posts/{$this->grill->id}/", $path);

        $this->feed()->assertOk()->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.caption', 'Fresh sisig today!')
            ->assertJsonPath('data.0.business.name', 'Ekslusibo Grill')
            ->assertJsonPath('data.0.liked', false);
        $this->feed(['business_id' => $this->cafe->id])->assertJsonCount(0, 'data');
    }

    public function test_media_rules(): void
    {
        // More than 10 photos.
        $this->createPost(['photos' => $this->photos(11)])->assertStatus(422)->assertJsonValidationErrors('photos');
        // Photos and a video together.
        $this->createPost(['photos' => $this->photos(1), 'video' => UploadedFile::fake()->create('clip.mp4', 500, 'video/mp4')])
            ->assertStatus(422)->assertJsonValidationErrors('photos');
        // A video over 100 MB, and a type that is not MP4 / MOV / WebM.
        $this->createPost(['video' => UploadedFile::fake()->create('big.mp4', 102401, 'video/mp4')])->assertStatus(422)->assertJsonValidationErrors('video');
        $this->createPost(['video' => UploadedFile::fake()->create('clip.avi', 500, 'video/x-msvideo')])->assertStatus(422)->assertJsonValidationErrors('video');
        // An empty post.
        $this->createPost(['caption' => '  '])->assertStatus(422)->assertJsonValidationErrors('caption');
        $this->assertSame(0, BusinessPost::count());
        $this->assertSame([], Storage::disk('public')->allFiles());

        // One MP4, MOV or WebM video is fine.
        foreach (['clip.mp4' => 'video/mp4', 'clip.mov' => 'video/quicktime', 'clip.webm' => 'video/webm'] as $name => $mime) {
            $this->createPost(['video' => UploadedFile::fake()->create($name, 2048, $mime)])->assertCreated()->assertJsonPath('data.media.0.type', 'video');
        }

        // Editing: keeping 9 photos and adding 2 goes over 10.
        $id = $this->createPost(['photos' => $this->photos(9)])->assertCreated()->json('data.id');
        $keep = BusinessPost::find($id)->media->pluck('id')->all();
        $this->actingAs($this->owner, 'sanctum')->post("/api/business-owner/posts/{$id}", ['keep_media_ids' => $keep, 'photos' => $this->photos(2)], ['Accept' => 'application/json'])
            ->assertStatus(422)->assertJsonValidationErrors('photos');
        // Dropping two and adding one: the dropped files are deleted.
        $dropped = BusinessPost::find($id)->media->take(2)->pluck('path')->all();
        $this->actingAs($this->owner, 'sanctum')->post("/api/business-owner/posts/{$id}", ['keep_media_ids' => array_slice($keep, 2), 'photos' => $this->photos(1)], ['Accept' => 'application/json'])
            ->assertOk()->assertJsonCount(8, 'data.media');
        foreach ($dropped as $p) {
            Storage::disk('public')->assertMissing($p);
        }

        // Removing every photo (keep_media_ids sent empty) with a caption left is allowed.
        $all = BusinessPost::find($id)->media->pluck('path')->all();
        $this->actingAs($this->owner, 'sanctum')->post("/api/business-owner/posts/{$id}", ['keep_media_ids' => '', 'caption' => 'Text only now'], ['Accept' => 'application/json'])
            ->assertOk()->assertJsonCount(0, 'data.media');
        Storage::disk('public')->assertMissing($all[0]);
    }

    public function test_hidden_deleted_and_unapproved_posts_never_reach_tourists(): void
    {
        $hidden = $this->createPost(['caption' => 'Hidden', 'status' => 'hidden'])->assertCreated()->json('data.id');
        $shown = $this->createPost(['caption' => 'Shown', 'photos' => $this->photos(1)])->assertCreated()->json('data.id');
        $this->feed()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $shown);
        $this->actingAs($this->tourist, 'sanctum')->postJson("/api/tourist/posts/{$hidden}/like")->assertNotFound();

        // Hide, publish again, delete.
        $this->actingAs($this->owner, 'sanctum')->patchJson("/api/business-owner/posts/{$shown}/status", ['status' => 'hidden'])->assertOk();
        $this->feed()->assertJsonCount(0, 'data');
        $this->actingAs($this->owner, 'sanctum')->patchJson("/api/business-owner/posts/{$shown}/status", ['status' => 'published'])->assertOk();
        $this->feed()->assertJsonCount(1, 'data');
        $file = BusinessPost::find($shown)->media->first()->path;
        $this->actingAs($this->owner, 'sanctum')->deleteJson("/api/business-owner/posts/{$shown}")->assertSuccessful();
        $this->feed()->assertJsonCount(0, 'data');
        Storage::disk('public')->assertMissing($file);
        $this->assertDatabaseMissing('business_posts', ['id' => $shown]);

        // A business that is not approved cannot publish; its old posts disappear if it is suspended.
        $pending = $this->business($this->owner, 'New Place', Municipality::first(), 'pending');
        $this->createPost(['business_id' => $pending->id, 'caption' => 'Soon'])->assertStatus(422)->assertJsonValidationErrors('status');
        $this->createPost(['business_id' => $pending->id, 'caption' => 'Soon', 'status' => 'hidden'])->assertCreated();
        $this->createPost(['caption' => 'Grill news'])->assertCreated();
        $this->grill->update(['status' => 'suspended']);
        $this->feed()->assertJsonCount(0, 'data');
    }

    public function test_one_like_per_tourist(): void
    {
        $id = $this->createPost(['caption' => 'Like me'])->assertCreated()->json('data.id');
        $this->actingAs($this->tourist, 'sanctum')->postJson("/api/tourist/posts/{$id}/like")->assertOk()->assertJsonPath('data.likes_count', 1);
        $this->actingAs($this->tourist, 'sanctum')->postJson("/api/tourist/posts/{$id}/like")->assertOk()->assertJsonPath('data.likes_count', 1);
        $this->assertDatabaseCount('business_post_likes', 1);
        $this->actingAs($this->tourist, 'sanctum')->getJson('/api/tourist/posts')->assertJsonPath('data.0.liked', true)->assertJsonPath('data.0.likes_count', 1);

        $other = $this->user('t2@example.com', 'tourist');
        $this->actingAs($other, 'sanctum')->postJson("/api/tourist/posts/{$id}/like")->assertJsonPath('data.likes_count', 2);
        $this->actingAs($this->tourist, 'sanctum')->deleteJson("/api/tourist/posts/{$id}/like")->assertJsonPath('data.likes_count', 1);
        $this->actingAs($this->tourist, 'sanctum')->deleteJson("/api/tourist/posts/{$id}/like")->assertJsonPath('data.likes_count', 1);

        // Only tourists like; the owner sees the count.
        $this->actingAs($this->owner, 'sanctum')->postJson("/api/tourist/posts/{$id}/like")->assertForbidden();
        $this->actingAs($this->owner, 'sanctum')->getJson("/api/business-owner/posts/{$id}")->assertJsonPath('data.likes_count', 1);
    }

    public function test_a_post_linked_to_a_sale_shows_the_dishes_at_the_price_tourists_pay(): void
    {
        $sisig = Offering::create(['business_id' => $this->grill->id, 'name' => 'Sisig', 'price' => 200, 'is_available' => true, 'status' => 'available']);
        $saleId = $this->actingAs($this->owner, 'sanctum')->postJson('/api/business-owner/dish-sales', [
            'business_id' => $this->grill->id, 'title' => 'Weekend Sale', 'discount_type' => 'percentage', 'discount_value' => 25,
            'starts_at' => '2026-11-23', 'ends_at' => '2026-11-29', 'offering_ids' => [$sisig->id],
        ])->assertCreated()->json('data.id');

        // Another business's sale cannot be attached.
        $this->createPost(['caption' => 'x', 'promotion_id' => 999999])->assertStatus(422)->assertJsonValidationErrors('promotion_id');

        $this->createPost(['caption' => 'Sisig 25% off!', 'promotion_id' => $saleId])->assertCreated()->assertJsonPath('data.sale.status', 'active');
        $this->feed()->assertJsonPath('data.0.sale.label', '25% off')
            ->assertJsonPath('data.0.sale.dishes.0.name', 'Sisig')
            ->assertJsonPath('data.0.sale.dishes.0.price', 150)
            ->assertJsonPath('data.0.sale.dishes.0.original_price', 200);

        $this->actingAs($this->owner, 'sanctum')->postJson("/api/business-owner/dish-sales/{$saleId}/end")->assertOk();
        $this->feed()->assertJsonPath('data.0.sale.status', 'stopped')->assertJsonPath('data.0.sale.dishes', []);
    }

    public function test_only_the_owner_and_menu_and_promotions_staff_manage_posts(): void
    {
        (require base_path('database/migrations/2026_11_25_000006_add_restaurant_staff_roles.php'))->up();
        $staff = function (string $role) {
            $user = $this->user(Str::random(8).'@staff.test', 'staff');
            $roleId = StaffRole::where('name', $role)->value('id');
            Staff::create(['business_id' => $this->grill->id, 'user_id' => $user->id, 'staff_role_id' => $roleId, 'status' => 'active'])->roles()->sync([$roleId]);

            return $user;
        };

        $menu = $staff(StaffPermissions::MENU_PROMOTIONS_ROLE);
        $id = $this->createPost(['caption' => 'From staff'], $menu, 'staff')->assertCreated()->json('data.id');
        $this->assertSame($menu->id, BusinessPost::find($id)->created_by);

        $pickup = $staff(StaffPermissions::ORDER_PICKUP_ROLE);
        $this->createPost(['caption' => 'No'], $pickup, 'staff')->assertForbidden();
        $this->actingAs($pickup, 'sanctum')->getJson('/api/staff/posts')->assertForbidden();

        // Another owner: not their business, not their post.
        $other = User::where('email', 'cafe@example.com')->first();
        $this->createPost(['caption' => 'Mine'], $other)->assertForbidden();
        $this->actingAs($other, 'sanctum')->patchJson("/api/business-owner/posts/{$id}/status", ['status' => 'hidden'])->assertNotFound();
        $this->actingAs($other, 'sanctum')->deleteJson("/api/business-owner/posts/{$id}")->assertNotFound();
        $this->actingAs($this->tourist, 'sanctum')->getJson('/api/business-owner/posts')->assertForbidden();
    }
}
