<?php

namespace App\Http\Controllers\Tourist;

use App\Http\Controllers\Controller;
use App\Models\Business;
use App\Models\BusinessPost;
use App\Models\BusinessPostComment;
use App\Services\PostEngagement;
use App\Support\PostPresenter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Tourist side of Deals & Posts: the feed (all, following, saved), one post,
 * and likes, saves, comments, shares, views and follows. Only published posts
 * of approved businesses are ever returned or acted on (404 otherwise); one
 * like, save and follow per tourist (unique indexes); counters are recomputed
 * by PostEngagement.
 */
class PostFeedController extends Controller
{
    private const WITH = ['business:id,business_name,logo,status,business_category_id', 'business.category:id,name', 'media', 'promotion'];

    public function __construct(private PostEngagement $engagement) {}

    /** GET /tourist/posts?business_id=&feed=all|following|saved (public; following/saved need a tourist). */
    public function index(Request $request): JsonResponse
    {
        $request->validate([
            'business_id' => ['nullable', 'integer'],
            'feed' => ['nullable', 'in:all,following,saved'],
            'perPage' => ['nullable', 'integer', 'min:1', 'max:30'],
        ]);
        $viewer = $request->user('sanctum');
        $feed = $request->input('feed', 'all');
        if ($feed !== 'all' && $viewer?->role !== 'tourist') {
            return $this->errorResponse('Log in as a tourist to see this feed.', 401);
        }

        $posts = BusinessPost::visibleToTourists()
            ->when($request->filled('business_id'), fn ($q) => $q->where('business_id', (int) $request->input('business_id')))
            ->when($feed === 'following', fn ($q) => $q->whereIn('business_id', DB::table('business_followers')->where('user_id', $viewer->id)->select('business_id')))
            ->when($feed === 'saved', fn ($q) => $q->whereIn('id', DB::table('business_post_saves')->where('user_id', $viewer->id)->select('business_post_id')))
            ->with(self::WITH)
            ->orderByDesc('published_at')->orderByDesc('id')
            ->paginate((int) $request->input('perPage', 10));

        $state = $this->viewerState($viewer?->id, $posts->getCollection());

        return $this->paginatedResponse($posts->through(fn (BusinessPost $p) => PostPresenter::forTourist($p, $state)));
    }

    /** GET /tourist/posts/{id}: one post (shared links and the media viewer). */
    public function show(Request $request, int $id): JsonResponse
    {
        $post = BusinessPost::visibleToTourists()->with(self::WITH)->findOrFail($id);

        return $this->successResponse(PostPresenter::forTourist($post, $this->viewerState($request->user('sanctum')?->id, collect([$post]))));
    }

    /** POST /tourist/posts/{id}/view (public): see PostEngagement for the counting rule. */
    public function view(Request $request, int $id): JsonResponse
    {
        $post = $this->visiblePost($id);
        $counted = $this->engagement->recordView($post, $request);

        return $this->successResponse(['counted' => $counted, 'views_count' => (int) $post->fresh()->views_count]);
    }

    /** POST /tourist/posts/{id}/share (public): once per viewer per post per day. */
    public function share(Request $request, int $id): JsonResponse
    {
        $data = $request->validate(['channel' => ['nullable', 'in:link,native']]);
        $post = $this->visiblePost($id);
        $this->engagement->recordShare($post, $request, $data['channel'] ?? 'link');

        return $this->successResponse(['shares_count' => (int) $post->fresh()->shares_count]);
    }

    public function like(Request $request, int $id): JsonResponse
    {
        return $this->toggle($request, $id, 'business_post_likes', 'likes', true);
    }

    public function unlike(Request $request, int $id): JsonResponse
    {
        return $this->toggle($request, $id, 'business_post_likes', 'likes', false);
    }

    public function save(Request $request, int $id): JsonResponse
    {
        return $this->toggle($request, $id, 'business_post_saves', 'saves', true);
    }

    public function unsave(Request $request, int $id): JsonResponse
    {
        return $this->toggle($request, $id, 'business_post_saves', 'saves', false);
    }

    /** GET /tourist/posts/{id}/comments (public): visible comments, oldest first. */
    public function comments(Request $request, int $id): JsonResponse
    {
        $post = $this->visiblePost($id);
        $comments = $post->comments()->visible()->with(['user.profile', 'business:id,business_name,logo'])->oldest()->paginate(20);
        $me = $request->user('sanctum')?->id;

        return $this->paginatedResponse($comments->through(fn (BusinessPostComment $c) => PostPresenter::comment($c, $me)));
    }

    /** POST /tourist/posts/{id}/comments */
    public function comment(Request $request, int $id): JsonResponse
    {
        $data = $request->validate(['body' => ['required', 'string', 'max:'.BusinessPostComment::MAX_LENGTH]], [
            'body.required' => 'Write a comment first.',
            'body.max' => 'A comment can be at most 1,000 characters.',
        ]);
        $body = trim($data['body']);
        if ($body === '') {
            return $this->errorResponse('Write a comment first.', 422);
        }
        $post = $this->visiblePost($id);
        $comment = $this->engagement->locked($post, function () use ($post, $request, $body) {
            $comment = $post->comments()->create(['user_id' => $request->user()->id, 'body' => $body]);
            $this->engagement->recount($post, ['comments']);

            return $comment;
        });

        return $this->createdResponse(PostPresenter::comment($comment->load('user.profile'), $request->user()->id) + ['comments_count' => (int) $post->fresh()->comments_count]);
    }

    /** DELETE /tourist/posts/{id}/comments/{comment}: a tourist deletes their own comment. */
    public function deleteComment(Request $request, int $id, int $commentId): JsonResponse
    {
        $post = $this->visiblePost($id);
        $comment = $post->comments()->where('user_id', $request->user()->id)->findOrFail($commentId);
        $this->engagement->locked($post, function () use ($comment, $post) {
            $comment->delete();
            $this->engagement->recount($post, ['comments']);
        });

        return $this->successResponse(['comments_count' => (int) $post->fresh()->comments_count]);
    }

    /** POST /tourist/businesses/{id}/follow */
    public function follow(Request $request, int $businessId): JsonResponse
    {
        $business = Business::where('status', 'approved')->findOrFail($businessId);
        DB::table('business_followers')->insertOrIgnore(['business_id' => $business->id, 'user_id' => $request->user()->id, 'created_at' => now(), 'updated_at' => now()]);

        return $this->successResponse(['following' => true, 'followers_count' => DB::table('business_followers')->where('business_id', $business->id)->count()]);
    }

    /** DELETE /tourist/businesses/{id}/follow */
    public function unfollow(Request $request, int $businessId): JsonResponse
    {
        DB::table('business_followers')->where('business_id', $businessId)->where('user_id', $request->user()->id)->delete();

        return $this->successResponse(['following' => false, 'followers_count' => DB::table('business_followers')->where('business_id', $businessId)->count()]);
    }

    private function toggle(Request $request, int $id, string $table, string $counter, bool $on): JsonResponse
    {
        $post = $this->visiblePost($id);
        $this->engagement->locked($post, function () use ($post, $request, $table, $counter, $on) {
            $match = ['business_post_id' => $post->id, 'user_id' => $request->user()->id];
            $on
                ? DB::table($table)->insertOrIgnore($match + ['created_at' => now(), 'updated_at' => now()])
                : DB::table($table)->where($match)->delete();
            $this->engagement->recount($post, [$counter]);
        });
        $flag = $counter === 'likes' ? 'liked' : 'saved';

        return $this->successResponse([$flag => $on, "{$counter}_count" => (int) $post->fresh()->{"{$counter}_count"}]);
    }

    private function visiblePost(int $id): BusinessPost
    {
        return BusinessPost::visibleToTourists()->findOrFail($id);
    }

    /** @param Collection<int, BusinessPost> $posts */
    private function viewerState(?int $userId, Collection $posts): array
    {
        if (! $userId || $posts->isEmpty()) {
            return ['liked' => [], 'saved' => [], 'following' => []];
        }
        $ids = $posts->pluck('id');
        $set = fn ($rows) => collect($rows)->mapWithKeys(fn ($v) => [(int) $v => true])->all();

        return [
            'liked' => $set(DB::table('business_post_likes')->where('user_id', $userId)->whereIn('business_post_id', $ids)->pluck('business_post_id')),
            'saved' => $set(DB::table('business_post_saves')->where('user_id', $userId)->whereIn('business_post_id', $ids)->pluck('business_post_id')),
            'following' => $set(DB::table('business_followers')->where('user_id', $userId)->whereIn('business_id', $posts->pluck('business_id')->unique())->pluck('business_id')),
        ];
    }
}
