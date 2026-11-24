<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * System maintenance notices sent by the admin (Bansud Tourism Office) to an
 * audience; each send also creates one notification per recipient.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('system_notices', function (Blueprint $table) {
            $table->id();
            $table->string('title', 120);
            $table->text('message');
            $table->string('audience', 30); // business_owners, riders, tourists, everyone
            $table->dateTime('starts_at');
            $table->dateTime('ends_at');
            $table->unsignedInteger('recipients_count')->default(0);
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('cancelled_at')->nullable();
            $table->foreignId('cancelled_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['audience', 'ends_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('system_notices');
    }
};
