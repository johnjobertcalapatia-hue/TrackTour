<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Staff Management Stage 1: invitation-based staff activation. Only the
 * SHA-256 hash of the token is stored; a token is single-use (accepted_at)
 * and expires after 72 hours (expires_at). Revoked when re-sent or the
 * staff member is removed.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('staff_invitations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('staff_id')->constrained('staff')->cascadeOnDelete();
            $table->foreignId('business_id')->constrained()->cascadeOnDelete();
            $table->string('email');
            $table->char('token_hash', 64)->unique();
            $table->foreignId('invited_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('expires_at');
            $table->timestamp('accepted_at')->nullable();
            $table->timestamp('revoked_at')->nullable();
            $table->timestamps();

            $table->index(['business_id', 'accepted_at', 'revoked_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('staff_invitations');
    }
};
