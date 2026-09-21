<?php

namespace Database\Seeders;

use App\Models\Barangay;
use App\Models\Municipality;
use Illuminate\Database\Seeder;

class BarangaySeeder extends Seeder
{
    public function run(): void
    {
        $barangays = [
            'Bansud' => [
                'Alcadesma', 'Bato', 'Conrazon', 'Malo', 'Manihala',
                'Pag-asa', 'Poblacion', 'Proper Bansud', 'Proper Tiguisan',
                'Rosacara', 'Salcedo', 'Sumagui', 'Villa Pagasa',
            ],
            'Bongabong' => [
                'Anilao', 'Aplaya', 'Bagong Bayan I', 'Bagong Bayan II', 'Batangan',
                'Bukal', 'Camantigue', 'Carmundo', 'Cawayan', 'Dayhagan',
                'Formon', 'Hagan', 'Hagupit', 'Ipil', 'Kaligtasan',
                'Labasan', 'Labonan', 'Libertad', 'Lisap', 'Luna',
                'Malitbog', 'Mapang', 'Masaguisi', 'Mina de Oro', 'Morente',
                'Ogbot', 'Orconuma', 'Poblacion', 'Polusahi', 'Sagana',
                'San Isidro', 'San Jose', 'San Juan', 'Santa Cruz',
                'Sigange', 'Tawas',
            ],
            'Bulalacao' => [
                'Bagong Sikat', 'Balatasan', 'Benli (Mangyan Settlement)', 'Cabugao',
                'Cambunang (Pob.)', 'Campaasan (Pob.)', 'Maasin', 'Maujao',
                'Milagrosa (Guiob)', 'Nasukob (Pob.)', 'Poblacion',
                'San Francisco (Alimawan)', 'San Isidro', 'San Juan',
                'San Roque (Buyayao)',
            ],
            'Gloria' => [
                'Agos', 'Agsalin', 'Alma Villa', 'Andres Bonifacio', 'Balete',
                'Banus', 'Banutan', 'Bulaklakan', 'Buong Lupa',
                'Gaudencio Antonino', 'Guimbonan', 'Kawit', 'Lucio Laurel',
                'Macario Adriatico', 'Malamig', 'Malayong', 'Maligaya',
                'Malubay', 'Manguyang', 'Maragooc', 'Mirayan', 'Narra',
                'Papandungin', 'San Antonio', 'Santa Maria', 'Santa Theresa',
                'Tambong',
            ],
            'Mansalay' => [
                'B. del Mundo', 'Balugo', 'Bonbon', 'Budburan', 'Cabalwa',
                'Don Pedro', 'Maliwanag', 'Manaul', 'Panaytayan', 'Poblacion',
                'Roma', 'Santa Brigida', 'Santa Maria', 'Santa Teresita',
                'Villa Celestial', 'Wasig', 'Waygan',
            ],
            'Pinamalayan' => [
                'Anoling', 'Bacungan', 'Bangbang', 'Banilad', 'Buli',
                'Cacawan', 'Calingag', 'Del Razon', 'Guinhawa', 'Inclanay',
                'Lumangbayan', 'Malaya', 'Maliangcog', 'Maningcol', 'Marayos',
                'Marfrancisco', 'Nabuslot', 'Pagalagala', 'Palayan',
                'Pambisan Malaki', 'Pambisan Munti', 'Panggulayan', 'Papandayan',
                'Pili',
                'Zone I (Pob.)', 'Zone II (Pob.)', 'Zone III (Pob.)', 'Zone IV (Pob.)',
                'Quinabigan', 'Ranzo', 'Rosario', 'Sabang',
                'Santa Isabel', 'Santa Maria', 'Santa Rita', 'Santo Niño',
                'Wawa',
            ],
            'Roxas' => [
                'Bagumbayan (Pob.)', 'Cantil', 'Dangay', 'Happy Valley',
                'Libertad', 'Libtong', 'Little Tanauan', 'Mabuhay', 'Maraska',
                'Odiong', 'Paclasan (Pob.)', 'Poblacion',
                'San Aquilino', 'San Isidro', 'San Jose', 'San Mariano',
                'San Miguel', 'San Rafael', 'San Vicente',
                'Uyao', 'Victoria',
            ],
        ];

        foreach ($barangays as $municipalityName => $barangayList) {
            $municipality = Municipality::where('name', $municipalityName)->first();

            if (! $municipality) {
                $this->command->warn("Municipality '{$municipalityName}' not found. Skipping.");

                continue;
            }

            foreach ($barangayList as $barangayName) {
                Barangay::firstOrCreate([
                    'municipality_id' => $municipality->id,
                    'name' => $barangayName,
                ]);
            }
        }
    }
}
