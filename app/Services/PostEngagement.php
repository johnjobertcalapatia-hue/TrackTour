<?php

namespace App\Services;

use App\Models\BusinessPost;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Counting rules for business posts (Deals & Posts). Every counter on
 * business_posts is recomputed from its own table, so it cannot drift or be
 * inflated by a client sending the same event twice.
 *
 * Views: the page reports a view when a post is on screen (at least half of
 * it for one second) or opened in the media viewer. The server counts it only
 * for tourists and guests (never the business's owner or staff, or other
 * roles), and at most once per viewer per post every 30 minutes, so
 * refreshing, scrolling back or replaying a video adds nothing. A viewer is the
 * signed-in tourist, or for a guest a hash of IP address + browser (the raw
 * IP is never stored). Unique viewers = distinct viewers ever.
 *
 * Shares: counted at most once per viewer per post per 24 hours.
 *
 * Concurrency: every change that touches a post's activity tables runs through
 * locked(), which takes the post row's write lock FIRST. Inserting a like, save,
 * comment or view takes a shared lock on the post (foreign key check) and the
 * recount then needs its write lock, so two simultaneous actions on one post
 * (a double tap, a like while a view is being recorded) could deadlock each
 * other (MySQL 1213 → HTTP 500). With the write lock taken up front they queue
 * instead; a deadlock that still happens is retried.
 */
class PostEngagement
{
    public const VIEW_WINDOW_MINUTES = 30;

    public const SHARE_WINDOW_HOURS = 24;

    public function viewerKey(Request $request): ?string
    {
        $user = $request->user('sanctum');
        if ($user) {
            return $user->role === 'tourist' ? 'u:'.$user->id : null; // staff/owners/admins are not audience
        }

        return 'g:'.hash('sha256', ($request->ip() ?? '').'|'.substr((string) $request->userAgent(), 0, 255).'|'.config('app.key'));
    }

    /**
     * Run $change in a transaction holding the post row's write lock.
     *
     * @template T
     * @param  callable(): T  $change
     * @return T
     */
    public function locked(BusinessPost $post, callable $change): mixed
    {
        return DB::transaction(function () use ($post, $change) {
            BusinessPost::whereKey($post->id)->lockForUpdate()->first();

            return $change();
        }, 3);
    }

    /** @return bool whether a new view was counted */
    public function recordView(BusinessPost $post, Request $request): bool
    {
        $key = $this->viewerKey($request);
        if ($key === null) {
            return false;
        }

        // The post lock also makes two simultaneous reports from one viewer count once.
        return $this->locked($post, function () use ($post, $key, $request) {
            $recent = DB::table('business_post_views')
                ->where('business_post_id', $post->id)->where('viewer_key', $key)
                ->where('viewed_at', '>=', now()->subMinutes(self::VIEW_WINDOW_MINUTES))
                ->exists();
            if ($recent) {
                return false;
            }
            DB::table('business_post_views')->insert([
                'business_post_id' => $post->id, 'viewer_key' => $key,
                'user_id' => $request->user('sanctum')?->id, 'viewed_at' => now(),
            ]);
            $this->recount($post, ['views', 'unique_viewers']);

            return true;
        });
    }

    /** @return bool whether a new share was counted */
    public function recordShare(BusinessPost $post, Request $request, string $channel): bool
    {
        $key = $this->viewerKey($request);
        if ($key === null) {
            return false;
        }

        return $this->locked($post, function () use ($post, $key, $request, $channel) {
            $recent = DB::table('business_post_shares')
                ->where('business_post_id', $post->id)->where('viewer_key', $key)
                ->where('shared_at', '>=', now()->subHours(self::SHARE_WINDOW_HOURS))
                ->exists();
            if ($recent) {
                return false;
            }
            DB::table('business_post_shares')->insert([
                'business_post_id' => $post->id, 'viewer_key' => $key,
                'user_id' => $request->user('sanctum')?->id, 'channel' => $channel, 'shared_at' => now(),
            ]);
            $this->recount($post, ['shares']);

            return true;
        });
    }

    /** @param list<'likes'|'views'|'unique_viewers'|'comments'|'saves'|'shares'> $which */
    public function recount(BusinessPost $post, array $which): void
    {
        $id = $post->id;
        $values = [];
        foreach ($which as $counter) {
            $values["{$counter}_count"] = match ($counter) {
                'likes' => DB::table('business_post_likes')->where('business_post_id', $id)->count(),
                'views' => DB::table('business_post_views')->where('business_post_id', $id)->count(),
                'unique_viewers' => DB::table('business_post_views')->where('business_post_id', $id)->distinct()->count('viewer_key'),
                'comments' => DB::table('business_post_comments')->where('business_post_id', $id)->whereNull('hidden_at')->count(),
                'saves' => DB::table('business_post_saves')->where('business_post_id', $id)->count(),
                'shares' => DB::table('business_post_shares')->where('business_post_id', $id)->count(),
            };
        }
        BusinessPost::whereKey($id)->update($values);
    }
}
