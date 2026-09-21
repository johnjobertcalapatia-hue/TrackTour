<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('rider_credits', function (Blueprint $table) {
            $table->id();
            $table->foreignId('rider_id')->constrained('users')->cascadeOnDelete();
            $table->decimal('total_credits', 12, 2)->default(0);
            $table->decimal('available_credits', 12, 2)->default(0);
            $table->decimal('reserved_credits', 12, 2)->default(0);
            $table->timestamps();

            $table->unique('rider_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('rider_credits');
    }
};
