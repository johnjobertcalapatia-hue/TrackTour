<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Business posts (Promotions Part B): a caption with up to 10 photos or one
 * video, optionally linked to a dish sale, shown to tourists in a feed.
 * Tourists can like a post once (unique index).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('business_posts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('business_id')->constrained()->cascadeOnDelete();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->text('caption')->nullable();
            $table->string('status', 20)->default('published'); // published | hidden
            $table->foreignId('promotion_id')->nullable()->constrained()->nullOnDelete();
            $table->unsignedInteger('likes_count')->default(0);
            $table->timestamp('published_at')->nullable();
            $table->timestamps();
            $table->index(['status', 'published_at']);
            $table->index(['business_id', 'status']);
        });

        Schema::create('business_post_media', function (Blueprint $table) {
            $table->id();
            $table->foreignId('business_post_id')->constrained()->cascadeOnDelete();
            $table->string('type', 10); // image | video
            $table->string('path');
            $table->string('mime', 100)->nullable();
            $table->unsignedBigInteger('size')->default(0);
            $table->unsignedSmallInteger('sort_order')->default(0);
            $table->timestamps();
        });

        Schema::create('business_post_likes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('business_post_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->timestamps();
            $table->unique(['business_post_id', 'user_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('business_post_likes');
        Schema::dropIfExists('business_post_media');
        Schema::dropIfExists('business_posts');
    }
};
