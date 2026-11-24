<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Staff Management Stage 1: the business owner's record of staff account and
 * permission events (created, invited, activated, suspended, removed, role
 * changed…). Separate from the Tourism Office's activity_logs. Append-only.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('staff_activity_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('business_id')->constrained()->cascadeOnDelete();
            $table->foreignId('staff_id')->nullable()->constrained('staff')->nullOnDelete();
            $table->foreignId('actor_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('actor_type', 16); // owner | staff | system
            $table->string('action', 64);
            $table->string('description', 500);
            $table->json('properties')->nullable();
            $table->string('ip_address', 45)->nullable();
            $table->timestamp('created_at')->useCurrent();

            $table->index(['business_id', 'created_at']);
            $table->index(['staff_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('staff_activity_logs');
    }
};
