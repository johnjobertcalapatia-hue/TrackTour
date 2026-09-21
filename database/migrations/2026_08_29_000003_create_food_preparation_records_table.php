<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('food_preparation_records', function (Blueprint $table) {
            $table->id();
            $table->foreignId('restaurant_id')->constrained('businesses');
            $table->foreignId('menu_item_id')->constrained('offerings');
            $table->foreignId('restaurant_order_id')->constrained('orders');
            $table->timestamp('preparation_started_at')->nullable();
            $table->timestamp('ready_at')->nullable();
            $table->unsignedInteger('predicted_preparation_seconds')->nullable();
            $table->unsignedInteger('actual_preparation_seconds');
            $table->integer('prediction_error_seconds')->nullable();
            $table->unsignedSmallInteger('quantity')->default(1);
            $table->unsignedTinyInteger('day_of_week')->comment('0=Sun..6=Sat');
            $table->unsignedTinyInteger('hour_of_day')->comment('0-23');
            $table->string('kitchen_load_at_start')->default('low')->comment('low|medium|high');
            $table->boolean('is_valid_for_training')->default(true);
            $table->timestamps();

            $table->index(['restaurant_id', 'menu_item_id', 'is_valid_for_training'], 'fpr_restaurant_menu_valid');
            $table->index('is_valid_for_training', 'fpr_valid');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('food_preparation_records');
    }
};
