<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Checkpoint key rotation (Stage 2 hardening): each checkpoint names the key
 * that signed it, so a retired key can still verify older checkpoints.
 * Existing rows were signed with the APP_KEY-derived key ("derived").
 * ADD COLUMN is DDL, so the append-only row triggers do not block it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('transaction_checkpoints', function (Blueprint $table) {
            $table->string('key_id', 32)->default('derived')->after('signature');
        });
    }

    public function down(): void
    {
        Schema::table('transaction_checkpoints', function (Blueprint $table) {
            $table->dropColumn('key_id');
        });
    }
};
