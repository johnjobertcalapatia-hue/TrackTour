<?php

use App\Support\StaffPermissions;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Staff Management Stage 1 (docs/staff-management-plan.md): what each staff
 * role may do, as permission keys from App\Support\StaffPermissions.
 *
 * Existing roles are mapped here so existing staff keep working: legacy
 * `role_permissions` module grants are converted, plus defaults for each
 * role's purpose. Nothing existing is altered or removed.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('staff_role_permissions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('staff_role_id')->constrained()->cascadeOnDelete();
            $table->string('permission', 64);
            $table->timestamps();

            $table->unique(['staff_role_id', 'permission']);
        });

        StaffPermissions::seedRolesWithoutGrants();
    }

    public function down(): void
    {
        Schema::dropIfExists('staff_role_permissions');
    }
};
