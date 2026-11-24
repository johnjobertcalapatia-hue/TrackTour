<?php

namespace App\Http\Controllers\BusinessOwner;

use App\Http\Controllers\Concerns\ActsForBusiness;
use App\Http\Controllers\Controller;
use App\Models\Business;
use App\Models\BusinessPost;
use App\Models\BusinessPostComment;
use App\Services\PostEngagement;
use App\Models\Promotion;
use App\Support\PostPresenter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;

/**
 * Business posts (Promotions Part B), for the owner and Menu & Promotions
 * staff (staff.can:promotions.manage). A post is a caption with up to 10
 * photos OR one video (MP4, MOV or WebM, up to 100 MB), optionally linked to
 * one of the business's sales. Only approved businesses publish; hidden posts
 * never reach tourists; deleting a post removes its files.
 *
 * Files go on the public disk like the Business Gallery (businesses/posts/…).
 */
class BusinessOwnerPostController extends Controller
{
    use ActsForBusiness;

    private const DISK = 'public';

    private const PHOTO_RULE = ['file', 'mimes:jpg,jpeg,png,webp', 'mimetypes:image/jpeg,image/png,image/webp', 'max:10240'];

    private const VIDEO_RULE = ['file', 'mimes:mp4,mov,webm', 'mimetypes:video/mp4,video/quicktime,video/webm', 'max:102400'];

    public function index(Request $request): JsonResponse
    {
        $ids = $this->actingBusinessIds($request);
        if ($request->filled('business_id')) {
            $ids = $ids->intersect([(int) $request->input('business_id')])->values();
        }

        $posts = BusinessPost::whereIn('business_id', $ids)
            ->with(['business:id,business_name,logo,status', 'media', 'promotion'])
            ->when(in_array($request->input('status'), [BusinessPost::STATUS_PUBLISHED, BusinessPost::STATUS_HIDDEN, BusinessPost::STATUS_DRAFT], true), fn ($q) => $q->where('status', $request->input('status')))
            // "Popular posts": most viewed published posts first.
            ->when($request->input('sort') === 'popular', fn ($q) => $q->where('status', BusinessPost::STATUS_PUBLISHED)->orderByDesc('views_count')->orderByDesc('likes_count'))
            ->latest('id')
            ->paginate(min(max((int) $request->input('perPage', 12), 1), 50));

        return $this->paginatedResponse($posts->through(fn (BusinessPost $p) => PostPresenter::forOwner($p)));
    }

    public function show(Request $request, int $id): JsonResponse
    {
        return $this->successResponse(PostPresenter::forOwner($this->findPost($request, $id)->load('business:id,business_name,logo,status', 'media', 'promotion')));
    }

    public function store(Request $request): JsonResponse
    {
        $data = $this->validatePost($request, null);
        $business = Business::find($data['business_id']);
        if (! $this->actsFor($request, $business)) {
            return $this->forbiddenResponse('You do not manage this business.');
        }
        $this->assertCanPublish($business, $data['status']);
        $promotionId = $this->promotionFor($business, $data['promotion_id'] ?? null);

        $photos = $request->file('photos', []);
        $video = $request->file('video');
        $this->assertMediaShape(count($photos), $video ? 1 : 0, 0, 0, $data['caption'] ?? null);

        $stored = [];
        try {
            $post = DB::transaction(function () use ($request, $business, $data, $promotionId, $photos, $video, &$stored) {
                $post = BusinessPost::create([
                    'business_id' => $business->id,
                    'created_by' => $request->user()->id,
                    'caption' => $data['caption'] ?? null,
                    'status' => $data['status'],
                    'promotion_id' => $promotionId,
                    'published_at' => $data['status'] === BusinessPost::STATUS_PUBLISHED ? now() : null,
                ]);
                $this->storeMedia($post, $photos, $video, 0, $stored);

                return $post;
            });
        } catch (\Throwable $e) {
            Storage::disk(self::DISK)->delete($stored); // no orphan files when saving fails

            throw $e;
        }

        return $this->createdResponse(PostPresenter::forOwner($post->load('business:id,business_name,logo,status', 'media', 'promotion')), 'Post created.');
    }

    /** POST /posts/{id} (multipart): caption, sale, status, which media to keep, new media. */
    public function update(Request $request, int $id): JsonResponse
    {
        $post = $this->findPost($request, $id)->load('media', 'business');
        $data = $this->validatePost($request, $post);
        $this->assertCanPublish($post->business, $data['status']);
        $promotionId = array_key_exists('promotion_id', $data)
            ? $this->promotionFor($post->business, $data['promotion_id'])
            : $post->promotion_id;

        // keep_media_ids sent (even empty) = exactly these stay; not sent = keep all.
        $keepIds = collect($request->has('keep_media_ids') ? ($data['keep_media_ids'] ?? []) : $post->media->pluck('id')->all())->map(fn ($v) => (int) $v);
        $kept = $post->media->whereIn('id', $keepIds->all());
        $removed = $post->media->whereNotIn('id', $keepIds->all());
        $photos = $request->file('photos', []);
        $video = $request->file('video');
        $this->assertMediaShape(
            count($photos), $video ? 1 : 0,
            $kept->where('type', 'image')->count(), $kept->where('type', 'video')->count(),
            array_key_exists('caption', $data) ? $data['caption'] : $post->caption,
        );

        $stored = [];
        try {
            DB::transaction(function () use ($post, $data, $promotionId, $photos, $video, $kept, $removed, &$stored) {
                $becomesPublished = $data['status'] === BusinessPost::STATUS_PUBLISHED && $post->published_at === null;
                $post->update([
                    'caption' => array_key_exists('caption', $data) ? $data['caption'] : $post->caption,
                    'status' => $data['status'],
                    'promotion_id' => $promotionId,
                    'published_at' => $becomesPublished ? now() : $post->published_at,
                ]);
                $post->media()->whereIn('id', $removed->pluck('id'))->delete();
                $this->storeMedia($post, $photos, $video, (int) ($kept->max('sort_order') ?? -1) + 1, $stored);
            });
        } catch (\Throwable $e) {
            Storage::disk(self::DISK)->delete($stored);

            throw $e;
        }
        Storage::disk(self::DISK)->delete($removed->pluck('path')->all());

        return $this->successResponse(PostPresenter::forOwner($post->fresh()->load('business:id,business_name,logo,status', 'media', 'promotion')), 'Post updated.');
    }

    /** Publish or hide. */
    public function status(Request $request, int $id): JsonResponse
    {
        $post = $this->findPost($request, $id)->load('business');
        $data = $request->validate(['status' => ['required', 'in:published,hidden']]);
        if ($data['status'] === BusinessPost::STATUS_HIDDEN && $post->status === BusinessPost::STATUS_DRAFT) {
            return $this->errorResponse('A draft is not published yet, so there is nothing to hide.', 422);
        }
        $this->assertCanPublish($post->business, $data['status']);
        $post->update([
            'status' => $data['status'],
            'published_at' => $data['status'] === BusinessPost::STATUS_PUBLISHED ? ($post->published_at ?? now()) : $post->published_at,
        ]);

        return $this->successResponse(PostPresenter::forOwner($post->fresh()->load('business:id,business_name,logo,status', 'media', 'promotion')), $data['status'] === 'published' ? 'Post published.' : 'Post hidden.');
    }

    /** Delete for good: the post, its likes and its files. */
    public function destroy(Request $request, int $id): JsonResponse
    {
        $post = $this->findPost($request, $id)->load('media');
        $paths = $post->media->pluck('path')->all();
        $post->delete();
        Storage::disk(self::DISK)->delete($paths);

        return $this->noContentResponse('Post deleted.');
    }

    /**
     * GET /posts/{id}/insights: recorded activity only (no sample figures).
     * Views per Manila day for the last 14 days, plus the totals and the
     * business's follower count.
     */
    public function insights(Request $request, int $id): JsonResponse
    {
        $post = $this->findPost($request, $id)->load('business:id,business_name,logo,status', 'media', 'promotion');
        $tz = 'Asia/Manila';
        $start = now($tz)->startOfDay()->subDays(13);
        $rows = DB::table('business_post_views')->where('business_post_id', $post->id)
            ->where('viewed_at', '>=', $start->copy()->utc())->pluck('viewed_at');
        $perDay = [];
        foreach ($rows as $at) {
            $day = \Illuminate\Support\Carbon::parse($at, 'UTC')->timezone($tz)->toDateString();
            $perDay[$day] = ($perDay[$day] ?? 0) + 1;
        }
        $daily = [];
        for ($i = 0; $i < 14; $i++) {
            $day = $start->copy()->addDays($i)->toDateString();
            $daily[] = ['date' => $day, 'views' => $perDay[$day] ?? 0];
        }

        return $this->successResponse([
            'post' => PostPresenter::forOwner($post),
            'totals' => [
                'views' => (int) $post->views_count,
                'unique_viewers' => (int) $post->unique_viewers_count,
                'likes' => (int) $post->likes_count,
                'comments' => (int) $post->comments_count,
                'hidden_comments' => $post->comments()->whereNotNull('hidden_at')->count(),
                'saves' => (int) $post->saves_count,
                'shares' => (int) $post->shares_count,
            ],
            'daily_views' => $daily,
            'followers' => DB::table('business_followers')->where('business_id', $post->business_id)->count(),
        ]);
    }

    /** GET /posts/{id}/comments: every comment on the post, hidden ones included. */
    public function comments(Request $request, int $id): JsonResponse
    {
        $post = $this->findPost($request, $id);
        $comments = $post->comments()->with(['user.profile', 'business:id,business_name,logo'])->latest('id')->paginate(20);

        return $this->paginatedResponse($comments->through(fn (BusinessPostComment $c) => PostPresenter::comment($c, null, true)));
    }

    /**
     * POST /posts/{id}/comments: the business comments on its own post (owner,
     * or Menu & Promotions staff). Shown to tourists as the business.
     */
    public function comment(Request $request, int $id): JsonResponse
    {
        $post = $this->findPost($request, $id);
        $data = $request->validate(['body' => ['required', 'string', 'max:'.BusinessPostComment::MAX_LENGTH]], [
            'body.required' => 'Write a comment first.',
            'body.max' => 'A comment can be at most 1,000 characters.',
        ]);
        $body = trim($data['body']);
        if ($body === '') {
            return $this->errorResponse('Write a comment first.', 422);
        }
        $comment = app(PostEngagement::class)->locked($post, function () use ($post, $request, $body) {
            $comment = $post->comments()->create(['user_id' => $request->user()->id, 'business_id' => $post->business_id, 'body' => $body]);
            app(PostEngagement::class)->recount($post, ['comments']);

            return $comment;
        });

        return $this->createdResponse(PostPresenter::comment($comment->load('business:id,business_name,logo'), null, true) + ['comments_count' => (int) $post->fresh()->comments_count]);
    }

    /** PATCH /posts/{id}/comments/{comment}: hide or show a comment. */
    public function moderateComment(Request $request, int $id, int $commentId): JsonResponse
    {
        $post = $this->findPost($request, $id);
        $data = $request->validate(['hidden' => ['required', 'boolean']]);
        $comment = $post->comments()->findOrFail($commentId);
        app(PostEngagement::class)->locked($post, function () use ($comment, $data, $request, $post) {
            $comment->update($data['hidden'] ? ['hidden_at' => now(), 'hidden_by' => $request->user()->id] : ['hidden_at' => null, 'hidden_by' => null]);
            app(PostEngagement::class)->recount($post, ['comments']);
        });

        return $this->successResponse(PostPresenter::comment($comment->fresh()->load('user.profile', 'business:id,business_name,logo'), null, true), $data['hidden'] ? 'Comment hidden.' : 'Comment shown.');
    }

    /** DELETE /posts/{id}/comments/{comment} */
    public function destroyComment(Request $request, int $id, int $commentId): JsonResponse
    {
        $post = $this->findPost($request, $id);
        $comment = $post->comments()->findOrFail($commentId);
        app(PostEngagement::class)->locked($post, function () use ($comment, $post) {
            $comment->delete();
            app(PostEngagement::class)->recount($post, ['comments']);
        });

        return $this->noContentResponse('Comment deleted.');
    }

    /** GET /posts/followers?business_id=: how many tourists follow the business. */
    public function followers(Request $request): JsonResponse
    {
        $ids = $this->actingBusinessIds($request);
        if ($request->filled('business_id')) {
            $ids = $ids->intersect([(int) $request->input('business_id')])->values();
        }

        return $this->successResponse(['followers' => DB::table('business_followers')->whereIn('business_id', $ids)->count()]);
    }

    private function findPost(Request $request, int $id): BusinessPost
    {
        return BusinessPost::whereIn('business_id', $this->actingBusinessIds($request))->findOrFail($id);
    }

    private function validatePost(Request $request, ?BusinessPost $post): array
    {
        $data = $request->validate([
            'business_id' => [$post ? 'prohibited' : 'required', 'integer', 'exists:businesses,id'],
            'caption' => ['nullable', 'string', 'max:2200'],
            'status' => ['nullable', 'in:published,hidden,draft'],
            'promotion_id' => ['nullable', 'integer'],
            'photos' => ['nullable', 'array', 'max:'.BusinessPost::MAX_PHOTOS],
            'photos.*' => self::PHOTO_RULE,
            'video' => ['nullable', ...self::VIDEO_RULE],
            'keep_media_ids' => ['nullable', 'array'],
            'keep_media_ids.*' => ['integer'],
        ], [
            'photos.max' => 'A post can have at most 10 photos.',
            'photos.*.max' => 'Each photo must be 10 MB or smaller.',
            'photos.*.mimes' => 'Photos must be JPG, PNG or WebP.',
            'photos.*.mimetypes' => 'Photos must be JPG, PNG or WebP.',
            'video.max' => 'The video must be 100 MB or smaller.',
            'video.mimes' => 'The video must be MP4, MOV or WebM.',
            'video.mimetypes' => 'The video must be MP4, MOV or WebM.',
            'business_id.prohibited' => 'A post cannot be moved to another business.',
        ]);
        $data['status'] = $data['status'] ?? null ?: ($post?->status ?? BusinessPost::STATUS_PUBLISHED);
        // A post that has been published can be hidden, but not turned back into a draft.
        if ($data['status'] === BusinessPost::STATUS_DRAFT && $post?->published_at !== null) {
            $data['status'] = BusinessPost::STATUS_HIDDEN;
        }

        return $data;
    }

    private function assertCanPublish(Business $business, string $status): void
    {
        if ($status === BusinessPost::STATUS_PUBLISHED && $business->status !== 'approved') {
            throw ValidationException::withMessages(['status' => 'Only approved businesses can publish posts. Save it as hidden for now.']);
        }
    }

    /** At most 10 photos, or exactly one video, never both; a post is not empty. */
    private function assertMediaShape(int $newPhotos, int $newVideos, int $keptPhotos, int $keptVideos, ?string $caption): void
    {
        $photos = $newPhotos + $keptPhotos;
        $videos = $newVideos + $keptVideos;
        if ($videos > 1) {
            throw ValidationException::withMessages(['video' => 'A post can have only one video.']);
        }
        if ($videos > 0 && $photos > 0) {
            throw ValidationException::withMessages(['photos' => 'A post has either photos or one video, not both.']);
        }
        if ($photos > BusinessPost::MAX_PHOTOS) {
            throw ValidationException::withMessages(['photos' => 'A post can have at most 10 photos.']);
        }
        if ($photos + $videos === 0 && trim((string) $caption) === '') {
            throw ValidationException::withMessages(['caption' => 'Write a caption or add a photo or video.']);
        }
    }

    /** A post may point at one of this business's own promotions (a sale or a badge). */
    private function promotionFor(Business $business, mixed $promotionId): ?int
    {
        if ($promotionId === null || $promotionId === '') {
            return null;
        }
        $promotion = Promotion::where('business_id', $business->id)->find((int) $promotionId);
        if (! $promotion) {
            throw ValidationException::withMessages(['promotion_id' => 'Choose one of this business\'s sales.']);
        }

        return $promotion->id;
    }

    /**
     * @param  list<UploadedFile>  $photos
     * @param  list<string>  $stored  paths written, for clean-up on failure
     */
    private function storeMedia(BusinessPost $post, array $photos, ?UploadedFile $video, int $order, array &$stored): void
    {
        $folder = "businesses/posts/{$post->business_id}";
        $files = $video ? [['video', $video]] : array_map(fn ($p) => ['image', $p], $photos);
        foreach ($files as [$type, $file]) {
            $path = $file->store($folder, self::DISK);
            if ($path === false) {
                throw new \RuntimeException('The file could not be saved. Please try again.');
            }
            $stored[] = $path;
            $post->media()->create([
                'type' => $type,
                'path' => $path,
                'mime' => $file->getMimeType(),
                'size' => (int) $file->getSize(),
                'sort_order' => $order++,
            ]);
        }
    }
}
