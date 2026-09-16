<?php

use App\Models\AuditLog;
use App\Models\User;
use Illuminate\Support\Facades\Auth;
use Livewire\Attributes\Layout;
use Livewire\Volt\Component;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\Models\Role;

new #[Layout('layouts.app')] class extends Component
{
    public string $userSearch = '';
    public ?User $foundUser = null;
    public string $roleToAssign = '';

    /**
     * Toggles a permission on a role. Deliberately does not allow creating
     * or deleting roles themselves — the 10 role names are load-bearing
     * throughout route middleware (`role:school_admin`, etc.) and policies,
     * so changing the role set is a code change, not an admin-panel action.
     */
    public function togglePermission(string $roleName, string $permissionName): void
    {
        $role = Role::findByName($roleName);

        if ($role->hasPermissionTo($permissionName)) {
            $role->revokePermissionTo($permissionName);
            $action = 'revoked';
        } else {
            $role->givePermissionTo($permissionName);
            $action = 'granted';
        }

        AuditLog::record('role-permission-'.$action, Auth::id(), $role, ['permission' => $permissionName]);
    }

    public function searchUser(): void
    {
        $this->validate(['userSearch' => ['required', 'email']]);
        $this->foundUser = User::where('email', $this->userSearch)->first();
    }

    public function assignRole(): void
    {
        abort_unless($this->foundUser, 404);
        $this->validate(['roleToAssign' => ['required', 'exists:roles,name']]);

        if (! $this->foundUser->hasRole($this->roleToAssign)) {
            $this->foundUser->assignRole($this->roleToAssign);
            AuditLog::record('role-assigned', Auth::id(), $this->foundUser, ['role' => $this->roleToAssign]);
        }

        $this->foundUser->refresh();
    }

    public function removeRole(string $roleName): void
    {
        abort_unless($this->foundUser, 404);

        $this->foundUser->removeRole($roleName);
        AuditLog::record('role-removed', Auth::id(), $this->foundUser, ['role' => $roleName]);
        $this->foundUser->refresh();
    }

    public function with(): array
    {
        return [
            'roles' => Role::with('permissions')->orderBy('name')->get(),
            'permissions' => Permission::orderBy('name')->get(),
        ];
    }
}; ?>

<div>
    <x-slot name="header">
        <h2 class="font-semibold text-xl text-gray-800 leading-tight">Roles & Permissions</h2>
    </x-slot>

    <div class="py-8 max-w-5xl mx-auto sm:px-6 lg:px-8 space-y-6">
        <div class="bg-white rounded-lg shadow p-6 overflow-x-auto">
            <h3 class="font-semibold text-gray-900 mb-4">Role &times; Permission Matrix</h3>
            <table class="min-w-full text-xs">
                <thead>
                    <tr>
                        <th class="text-left p-2 sticky left-0 bg-white">Permission</th>
                        @foreach ($roles as $role)
                            <th class="p-2 text-center whitespace-nowrap">{{ $role->name }}</th>
                        @endforeach
                    </tr>
                </thead>
                <tbody>
                    @foreach ($permissions as $permission)
                        <tr class="border-t">
                            <td class="p-2 sticky left-0 bg-white whitespace-nowrap">{{ $permission->name }}</td>
                            @foreach ($roles as $role)
                                <td class="p-2 text-center">
                                    <input type="checkbox"
                                        @checked($role->permissions->contains('name', $permission->name))
                                        wire:click="togglePermission('{{ $role->name }}', '{{ $permission->name }}')" />
                                </td>
                            @endforeach
                        </tr>
                    @endforeach
                </tbody>
            </table>
        </div>

        <div class="bg-white rounded-lg shadow p-6">
            <h3 class="font-semibold text-gray-900 mb-4">Manage a User's Roles</h3>
            <div class="flex gap-3 items-end">
                <div class="flex-1">
                    <x-input-label for="userSearch" value="User email" />
                    <x-text-input wire:model="userSearch" id="userSearch" class="mt-1 w-full" />
                    <x-input-error :messages="$errors->get('userSearch')" class="mt-2" />
                </div>
                <x-secondary-button wire:click="searchUser">Search</x-secondary-button>
            </div>

            @if ($userSearch && ! $foundUser)
                <p class="text-sm text-gray-400 mt-3">No user found with that email.</p>
            @endif

            @if ($foundUser)
                <div class="mt-4 border-t pt-4">
                    <p class="text-sm font-medium text-gray-900">{{ $foundUser->name }} &lt;{{ $foundUser->email }}&gt;</p>
                    <div class="flex flex-wrap gap-2 mt-2">
                        @foreach ($foundUser->roles as $role)
                            <span class="text-xs px-2 py-1 bg-indigo-50 text-indigo-700 rounded flex items-center gap-1">
                                {{ $role->name }}
                                <button wire:click="removeRole('{{ $role->name }}')" class="text-indigo-400 hover:text-indigo-700">&times;</button>
                            </span>
                        @endforeach
                    </div>

                    <div class="flex gap-3 items-end mt-4">
                        <div class="flex-1">
                            <select wire:model="roleToAssign" class="border-gray-300 rounded-md shadow-sm text-sm w-full">
                                <option value="">Select role to add</option>
                                @foreach ($roles as $role)
                                    <option value="{{ $role->name }}">{{ $role->name }}</option>
                                @endforeach
                            </select>
                        </div>
                        <x-primary-button wire:click="assignRole">Add Role</x-primary-button>
                    </div>
                </div>
            @endif
        </div>
    </div>
</div>
