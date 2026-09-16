<?php

namespace Tests;

use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;

abstract class TestCase extends BaseTestCase
{
    /**
     * Any test using RefreshDatabase gets roles/permissions seeded
     * automatically — most feature tests assign a role and would otherwise
     * fail against an empty roles table.
     */
    protected $seed = true;

    protected $seeder = RolesAndPermissionsSeeder::class;
}
