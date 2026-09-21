<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('preparation_prediction_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('restaurant_id')->constrained('businesses');
            $table->foreignId('menu_item_id')->constrained('offerings');
            $table->foreignId('restaurant_order_id')->constrained('orders');
            $table->string('prediction_source')->comment('fallback|restaurant_default|historical_avg|weighted_avg|ml');
            $table->unsignedInteger('predicted_seconds');
            $table->unsignedInteger('actual_seconds')->nullable();
            $table->integer('error_seconds')->nullable();
            $table->string('model_version')->nullable();
            $table->timestamps();

            $table->index(['restaurant_id', 'menu_item_id']);
            $table->index('prediction_source');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('preparation_prediction_logs');
    }
};
