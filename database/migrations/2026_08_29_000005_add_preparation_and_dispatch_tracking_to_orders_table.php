<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->unsignedInteger('predicted_preparation_seconds')->nullable()->after('refund_failure_reason');
            $table->timestamp('predicted_ready_at')->nullable()->after('predicted_preparation_seconds');
            $table->timestamp('preparation_started_at')->nullable()->after('predicted_ready_at');
            $table->timestamp('food_ready_at')->nullable()->after('preparation_started_at');
            $table->unsignedInteger('actual_preparation_seconds')->nullable()->after('food_ready_at');
            $table->integer('prediction_error_seconds')->nullable()->after('actual_preparation_seconds');
            $table->string('prediction_source')->nullable()->after('prediction_error_seconds');

            $table->timestamp('dispatch_scheduled_at')->nullable()->after('prediction_source');
            $table->timestamp('dispatch_started_at')->nullable()->after('dispatch_scheduled_at');
            $table->foreignId('selected_rider_id')->nullable()->after('dispatch_started_at')->constrained('users');
            $table->unsignedInteger('rider_eta_seconds')->nullable()->after('selected_rider_id');
            $table->unsignedInteger('pickup_buffer_seconds')->default(120)->after('rider_eta_seconds');
            $table->timestamp('estimated_rider_arrival_at')->nullable()->after('pickup_buffer_seconds');
            $table->timestamp('actual_rider_arrival_at')->nullable()->after('estimated_rider_arrival_at');
            $table->timestamp('actual_pickup_at')->nullable()->after('actual_rider_arrival_at');
        });
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->dropColumn([
                'predicted_preparation_seconds',
                'predicted_ready_at',
                'preparation_started_at',
                'food_ready_at',
                'actual_preparation_seconds',
                'prediction_error_seconds',
                'prediction_source',
                'dispatch_scheduled_at',
                'dispatch_started_at',
                'selected_rider_id',
                'rider_eta_seconds',
                'pickup_buffer_seconds',
                'estimated_rider_arrival_at',
                'actual_rider_arrival_at',
                'actual_pickup_at',
            ]);
        });
    }
};
