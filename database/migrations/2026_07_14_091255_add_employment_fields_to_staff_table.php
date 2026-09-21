<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('staff', function (Blueprint $table) {
            $table->string('employee_id')->unique()->nullable()->after('id');
            $table->string('middle_name')->nullable()->after('status');
            $table->string('suffix')->nullable()->after('middle_name');
            $table->string('gender')->nullable()->after('suffix');
            $table->date('date_of_birth')->nullable()->after('gender');
            $table->string('mobile_number')->nullable()->after('date_of_birth');
            $table->text('address')->nullable()->after('mobile_number');
            $table->string('profile_picture')->nullable()->after('address');
            $table->string('department')->nullable()->after('profile_picture');
            $table->date('date_hired')->nullable()->after('department');
            $table->string('salary_type')->nullable()->after('date_hired')->comment('hourly, daily, monthly');
            $table->string('employment_status')->default('full_time')->after('salary_type')->comment('full_time, part_time, contractual');
            $table->timestamp('last_login_at')->nullable()->after('employment_status');
            $table->string('last_login_ip')->nullable()->after('last_login_at');
            $table->boolean('two_factor_enabled')->default(false)->after('last_login_ip');
        });
    }

    public function down(): void
    {
        Schema::table('staff', function (Blueprint $table) {
            $table->dropColumn([
                'employee_id', 'middle_name', 'suffix', 'gender', 'date_of_birth',
                'mobile_number', 'address', 'profile_picture', 'department',
                'date_hired', 'salary_type', 'employment_status',
                'last_login_at', 'last_login_ip', 'two_factor_enabled',
            ]);
        });
    }
};
