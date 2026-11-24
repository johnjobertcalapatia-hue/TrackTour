<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Staff Management, restaurant roles (docs/staff-management-plan.md §5): one
 * employee may hold several roles without a second account. Every existing
 * staff member's current role is copied in, so nothing changes for them;
 * staff.staff_role_id stays as the first (primary) role for compatibility.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('staff_role_assignments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('staff_id')->constrained('staff')->cascadeOnDelete();
            $table->foreignId('staff_role_id')->constrained()->cascadeOnDelete();
            $table->timestamps();

            $table->unique(['staff_id', 'staff_role_id']);
        });

        $now = now();
        DB::table('staff')->whereNotNull('staff_role_id')->orderBy('id')->select('id', 'staff_role_id')
            ->chunk(500, function ($rows) use ($now) {
                DB::table('staff_role_assignments')->insertOrIgnore($rows->map(fn ($r) => [
                    'staff_id' => $r->id,
                    'staff_role_id' => $r->staff_role_id,
                    'created_at' => $now,
                    'updated_at' => $now,
                ])->all());
            });
    }

    public function down(): void
    {
        Schema::dropIfExists('staff_role_assignments');
    }
};
