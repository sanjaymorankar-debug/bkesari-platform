<?php

use App\Models\ConsentRecord;
use App\Models\User;
use App\Services\ConsentService;
use App\Services\DevelopmentAccessService;
use Illuminate\Support\Facades\Auth;
use Livewire\Attributes\Layout;
use Livewire\Volt\Component;

/**
 * DPDP Act 2023 Section 9 consent screen, for guardians.
 *
 * Everything the growth, career and life-skills modules do is switched off
 * until a guardian turns it on here, per child and per purpose. The notice
 * text is shown in full at the point of decision rather than behind a link,
 * because DPDP requires the person consenting to have actually been told what
 * they are agreeing to.
 */
new #[Layout('layouts.app')] class extends Component
{
    public array $children = [];

    public ?int $selectedChildId = null;

    public array $consentStatus = [];

    public string $flash = '';

    public function mount(): void
    {
        $this->loadChildren();

        if ($this->children !== []) {
            $this->selectChild($this->children[0]['id']);
        }
    }

    private function loadChildren(): void
    {
        $ids = app(DevelopmentAccessService::class)->guardianChildIds(Auth::user());

        $this->children = User::whereIn('id', $ids)
            ->orderBy('name')
            ->get(['id', 'name'])
            ->map(fn (User $child): array => ['id' => $child->id, 'name' => $child->name])
            ->all();
    }

    public function selectChild(int $childId): void
    {
        abort_unless(
            app(ConsentService::class)->isVerifiedGuardian(Auth::user(), $childId),
            403,
            'You are not recorded as a verified guardian for this child.'
        );

        $this->selectedChildId = $childId;
        $this->consentStatus = app(ConsentService::class)->statusFor($childId);
    }

    public function grant(string $purpose): void
    {
        app(ConsentService::class)->grant(Auth::user(), $this->selectedChildId, $purpose);

        $this->consentStatus = app(ConsentService::class)->statusFor($this->selectedChildId);
        $this->flash = 'Consent recorded for "'.ConsentRecord::PURPOSES[$purpose]['label'].'".';
    }

    public function withdraw(string $purpose): void
    {
        app(ConsentService::class)->withdraw(Auth::user(), $this->selectedChildId, $purpose);

        $this->consentStatus = app(ConsentService::class)->statusFor($this->selectedChildId);
        $this->flash = 'Consent withdrawn. Nothing further will be collected for this purpose.';
    }

    public function with(): array
    {
        return [
            'selectedChildName' => collect($this->children)->firstWhere('id', $this->selectedChildId)['name'] ?? null,
        ];
    }
}; ?>

<div>
    <x-slot name="header">
        <h2 class="font-semibold text-xl text-gray-800 leading-tight">Consent &amp; Your Child's Data</h2>
    </x-slot>

    <div class="py-8 max-w-4xl mx-auto sm:px-6 lg:px-8 space-y-6">

        @if ($flash)
            <div role="status" aria-live="polite" class="bg-green-50 border border-green-200 text-green-800 rounded-lg p-4 text-sm">{{ $flash }}</div>
        @endif

        <div class="bg-white rounded-lg shadow p-6">
            <h3 class="font-semibold text-gray-900 mb-2">Your decision, and you can change it any time</h3>
            <p class="text-sm text-gray-600">
                Your child is a minor, so under India's Data Protection Act (DPDP 2023, Section 9) the school
                cannot collect this information without your agreement. Nothing below is collected until you
                turn it on, and turning it off stops further collection immediately — you don't have to give a reason.
            </p>
        </div>

        @if ($children === [])
            <div class="bg-white rounded-lg shadow p-6">
                <p class="text-sm text-gray-500">
                    No child is linked to your account yet. Once a school verifies your link to your child,
                    you'll be able to manage their consent here.
                </p>
            </div>
        @else
            @if (count($children) > 1)
                <div class="bg-white rounded-lg shadow p-4 flex flex-wrap gap-2">
                    @foreach ($children as $child)
                        <button wire:click="selectChild({{ $child['id'] }})"
                            class="px-3 py-1.5 rounded text-sm {{ $selectedChildId === $child['id'] ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200' }}">
                            {{ $child['name'] }}
                        </button>
                    @endforeach
                </div>
            @endif

            <div class="space-y-4">
                @foreach ($consentStatus as $purpose => $item)
                    <div class="bg-white rounded-lg shadow p-6">
                        <div class="flex items-start justify-between gap-4">
                            <div class="flex-1">
                                <div class="flex items-center gap-2 mb-2">
                                    <h4 class="font-semibold text-gray-900">{{ $item['label'] }}</h4>
                                    @if ($item['granted'])
                                        <span class="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-800">On</span>
                                    @else
                                        <span class="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">Off</span>
                                    @endif
                                </div>
                                <p class="text-sm text-gray-600 leading-relaxed">{{ $item['notice'] }}</p>
                                @if ($item['granted'] && $item['granted_at'])
                                    <p class="text-xs text-gray-400 mt-2">
                                        You agreed to this on {{ $item['granted_at']->format('j F Y') }}.
                                    </p>
                                @endif
                            </div>
                            <div class="shrink-0">
                                @if ($item['granted'])
                                    <button wire:click="withdraw('{{ $purpose }}')"
                                        class="px-3 py-1.5 text-sm rounded border border-gray-300 text-gray-700 hover:bg-gray-50">
                                        Turn off
                                    </button>
                                @else
                                    <button wire:click="grant('{{ $purpose }}')"
                                        class="px-3 py-1.5 text-sm rounded bg-indigo-600 text-white hover:bg-indigo-700">
                                        I agree
                                    </button>
                                @endif
                            </div>
                        </div>
                    </div>
                @endforeach
            </div>

            @if ($selectedChildName)
                <div class="text-center">
                    <a href="{{ route('growth.show', $selectedChildId) }}" wire:navigate
                        class="text-sm text-indigo-600 hover:underline">
                        View {{ $selectedChildName }}'s growth &rarr;
                    </a>
                </div>
            @endif
        @endif
    </div>
</div>
