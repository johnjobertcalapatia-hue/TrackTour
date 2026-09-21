<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('businesses', function (Blueprint $table) {
            $table->json('business_hours')->nullable()->after('business_days');
        });

        // Backfill business_hours from the legacy single open/close + business_days.
        $rows = DB::table('businesses')
            ->select('id', 'opening_time', 'closing_time', 'business_days')
            ->get();

        foreach ($rows as $row) {
            if (empty($row->opening_time) || empty($row->closing_time)) {
                continue;
            }

            $days = is_string($row->business_days)
                ? (json_decode($row->business_days, true) ?: null)
                : $row->business_days;

            $allDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
            $schedule = [];

            foreach ($allDays as $day) {
                if (is_array($days) && ! empty($days) && ! in_array($day, $days)) {
                    $schedule[$day] = [];
                    continue;
                }
                $schedule[$day] = [
                    [
                        'open' => substr((string) $row->opening_time, 0, 5),
                        'close' => substr((string) $row->closing_time, 0, 5),
                    ],
                ];
            }

            DB::table('businesses')->where('id', $row->id)->update([
                'business_hours' => json_encode($schedule),
            ]);
        }
    }

    public function down(): void
    {
        Schema::table('businesses', function (Blueprint $table) {
            $table->dropColumn('business_hours');
        });
    }
};
