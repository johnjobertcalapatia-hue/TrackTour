<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('role_permissions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('staff_role_id')->constrained()->cascadeOnDelete();
            $table->string('module_code')->comment('matches BusinessModule codes');
            $table->boolean('can_view')->default(false);
            $table->boolean('can_create')->default(false);
            $table->boolean('can_update')->default(false);
            $table->boolean('can_delete')->default(false);
            $table->boolean('can_export')->default(false);
            $table->boolean('can_approve')->default(false);
            $table->timestamps();

            $table->unique(['staff_role_id', 'module_code']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('role_permissions');
    }
};
