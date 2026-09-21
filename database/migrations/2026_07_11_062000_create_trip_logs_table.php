<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('trip_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('delivery_id')->constrained()->cascadeOnDelete();
            $table->foreignId('rider_id')->constrained('users')->cascadeOnDelete();
            $table->float('distance_meters')->default(0);
            $table->unsignedInteger('duration_seconds')->default(0);
            $table->float('average_speed_kph')->default(0);
            $table->text('encoded_polyline')->nullable();
            $table->integer('point_count')->default(0);
            $table->timestamp('started_at')->nullable();
            $table->timestamp('ended_at')->nullable();
            $table->timestamps();

            $table->index('delivery_id');
            $table->index('rider_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('trip_logs');
    }
};
