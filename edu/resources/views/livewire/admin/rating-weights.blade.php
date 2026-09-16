<?php

use App\Models\SchoolRatingComponent;
use App\Models\TeacherRatingComponent;
use Livewire\Attributes\Layout;
use Livewire\Volt\Component;

new #[Layout('layouts.app')] class extends Component
{
    public array $schoolWeights = [];
    public array $teacherWeights = [];

    public function mount(): void
    {
        $this->loadWeights();
    }

    private function loadWeights(): void
    {
        $this->schoolWeights = SchoolRatingComponent::orderBy('key')->get()
            ->mapWithKeys(fn ($c) => [$c->id => ['label' => $c->label, 'weight' => (float) $c->weight, 'is_active' => $c->is_active]])
            ->toArray();

        $this->teacherWeights = TeacherRatingComponent::orderBy('key')->get()
            ->mapWithKeys(fn ($c) => [$c->id => ['label' => $c->label, 'weight' => (float) $c->weight, 'is_active' => $c->is_active]])
            ->toArray();
    }

    public function saveSchoolWeights(): void
    {
        foreach ($this->schoolWeights as $id => $data) {
            SchoolRatingComponent::whereKey($id)->update([
                'weight' => $data['weight'],
                'is_active' => (bool) $data['is_active'],
            ]);
        }

        \App\Models\AuditLog::record('rating-weights-updated', auth()->id(), metadata: ['type' => 'school']);
        session()->flash('school-saved', true);
    }

    public function saveTeacherWeights(): void
    {
        foreach ($this->teacherWeights as $id => $data) {
            TeacherRatingComponent::whereKey($id)->update([
                'weight' => $data['weight'],
                'is_active' => (bool) $data['is_active'],
            ]);
        }

        \App\Models\AuditLog::record('rating-weights-updated', auth()->id(), metadata: ['type' => 'teacher']);
        session()->flash('teacher-saved', true);
    }
}; ?>

<div>
    <x-slot name="header">
        <h2 class="font-semibold text-xl text-gray-800 leading-tight">Rating Weights</h2>
    </x-slot>

    <div class="py-8 max-w-3xl mx-auto sm:px-6 lg:px-8 space-y-6">
        <div class="bg-white rounded-lg shadow p-6">
            <h3 class="font-semibold text-gray-900 mb-1">School Quality Index Weights</h3>
            <p class="text-xs text-gray-500 mb-4">Weights don't need to sum to 100 — they're normalized automatically at calculation time.</p>

            @if (session('school-saved'))
                <div class="bg-green-50 text-green-800 text-sm rounded p-2 mb-4">Saved. New weights apply the next time a school's SQI is recalculated.</div>
            @endif

            @foreach ($schoolWeights as $id => $data)
                <div class="flex items-center gap-4 py-2 border-b last:border-0">
                    <label class="flex items-center gap-2 flex-1 text-sm">
                        <input type="checkbox" wire:model="schoolWeights.{{ $id }}.is_active">
                        {{ $data['label'] }}
                    </label>
                    <input type="number" step="0.01" min="0" wire:model="schoolWeights.{{ $id }}.weight" class="w-24 border-gray-300 rounded-md shadow-sm text-sm">
                </div>
            @endforeach

            <x-primary-button class="mt-4" wire:click="saveSchoolWeights">Save School Weights</x-primary-button>
        </div>

        <div class="bg-white rounded-lg shadow p-6">
            <h3 class="font-semibold text-gray-900 mb-1">Teacher Effectiveness Index Weights</h3>
            <p class="text-xs text-gray-500 mb-4">Same normalization rule applies.</p>

            @if (session('teacher-saved'))
                <div class="bg-green-50 text-green-800 text-sm rounded p-2 mb-4">Saved. New weights apply the next time a teacher's TEI is recalculated.</div>
            @endif

            @foreach ($teacherWeights as $id => $data)
                <div class="flex items-center gap-4 py-2 border-b last:border-0">
                    <label class="flex items-center gap-2 flex-1 text-sm">
                        <input type="checkbox" wire:model="teacherWeights.{{ $id }}.is_active">
                        {{ $data['label'] }}
                    </label>
                    <input type="number" step="0.01" min="0" wire:model="teacherWeights.{{ $id }}.weight" class="w-24 border-gray-300 rounded-md shadow-sm text-sm">
                </div>
            @endforeach

            <x-primary-button class="mt-4" wire:click="saveTeacherWeights">Save Teacher Weights</x-primary-button>
        </div>
    </div>
</div>
