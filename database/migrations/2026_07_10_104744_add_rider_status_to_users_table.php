<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('rider_status')->default('offline')->after('account_status')->comment('offline, online, busy');
            $table->timestamp('rider_status_updated_at')->nullable()->after('rider_status');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['rider_status', 'rider_status_updated_at']);
        });
    }
};
