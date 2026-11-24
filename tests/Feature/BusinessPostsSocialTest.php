<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\BusinessPost;
use App\Models\Municipality;
use App\Models\User;
use App\Models\UserProfile;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Deals & Posts social feed: recorded views (no inflation), shares, saves,
 * comments with business moderation, follows, drafts and insights.
 */
class BusinessPostsSocialTest extends TestCase
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
        Carbon::setTestNow(Carbon::parse('2026-11-24 10:00', 'Asia/Manila'));
        $town = Municipality::create(['name' => 'Bansud', 'district' => '2', 'province' => 'Oriental Mindoro']);
        BusinessCategory::create(['name' => 'Restaurant']);
        $this->owner = $this->user('owner@example.com', 'business_owner');
        $this->tourist = $this->user('maria@example.com', 'tourist');
        UserProfile::create(['user_id' => $this->tourist->id, 'first_name' => 'Maria', 'last_name' => 'Santos']);
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

    private function business(User $owner, string $name, Municipality $town): Business
    {
        return Business::create(['owner_id' => $owner->id, 'business_category_id' => BusinessCategory::first()->id, 'municipality_id' => $town->id, 'business_name' => $name, 'status' => 'approved', 'latitude' => 12.86, 'longitude' => 121.45]);
    }

    private function makePost(Business $business, string $status = 'published'): BusinessPost
    {
        return BusinessPost::create(['business_id' => $business->id, 'caption' => 'Post of '.$business->business_name, 'status' => $status, 'published_at' => $status === 'draft' ? null : now()]);
    }

    private function asGuest(string $ip = '10.0.0.1', string $agent = 'Firefox')
    {
        // Note: call before any actingAs() in a test; the test login carries over to later requests.

        return $this->withServerVariables(['REMOTE_ADDR' => $ip])->withHeader('User-Agent', $agent);
    }

    public function test_views_count_once_per_viewer_per_30_minutes_and_never_for_the_business(): void
    {
        $post = $this->makePost($this->grill);

        // Hidden posts cannot be viewed.
        $hidden = $this->makePost($this->grill, 'hidden');
        $this->asGuest()->postJson("/api/tourist/posts/{$hidden->id}/view")->assertNotFound();
        // A guest is one viewer per IP address + browser.
        $this->asGuest()->postJson("/api/tourist/posts/{$post->id}/view")->assertJsonPath('data.counted', true);
        $this->asGuest()->postJson("/api/tourist/posts/{$post->id}/view")->assertJsonPath('data.counted', false);
        $this->asGuest('10.0.0.2')->postJson("/api/tourist/posts/{$post->id}/view")->assertJsonPath('data.counted', true);
        // A tourist: refreshing or replaying adds nothing for 30 minutes.
        $this->actingAs($this->tourist, 'sanctum')->postJson("/api/tourist/posts/{$post->id}/view")->assertOk()->assertJsonPath('data.counted', true);
        $this->actingAs($this->tourist, 'sanctum')->postJson("/api/tourist/posts/{$post->id}/view")->assertJsonPath('data.counted', false);
        // The owner looking at their own post is not a view.
        $this->actingAs($this->owner, 'sanctum')->postJson("/api/tourist/posts/{$post->id}/view")->assertJsonPath('data.counted', false);

        $post->refresh();
        $this->assertSame(3, $post->views_count);
        $this->assertSame(3, $post->unique_viewers_count);

        // After 30 minutes the same tourist counts as a new view, not a new viewer.
        Carbon::setTestNow(now()->addMinutes(31));
        $this->actingAs($this->tourist, 'sanctum')->postJson("/api/tourist/posts/{$post->id}/view")->assertJsonPath('data.counted', true);
        $post->refresh();
        $this->assertSame(4, $post->views_count);
        $this->assertSame(3, $post->unique_viewers_count);
        $this->assertDatabaseMissing('business_post_views', ['viewer_key' => '10.0.0.1']); // raw IPs are never stored

    }

    public function test_shares_saves_and_follows_are_counted_once(): void
    {
        $post = $this->makePost($this->grill);

        $this->asGuest()->postJson("/api/tourist/posts/{$post->id}/share", ['channel' => 'link'])->assertJsonPath('data.shares_count', 1);
        $this->asGuest()->postJson("/api/tourist/posts/{$post->id}/share", ['channel' => 'native'])->assertJsonPath('data.shares_count', 1);
        $this->actingAs($this->tourist, 'sanctum')->postJson("/api/tourist/posts/{$post->id}/share")->assertJsonPath('data.shares_count', 2);

        $this->actingAs($this->tourist, 'sanctum')->postJson("/api/tourist/posts/{$post->id}/save")->assertJsonPath('data.saves_count', 1);
        $this->actingAs($this->tourist, 'sanctum')->postJson("/api/tourist/posts/{$post->id}/save")->assertJsonPath('data.saves_count', 1);
        $this->assertDatabaseCount('business_post_saves', 1);

        $this->actingAs($this->tourist, 'sanctum')->postJson("/api/tourist/businesses/{$this->grill->id}/follow")->assertJsonPath('data.followers_count', 1);
        $this->actingAs($this->tourist, 'sanctum')->postJson("/api/tourist/businesses/{$this->grill->id}/follow")->assertJsonPath('data.followers_count', 1);

        $this->actingAs($this->tourist, 'sanctum')->getJson("/api/tourist/posts/{$post->id}")->assertOk()
            ->assertJsonPath('data.saved', true)->assertJsonPath('data.business.following', true)
            ->assertJsonPath('data.shares_count', 2)->assertJsonPath('data.saves_count', 1);

        $this->actingAs($this->tourist, 'sanctum')->deleteJson("/api/tourist/posts/{$post->id}/save")->assertJsonPath('data.saves_count', 0);
        $this->actingAs($this->tourist, 'sanctum')->deleteJson("/api/tourist/businesses/{$this->grill->id}/follow")->assertJsonPath('data.followers_count', 0);
        // Only tourists save and follow.
        $this->actingAs($this->owner, 'sanctum')->postJson("/api/tourist/posts/{$post->id}/save")->assertForbidden();
        $this->actingAs($this->owner, 'sanctum')->postJson("/api/tourist/businesses/{$this->cafe->id}/follow")->assertForbidden();
    }

    public function test_following_and_saved_feeds(): void
    {
        $grillPost = $this->makePost($this->grill);
        $cafePost = $this->makePost($this->cafe);
        $this->makePost($this->cafe, 'draft');

        $this->getJson('/api/tourist/posts')->assertJsonCount(2, 'data');
        $this->getJson('/api/tourist/posts?feed=following')->assertStatus(401);

        $this->actingAs($this->tourist, 'sanctum')->postJson("/api/tourist/businesses/{$this->cafe->id}/follow")->assertOk();
        $this->actingAs($this->tourist, 'sanctum')->postJson("/api/tourist/posts/{$grillPost->id}/save")->assertOk();

        $this->actingAs($this->tourist, 'sanctum')->getJson('/api/tourist/posts?feed=following')->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $cafePost->id);
        $this->actingAs($this->tourist, 'sanctum')->getJson('/api/tourist/posts?feed=saved')->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $grillPost->id);

        // A saved post that is later hidden leaves the saved feed too.
        $grillPost->update(['status' => 'hidden']);
        $this->actingAs($this->tourist, 'sanctum')->getJson('/api/tourist/posts?feed=saved')->assertJsonCount(0, 'data');
    }

    public function test_comments_and_business_moderation(): void
    {
        $post = $this->makePost($this->grill);
        $other = $this->user('juan@example.com', 'tourist');
        $this->asGuest()->postJson("/api/tourist/posts/{$post->id}/comments", ['body' => 'Hi'])->assertUnauthorized();

        $id = $this->actingAs($this->tourist, 'sanctum')->postJson("/api/tourist/posts/{$post->id}/comments", ['body' => '  Sarap!  '])->assertCreated()
            ->assertJsonPath('data.body', 'Sarap!')
            ->assertJsonPath('data.author.name', 'Maria S.')
            ->assertJsonPath('data.comments_count', 1)
            ->json('data.id');
        $this->actingAs($other, 'sanctum')->postJson("/api/tourist/posts/{$post->id}/comments", ['body' => 'Spam spam'])->assertCreated();
        $this->actingAs($other, 'sanctum')->postJson("/api/tourist/posts/{$post->id}/comments", ['body' => '   '])->assertStatus(422);
        $this->actingAs($other, 'sanctum')->postJson("/api/tourist/posts/{$post->id}/comments", ['body' => str_repeat('a', 1001)])->assertStatus(422);

        $list = $this->getJson("/api/tourist/posts/{$post->id}/comments")->assertOk()->assertJsonCount(2, 'data');
        $this->assertStringNotContainsString('maria@example.com', $list->getContent(), 'emails are never shown');

        // The business hides a comment: tourists no longer see it; the count drops.
        $spam = $post->comments()->where('body', 'Spam spam')->value('id');
        $this->actingAs($this->owner, 'sanctum')->patchJson("/api/business-owner/posts/{$post->id}/comments/{$spam}", ['hidden' => true])->assertOk()->assertJsonPath('data.hidden', true);
        $this->getJson("/api/tourist/posts/{$post->id}/comments")->assertJsonCount(1, 'data');
        $this->assertSame(1, $post->fresh()->comments_count);
        $this->actingAs($this->owner, 'sanctum')->getJson("/api/business-owner/posts/{$post->id}/comments")->assertJsonCount(2, 'data');

        // A tourist deletes only their own comment; another owner cannot moderate.
        $this->actingAs($other, 'sanctum')->deleteJson("/api/tourist/posts/{$post->id}/comments/{$id}")->assertNotFound();
        $cafeOwner = User::where('email', 'cafe@example.com')->first();
        $this->actingAs($cafeOwner, 'sanctum')->patchJson("/api/business-owner/posts/{$post->id}/comments/{$id}", ['hidden' => true])->assertNotFound();
        $this->actingAs($this->tourist, 'sanctum')->deleteJson("/api/tourist/posts/{$post->id}/comments/{$id}")->assertOk()->assertJsonPath('data.comments_count', 0);
        $this->actingAs($this->owner, 'sanctum')->deleteJson("/api/business-owner/posts/{$post->id}/comments/{$spam}")->assertSuccessful();
        $this->assertDatabaseCount('business_post_comments', 0);

        // No comments on hidden posts; guests cannot comment.
        $hidden = $this->makePost($this->grill, 'hidden');
        $this->actingAs($this->tourist, 'sanctum')->postJson("/api/tourist/posts/{$hidden->id}/comments", ['body' => 'Hi'])->assertNotFound();
    }

    public function test_drafts_and_insights(): void
    {
        $draftId = $this->actingAs($this->owner, 'sanctum')->post('/api/business-owner/posts', ['business_id' => $this->grill->id, 'caption' => 'Coming soon', 'status' => 'draft'], ['Accept' => 'application/json'])
            ->assertCreated()->assertJsonPath('data.status', 'draft')->assertJsonPath('data.published_at', null)->json('data.id');
        $this->getJson('/api/tourist/posts')->assertJsonCount(0, 'data');
        $this->actingAs($this->owner, 'sanctum')->patchJson("/api/business-owner/posts/{$draftId}/status", ['status' => 'hidden'])->assertStatus(422);
        $this->actingAs($this->owner, 'sanctum')->patchJson("/api/business-owner/posts/{$draftId}/status", ['status' => 'published'])->assertOk();
        $this->getJson('/api/tourist/posts')->assertJsonCount(1, 'data');
        // Once published it can be hidden but not turned back into a draft.
        $this->actingAs($this->owner, 'sanctum')->post("/api/business-owner/posts/{$draftId}", ['status' => 'draft', 'caption' => 'x'], ['Accept' => 'application/json'])->assertOk()->assertJsonPath('data.status', 'hidden');
        $this->actingAs($this->owner, 'sanctum')->patchJson("/api/business-owner/posts/{$draftId}/status", ['status' => 'published'])->assertOk();

        $this->actingAs($this->tourist, 'sanctum')->postJson("/api/tourist/posts/{$draftId}/view");
        $this->actingAs($this->user('juan@example.com', 'tourist'), 'sanctum')->postJson("/api/tourist/posts/{$draftId}/view");
        $this->actingAs($this->tourist, 'sanctum')->postJson("/api/tourist/posts/{$draftId}/like");
        $this->actingAs($this->tourist, 'sanctum')->postJson("/api/tourist/businesses/{$this->grill->id}/follow");

        $res = $this->actingAs($this->owner, 'sanctum')->getJson("/api/business-owner/posts/{$draftId}/insights")->assertOk()
            ->assertJsonPath('data.totals.views', 2)
            ->assertJsonPath('data.totals.unique_viewers', 2)
            ->assertJsonPath('data.totals.likes', 1)
            ->assertJsonPath('data.followers', 1);
        $this->assertCount(14, $res->json('data.daily_views'));
        $this->assertSame(['date' => '2026-11-24', 'views' => 2], $res->json('data.daily_views.13'));

        $this->actingAs(User::where('email', 'cafe@example.com')->first(), 'sanctum')->getJson("/api/business-owner/posts/{$draftId}/insights")->assertNotFound();
        $this->actingAs($this->owner, 'sanctum')->getJson('/api/business-owner/posts?sort=popular')->assertJsonPath('data.0.views_count', 2);
    }

    public function test_the_business_comments_on_its_own_post(): void
    {
        $post = $this->makePost($this->grill);
        $this->grill->update(['logo' => 'businesses/logos/grill.png']);

        // The owner comments as the business.
        $id = $this->actingAs($this->owner, 'sanctum')->postJson("/api/business-owner/posts/{$post->id}/comments", ['body' => ' Salamat po! '])->assertCreated()
            ->assertJsonPath('data.body', 'Salamat po!')
            ->assertJsonPath('data.author.name', 'Ekslusibo Grill')
            ->assertJsonPath('data.author.is_business', true)
            ->assertJsonPath('data.comments_count', 1)
            ->json('data.id');
        $this->assertDatabaseHas('business_post_comments', ['id' => $id, 'user_id' => $this->owner->id, 'business_id' => $this->grill->id]);
        $this->actingAs($this->owner, 'sanctum')->postJson("/api/business-owner/posts/{$post->id}/comments", ['body' => '  '])->assertStatus(422);

        // Tourists see it as the business; they cannot delete it.
        $this->actingAs($this->tourist, 'sanctum')->getJson("/api/tourist/posts/{$post->id}/comments")->assertOk()
            ->assertJsonPath('data.0.author.name', 'Ekslusibo Grill')
            ->assertJsonPath('data.0.author.avatar', 'businesses/logos/grill.png')
            ->assertJsonPath('data.0.author.is_business', true)
            ->assertJsonPath('data.0.mine', false);
        $this->actingAs($this->tourist, 'sanctum')->deleteJson("/api/tourist/posts/{$post->id}/comments/{$id}")->assertNotFound();

        // Menu & Promotions staff comment as the business too; other staff and other owners cannot.
        (require base_path('database/migrations/2026_11_25_000006_add_restaurant_staff_roles.php'))->up();
        $staffUser = function (string $role) {
            $user = $this->user(Str::random(8).'@staff.test', 'staff');
            $roleId = \App\Models\StaffRole::where('name', $role)->value('id');
            \App\Models\Staff::create(['business_id' => $this->grill->id, 'user_id' => $user->id, 'staff_role_id' => $roleId, 'status' => 'active'])->roles()->sync([$roleId]);

            return $user;
        };
        $menu = $staffUser(\App\Support\StaffPermissions::MENU_PROMOTIONS_ROLE);
        $this->actingAs($menu, 'sanctum')->postJson("/api/staff/posts/{$post->id}/comments", ['body' => 'Open until 9 PM'])->assertCreated()->assertJsonPath('data.author.name', 'Ekslusibo Grill');
        $this->actingAs($staffUser(\App\Support\StaffPermissions::ORDER_PICKUP_ROLE), 'sanctum')->postJson("/api/staff/posts/{$post->id}/comments", ['body' => 'Hi'])->assertForbidden();
        $this->actingAs(User::where('email', 'cafe@example.com')->first(), 'sanctum')->postJson("/api/business-owner/posts/{$post->id}/comments", ['body' => 'Hi'])->assertNotFound();

        $this->assertSame(2, $post->fresh()->comments_count);
        // The business can still hide or delete its own comment.
        $this->actingAs($this->owner, 'sanctum')->deleteJson("/api/business-owner/posts/{$post->id}/comments/{$id}")->assertSuccessful();
        $this->assertSame(1, $post->fresh()->comments_count);
    }
}
