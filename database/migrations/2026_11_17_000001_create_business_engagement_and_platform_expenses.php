<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Bansud dashboard analytics sources.
 *
 * - business_engagement_events: real profile/offering views. One row per
 *   viewer, business, kind and Philippine day (unique), so refreshing a page
 *   cannot inflate popularity.
 * - platform_expenses: Tourism Office operating expenses, so net income is
 *   platform revenue minus recorded expenses (never order totals).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('business_engagement_events', function (Blueprint $table) {
            $table->id();
            $table->foreignId('business_id')->constrained()->cascadeOnDelete();
            $table->string('type', 30); // profile_view | offering_view
            $table->foreignId('offering_id')->nullable()->constrained()->nullOnDelete();
            $table->string('viewer_key', 64);
            $table->date('viewed_on');
            $table->timestamp('created_at')->nullable();

            $table->unique(['business_id', 'type', 'viewer_key', 'viewed_on'], 'bee_unique_daily_view');
            $table->index(['viewed_on', 'type']);
        });

        Schema::create('platform_expenses', function (Blueprint $table) {
            $table->id();
            $table->foreignId('municipality_id')->nullable()->constrained()->nullOnDelete();
            $table->string('category', 50);
            $table->string('description', 255);
            $table->decimal('amount', 12, 2);
            $table->date('expense_date');
            $table->foreignId('recorded_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index('expense_date');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('platform_expenses');
        Schema::dropIfExists('business_engagement_events');
    }
};
