<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Notifications module: each notification can point at the record it is about
 * (order, booking, conversation, review, system notice) so tapping it opens a
 * detail page. Older rows keep data = null and show title + message only.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('notifications', function (Blueprint $table) {
            $table->json('data')->nullable()->after('type');
            $table->index(['user_id', 'type', 'read_at']);
        });
    }

    public function down(): void
    {
        Schema::table('notifications', function (Blueprint $table) {
            $table->dropIndex(['user_id', 'type', 'read_at']);
            $table->dropColumn('data');
        });
    }
};
