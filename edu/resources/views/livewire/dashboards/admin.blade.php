<?php

use App\Models\Complaint;
use App\Models\IdentityAccessLog;
use App\Models\School;
use App\Models\User;
use Livewire\Attributes\Layout;
use Livewire\Volt\Component;

new #[Layout('layouts.app')] class extends Component
{
    public function with(): array
    {
        return [
            'stats' => [
                'users' => User::count(),
                'schools' => School::count(),
                'complaints' => Complaint::count(),
                'identity_accesses' => IdentityAccessLog::count(),
            ],
        ];
    }

    public function rendering($view): void
    {
        $view->title(__('System administration'));
    }
}; ?>

<div>
    <x-slot name="header">
        <p class="k-eyebrow"><x-k-icon name="shield" /> {{ __('System Admin') }}</p>
        <h1>{{ __('System administration') }}</h1>
        <p class="edu-page-head__lead">{{ __('How the platform is set up, and the logs that show who did what.') }}</p>
    </x-slot>

    <div class="edu-dash">
        <ul class="k-stats edu-stats" role="list" aria-label="{{ __('At a glance') }}">
            <li class="k-stat">
                <span class="k-stat__value">{{ \Illuminate\Support\Number::format($stats['users'], locale: 'en_IN') }}</span>
                <span class="k-stat__label">{{ __('Users') }}</span>
            </li>
            <li class="k-stat">
                <span class="k-stat__value">{{ \Illuminate\Support\Number::format($stats['schools'], locale: 'en_IN') }}</span>
                <span class="k-stat__label">{{ __('Schools') }}</span>
            </li>
            <li class="k-stat">
                <span class="k-stat__value">{{ \Illuminate\Support\Number::format($stats['complaints'], locale: 'en_IN') }}</span>
                <span class="k-stat__label">{{ __('Complaints') }}</span>
            </li>
            <li class="k-stat">
                <span class="k-stat__value">{{ \Illuminate\Support\Number::format($stats['identity_accesses'], locale: 'en_IN') }}</span>
                <span class="k-stat__label">{{ __('Identity accesses logged') }}</span>
                <span class="k-stat__source">{{ __('Every time an officer looks behind an anonymous reference') }}</span>
            </li>
        </ul>

        <section aria-labelledby="panel-title">
            <h2 id="panel-title" class="edu-section-title">{{ __('Admin Panel') }}</h2>
            <ul class="edu-tiles" role="list">
                @foreach ([
                    ['admin.rating-weights', 'School Rating Weights', 'Configure School Quality Index dimension weights', 'grid'],
                    ['admin.categories', 'Complaint Categories', 'Add, rename, or retire complaint categories', 'book'],
                    ['admin.audit-log', 'Audit Log', 'Review system actions and identity-access log', 'clock'],
                    ['admin.fraud-flags', 'Fraud Flags', 'Review coordinated-review / spike signals', 'alert'],
                    ['admin.roles', 'Roles & Permissions', 'Manage role permissions and user role assignments', 'users'],
                    ['admin.moderation', 'Moderation Settings', 'Configure coordinated-review detection thresholds', 'shield'],
                ] as [$route, $title, $text, $icon])
                    <li class="k-card edu-tile">
                        <span class="k-picon k-picon--sm"><x-k-icon :name="$icon" /></span>
                        <div class="min-w-0">
                            <a href="{{ route($route) }}" wire:navigate class="edu-stretch edu-tile__title">{{ __($title) }}</a>
                            <p>{{ __($text) }}</p>
                        </div>
                        <x-k-icon name="arrow-right" class="edu-tile__arrow" />
                    </li>
                @endforeach
            </ul>
        </section>

        <section aria-labelledby="queues-title">
            <h2 id="queues-title" class="edu-section-title">{{ __('Queues') }}</h2>
            <ul class="edu-tiles" role="list">
                <li class="k-card edu-tile">
                    <span class="k-picon k-picon--sm"><x-k-icon name="check" /></span>
                    <div class="min-w-0">
                        <a href="{{ route('verification.queue') }}" wire:navigate class="edu-stretch edu-tile__title">{{ __('Verification') }}</a>
                        <p>{{ __('Schools and claims waiting for an officer to confirm them.') }}</p>
                    </div>
                    <x-k-icon name="arrow-right" class="edu-tile__arrow" />
                </li>
                <li class="k-card edu-tile">
                    <span class="k-picon k-picon--sm"><x-k-icon name="lock" /></span>
                    <div class="min-w-0">
                        <a href="{{ route('privacy.queue') }}" wire:navigate class="edu-stretch edu-tile__title">{{ __('Data requests') }}</a>
                        <p>{{ __('Requests to see, correct or erase personal data (DPDP Act 2023).') }}</p>
                    </div>
                    <x-k-icon name="arrow-right" class="edu-tile__arrow" />
                </li>
            </ul>
        </section>
    </div>
</div>
