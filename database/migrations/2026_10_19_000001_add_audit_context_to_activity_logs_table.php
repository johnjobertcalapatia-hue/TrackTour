<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('activity_logs', function (Blueprint $table) {
            $table->string('type')->nullable()->after('action');
            $table->string('model_type')->nullable()->after('description');
            $table->unsignedBigInteger('model_id')->nullable()->after('model_type');

            $table->index('type');
            $table->index(['model_type', 'model_id']);
        });
    }

    public function down(): void
    {
        Schema::table('activity_logs', function (Blueprint $table) {
            $table->dropIndex(['type']);
            $table->dropIndex(['model_type', 'model_id']);
            $table->dropColumn(['type', 'model_type', 'model_id']);
        });
    }
};
