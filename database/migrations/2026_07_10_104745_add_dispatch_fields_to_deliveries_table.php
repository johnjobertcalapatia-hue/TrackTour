<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('deliveries', function (Blueprint $table) {
            $table->string('dispatch_status')->nullable()->after('notes')->comment('waiting_for_rider, notified, no_rider_available');
            $table->timestamp('dispatch_expires_at')->nullable()->after('dispatch_status');
        });
    }

    public function down(): void
    {
        Schema::table('deliveries', function (Blueprint $table) {
            $table->dropColumn(['dispatch_status', 'dispatch_expires_at']);
        });
    }
};
