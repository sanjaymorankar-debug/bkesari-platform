<?php

use App\Models\ComplaintCategory;
use Illuminate\Support\Str;
use Livewire\Attributes\Layout;
use Livewire\Volt\Component;

new #[Layout('layouts.app')] class extends Component
{
    public string $newName = '';
    public bool $newIsChildSafety = false;

    public function addCategory(): void
    {
        $validated = $this->validate([
            'newName' => ['required', 'string', 'max:255', 'unique:complaint_categories,name'],
        ]);

        ComplaintCategory::create([
            'name' => $validated['newName'],
            'slug' => Str::slug($validated['newName']).'-'.Str::random(4),
            'is_child_safety' => $this->newIsChildSafety,
            'is_active' => true,
        ]);

        \App\Models\AuditLog::record('complaint-category-created', auth()->id(), metadata: ['name' => $validated['newName']]);

        $this->newName = '';
        $this->newIsChildSafety = false;
    }

    public function toggleActive(int $id): void
    {
        $category = ComplaintCategory::findOrFail($id);
        $category->update(['is_active' => ! $category->is_active]);
        \App\Models\AuditLog::record('complaint-category-toggled', auth()->id(), $category, ['is_active' => $category->is_active]);
    }

    public function with(): array
    {
        return ['categories' => ComplaintCategory::orderBy('name')->get()];
    }
}; ?>

<div>
    <x-slot name="header">
        <h2 class="font-semibold text-xl text-gray-800 leading-tight">Complaint Categories</h2>
    </x-slot>

    <div class="py-8 max-w-2xl mx-auto sm:px-6 lg:px-8 space-y-6">
        <div class="bg-white rounded-lg shadow p-6">
            <h3 class="font-semibold text-gray-900 mb-4">Add Category</h3>
            <form wire:submit="addCategory" class="flex gap-3 items-end">
                <div class="flex-1">
                    <x-input-label for="newName" value="Name" />
                    <x-text-input wire:model="newName" id="newName" class="mt-1 w-full" />
                    <x-input-error :messages="$errors->get('newName')" class="mt-2" />
                </div>
                <label class="flex items-center gap-2 text-sm pb-2">
                    <input type="checkbox" wire:model="newIsChildSafety"> Child-safety category
                </label>
                <x-primary-button>Add</x-primary-button>
            </form>
        </div>

        <div class="bg-white rounded-lg shadow p-6">
            <h3 class="font-semibold text-gray-900 mb-4">All Categories</h3>
            @foreach ($categories as $category)
                <div class="flex justify-between items-center py-2 border-b last:border-0 text-sm">
                    <span>
                        {{ $category->name }}
                        @if ($category->is_child_safety)
                            <span class="ml-2 text-xs px-1.5 py-0.5 bg-red-100 text-red-700 rounded">child safety</span>
                        @endif
                    </span>
                    <button wire:click="toggleActive({{ $category->id }})"
                        class="text-xs px-2 py-1 rounded {{ $category->is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500' }}">
                        {{ $category->is_active ? 'Active' : 'Inactive' }}
                    </button>
                </div>
            @endforeach
        </div>
    </div>
</div>
