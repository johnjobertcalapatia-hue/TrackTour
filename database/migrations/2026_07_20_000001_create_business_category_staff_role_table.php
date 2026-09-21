<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('business_category_staff_role', function (Blueprint $table) {
            $table->id();
            $table->foreignId('business_category_id')->constrained()->cascadeOnDelete();
            $table->foreignId('staff_role_id')->constrained()->cascadeOnDelete();
            $table->timestamps();
            $table->unique(['business_category_id', 'staff_role_id'], 'bc_sr_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('business_category_staff_role');
    }
};
