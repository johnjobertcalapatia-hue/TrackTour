<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('business_document_uploads', function (Blueprint $table) {
            $table->renameColumn('remarks', 'admin_remarks');
            $table->string('document_number')->nullable()->after('required_document_id');
            $table->string('registered_name')->nullable()->after('document_number');
            $table->string('issued_by')->nullable()->after('registered_name');
            $table->date('issue_date')->nullable()->after('issued_by');
            $table->text('owner_remarks')->nullable()->after('admin_remarks');
        });
    }

    public function down(): void
    {
        Schema::table('business_document_uploads', function (Blueprint $table) {
            $table->renameColumn('admin_remarks', 'remarks');
            $table->dropColumn(['document_number', 'registered_name', 'issued_by', 'issue_date', 'owner_remarks']);
        });
    }
};
