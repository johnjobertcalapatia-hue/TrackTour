<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('deliveries', function (Blueprint $table) {
            $table->timestamp('scheduled_at')->nullable()->after('dispatch_expires_at');
            $table->unsignedInteger('dispatch_attempts')->default(0)->after('scheduled_at');
            $table->timestamp('dispatch_retry_at')->nullable()->after('dispatch_attempts');
            $table->timestamp('dispatch_failed_at')->nullable()->after('dispatch_retry_at');
        });
    }

    public function down(): void
    {
        Schema::table('deliveries', function (Blueprint $table) {
            $table->dropColumn(['scheduled_at', 'dispatch_attempts', 'dispatch_retry_at', 'dispatch_failed_at']);
        });
    }
};