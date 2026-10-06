<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::table('offerings')->update(['preparation_time' => 25]);
    }

    public function down(): void
    {
        // Intentionally no-op: prior values were NULL across all rows,
        // so there is no history to restore.
    }
};