<?php

namespace App\Support;

use App\Models\BusinessPost;
use App\Models\BusinessPostMedia;
use App\Models\Offering;
use App\Models\Promotion;
use App\Services\SalePricing;
use Illuminate\Support\Facades\Storage;

/**
 * JSON shape of a business post for the owner portal and the tourist feed
 * (Promotions Part B). Media come as a storage path plus a ready URL.
 */
final class PostPresenter
{
    public static function forOwner(BusinessPost $post): array
    {
        $business = $post->business;

        return self::base($post) + [
            'status' => $post->status,
            'created_at' => $post->created_at?->toIso8601String(),
            'business' => $business ? ['id' => $business->id, 'name' => $business->business_name, 'logo' => $business->logo, 'category' => null, 'following' => false] : null,
            'unique_viewers_count' => (int) $post->unique_viewers_count,
            'sale' => $post->promotion ? self::saleForTourist($post->promotion) : null,
        ];
    }

    /**
     * @param  array{liked?: array<int, true>, saved?: array<int, true>, following?: array<int, true>}  $state  what the viewer has liked, saved and follows
     */
    public static function forTourist(BusinessPost $post, array $state = []): array
    {
        $business = $post->business;

        return self::base($post) + [
            'business' => $business ? [
                'id' => $business->id,
                'name' => $business->business_name,
                'logo' => $business->logo,
                'category' => $business->category?->name,
                'following' => isset($state['following'][$business->id]),
            ] : null,
            'liked' => isset($state['liked'][$post->id]),
            'saved' => isset($state['saved'][$post->id]),
            'sale' => $post->promotion ? self::saleForTourist($post->promotion) : null,
        ];
    }

    /** A comment as tourists and the business see it. The author's email is never shown. */
    public static function comment(\App\Models\BusinessPostComment $comment, ?int $viewerId, bool $forOwner = false): array
    {
        $business = $comment->business_id ? $comment->business : null;
        if ($business) {
            // The business speaking: its name and logo, never the staff member's details.
            $author = ['name' => $business->business_name, 'avatar' => $business->logo, 'is_business' => true];
        } else {
            $profile = $comment->user?->profile;
            $name = trim(($profile?->first_name ?? '').' '.($profile?->last_name ? mb_substr($profile->last_name, 0, 1).'.' : ''));
            $author = ['name' => $name !== '' ? $name : ($comment->user?->name ?: 'Tourist'), 'avatar' => $profile?->avatar, 'is_business' => false];
        }

        return [
            'id' => $comment->id,
            'body' => $comment->body,
            'author' => $author,
            // Tourists may delete their own comments; the business manages its comments from its portal.
            'mine' => $viewerId !== null && ! $business && (int) $comment->user_id === $viewerId,
            'created_at' => $comment->created_at?->toIso8601String(),
        ] + ($forOwner ? ['hidden' => $comment->hidden_at !== null] : []);
    }

    private static function base(BusinessPost $post): array
    {
        return [
            'id' => $post->id,
            'business_id' => $post->business_id,
            'business_name' => $post->business?->business_name,
            'caption' => $post->caption,
            'media' => $post->media->map(fn (BusinessPostMedia $m) => [
                'id' => $m->id,
                'type' => $m->type,
                'path' => $m->path,
                'url' => Storage::disk('public')->url($m->path),
            ])->values()->all(),
            'likes_count' => (int) $post->likes_count,
            'comments_count' => (int) $post->comments_count,
            'saves_count' => (int) $post->saves_count,
            'shares_count' => (int) $post->shares_count,
            'views_count' => (int) $post->views_count,
            'published_at' => $post->published_at?->toIso8601String(),
        ];
    }

    private static function saleSummary(Promotion $promotion): array
    {
        $pricing = app(SalePricing::class);

        return [
            'id' => $promotion->id,
            'kind' => $promotion->kind,
            'title' => $promotion->name,
            'label' => $pricing->label((string) $promotion->type, (float) $promotion->value),
            'status' => $promotion->trashed() ? 'stopped' : $promotion->saleStatus(),
        ];
    }

    /**
     * A linked dish sale shows its dishes at the price the tourist pays now
     * (the same SalePricing checkout uses); a finished one says so.
     */
    private static function saleForTourist(Promotion $promotion): array
    {
        $summary = self::saleSummary($promotion);
        $summary['ends_at'] = $promotion->end_date?->toIso8601String();
        $summary['dishes'] = [];
        if (! $promotion->isItemSale() || $summary['status'] !== 'active') {
            return $summary;
        }

        $dishes = $promotion->offerings()
            ->where('offerings.is_available', true)
            ->where('offerings.status', 'available')
            ->get(['offerings.id', 'offerings.business_id', 'offerings.name', 'offerings.price', 'offerings.image']);
        $quotes = app(SalePricing::class)->quoteMany($dishes);
        $summary['dishes'] = $dishes->map(fn (Offering $o) => [
            'id' => $o->id,
            'name' => $o->name,
            'image' => $o->image,
            'business_id' => $o->business_id,
            ...SalePricing::presentFields($quotes[$o->id]),
        ])->values()->all();

        return $summary;
    }
}
