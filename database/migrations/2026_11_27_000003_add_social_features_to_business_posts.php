<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Deals & Posts, social feed (2026-11-24): recorded views (one per viewer per
 * post per 30 minutes), comments the business can hide or delete, saves,
 * shares and business followers. The counters on business_posts are always
 * recomputed from these tables, never incremented blindly.
 * Posts may also be drafts (status 'draft', never shown to tourists).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('business_posts', function (Blueprint $table) {
            $table->unsignedInteger('views_count')->default(0)->after('likes_count');
            $table->unsignedInteger('unique_viewers_count')->default(0)->after('views_count');
            $table->unsignedInteger('comments_count')->default(0)->after('unique_viewers_count');
            $table->unsignedInteger('saves_count')->default(0)->after('comments_count');
            $table->unsignedInteger('shares_count')->default(0)->after('saves_count');
        });

        Schema::create('business_post_views', function (Blueprint $table) {
            $table->id();
            $table->foreignId('business_post_id')->constrained()->cascadeOnDelete();
            // 'u:<user id>' for a signed-in tourist, 'g:<sha256 of ip + user agent>' for a guest.
            $table->string('viewer_key', 80);
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->timestamp('viewed_at');
            $table->index(['business_post_id', 'viewer_key', 'viewed_at'], 'bp_views_post_viewer_viewed_idx');
            $table->index(['business_post_id', 'viewed_at'], 'bp_views_post_viewed_idx');
        });

        Schema::create('business_post_comments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('business_post_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->text('body');
            $table->timestamp('hidden_at')->nullable();
            $table->foreignId('hidden_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            // Short names: MySQL index names are limited to 64 characters.
            $table->index(['business_post_id', 'hidden_at', 'created_at'], 'bp_comments_post_hidden_created_idx');
        });

        Schema::create('business_post_saves', function (Blueprint $table) {
            $table->id();
            $table->foreignId('business_post_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->timestamps();
            $table->unique(['business_post_id', 'user_id']);
            $table->index(['user_id', 'created_at']);
        });

        Schema::create('business_post_shares', function (Blueprint $table) {
            $table->id();
            $table->foreignId('business_post_id')->constrained()->cascadeOnDelete();
            $table->string('viewer_key', 80);
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->string('channel', 20)->default('link'); // link | native
            $table->timestamp('shared_at');
            $table->index(['business_post_id', 'viewer_key', 'shared_at'], 'bp_shares_post_viewer_shared_idx');
        });

        Schema::create('business_followers', function (Blueprint $table) {
            $table->id();
            $table->foreignId('business_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->timestamps();
            $table->unique(['business_id', 'user_id']);
            $table->index(['user_id', 'business_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('business_followers');
        Schema::dropIfExists('business_post_shares');
        Schema::dropIfExists('business_post_saves');
        Schema::dropIfExists('business_post_comments');
        Schema::dropIfExists('business_post_views');
        Schema::table('business_posts', function (Blueprint $table) {
            $table->dropColumn(['views_count', 'unique_viewers_count', 'comments_count', 'saves_count', 'shares_count']);
        });
    }
};
