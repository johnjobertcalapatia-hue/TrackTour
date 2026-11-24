<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Deals & Posts: the business can comment on its own posts. Such a comment is
 * shown as the business (name and logo, "Author" badge); user_id still records
 * which owner or staff member wrote it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('business_post_comments', function (Blueprint $table) {
            $table->foreignId('business_id')->nullable()->after('user_id')->constrained()->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('business_post_comments', function (Blueprint $table) {
            $table->dropConstrainedForeignId('business_id');
        });
    }
};
