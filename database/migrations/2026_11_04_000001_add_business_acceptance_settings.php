<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    // Re-runnable (Railway 1050/1060 crash-loop lesson): each column is
    // guarded on its own, so a half-applied run (MySQL DDL is not
    // transactional) also completes on the next deploy.
    public function up(): void
    {
        if (! Schema::hasColumn('businesses', 'accepts_orders')) {
            Schema::table('businesses', function (Blueprint $table) {
                $table->boolean('accepts_orders')->default(true)->after('accepts_reservation');
            });
        }
        if (! Schema::hasColumn('businesses', 'accepts_walk_ins')) {
            Schema::table('businesses', function (Blueprint $table) {
                $table->boolean('accepts_walk_ins')->default(true)->after('accepts_orders');
            });
        }
    }

    public function down(): void
    {
        $columns = array_values(array_filter(
            ['accepts_orders', 'accepts_walk_ins'],
            fn (string $column) => Schema::hasColumn('businesses', $column),
        ));
        if ($columns !== []) {
            Schema::table('businesses', function (Blueprint $table) use ($columns) {
                $table->dropColumn($columns);
            });
        }
    }
};
