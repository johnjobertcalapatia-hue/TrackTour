<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('order_items', function (Blueprint $table) {
            $table->string('status')->default('pending')->after('notes');
            $table->timestamp('accepted_at')->nullable()->after('status');
            $table->timestamp('preparation_started_at')->nullable()->after('accepted_at');
            $table->timestamp('ready_at')->nullable()->after('preparation_started_at');
            $table->string('rejection_reason')->nullable()->after('ready_at');
            $table->foreignId('rejected_by')->nullable()->after('rejection_reason');
        });
    }

    public function down(): void
    {
        Schema::table('order_items', function (Blueprint $table) {
            $table->dropColumn(['status', 'accepted_at', 'preparation_started_at', 'ready_at', 'rejection_reason', 'rejected_by']);
        });
    }
};
