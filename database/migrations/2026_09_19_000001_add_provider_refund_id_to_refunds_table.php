<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('refunds', function (Blueprint $table) {
            $table->string('provider_refund_id')->nullable()->unique()->after('payment_id');
            $table->json('metadata')->nullable()->after('reason');
        });
    }

    public function down(): void
    {
        Schema::table('refunds', function (Blueprint $table) {
            $table->dropUnique(['provider_refund_id']);
            $table->dropColumn(['provider_refund_id', 'metadata']);
        });
    }
};