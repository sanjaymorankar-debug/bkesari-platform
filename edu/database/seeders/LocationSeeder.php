<?php

namespace Database\Seeders;

use App\Models\District;
use App\Models\State;
use Illuminate\Database\Seeder;

class LocationSeeder extends Seeder
{
    public function run(): void
    {
        $data = [
            'MH' => ['name' => 'Maharashtra', 'districts' => ['PUN' => 'Pune', 'MUM' => 'Mumbai']],
            'KA' => ['name' => 'Karnataka', 'districts' => ['BLR' => 'Bengaluru Urban', 'MYS' => 'Mysuru']],
            'DL' => ['name' => 'Delhi', 'districts' => ['NDL' => 'New Delhi']],
        ];

        foreach ($data as $code => $info) {
            $state = State::firstOrCreate(['code' => $code], ['name' => $info['name']]);

            foreach ($info['districts'] as $dcode => $dname) {
                District::firstOrCreate(
                    ['state_id' => $state->id, 'name' => $dname],
                    ['code' => $dcode]
                );
            }
        }
    }
}
