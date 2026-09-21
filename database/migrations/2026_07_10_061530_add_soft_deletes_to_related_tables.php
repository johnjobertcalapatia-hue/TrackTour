<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('favorites', fn (Blueprint $t) => $t->softDeletes());
        Schema::table('municipalities', fn (Blueprint $t) => $t->softDeletes());
        Schema::table('staff', fn (Blueprint $t) => $t->softDeletes());
        Schema::table('offering_categories', fn (Blueprint $t) => $t->softDeletes());
        Schema::table('business_documents', fn (Blueprint $t) => $t->softDeletes());
        Schema::table('business_media', fn (Blueprint $t) => $t->softDeletes());
    }

    public function down(): void
    {
        Schema::table('favorites', fn (Blueprint $t) => $t->dropSoftDeletes());
        Schema::table('municipalities', fn (Blueprint $t) => $t->dropSoftDeletes());
        Schema::table('staff', fn (Blueprint $t) => $t->dropSoftDeletes());
        Schema::table('offering_categories', fn (Blueprint $t) => $t->dropSoftDeletes());
        Schema::table('business_documents', fn (Blueprint $t) => $t->dropSoftDeletes());
        Schema::table('business_media', fn (Blueprint $t) => $t->dropSoftDeletes());
    }
};
