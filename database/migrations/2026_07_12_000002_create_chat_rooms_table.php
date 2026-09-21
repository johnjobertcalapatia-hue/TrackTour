<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('chat_rooms', function (Blueprint $table) {
            $table->id();
            $table->string('type'); // food, transport, tour, general
            $table->foreignId('business_id')->nullable()->constrained()->nullOnDelete();
            $table->unsignedBigInteger('booking_id')->nullable();
            $table->unsignedBigInteger('delivery_id')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('chat_rooms');
    }
};
