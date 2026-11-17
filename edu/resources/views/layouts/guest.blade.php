<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}" data-project="education" data-locale="{{ app()->getLocale() }}">
    <head>
        @include('layouts.partials.head')
    </head>
    <body class="font-sans antialiased">
        <a href="#main-content" class="k-skip">{{ __('Skip to main content') }}</a>

        <div data-bkesari-menu data-me-url="{{ url('/shell/me') }}" class="contents"></div>

        <div id="main" class="contents"></div>
        <main id="main-content" class="k-main edu-auth-main" tabindex="-1">
            <div class="edu-auth-grid">
                <div class="k-card edu-auth">
                    <a href="{{ route('home') }}" wire:navigate class="edu-project">
                        <span class="k-picon k-picon--sm"><x-k-icon name="education" /></span>
                        <span>{{ __('Education') }}</span>
                    </a>

                    {{ $slot }}

                    <p class="edu-auth__separate">
                        <x-k-icon name="lock" class="k-icon--sm" />
                        <span>
                            <strong>{{ __('This is a separate account for Education.') }}</strong>
                            {{ __('Signing in here does not sign you in to other bkesari projects, and their accounts do not work here.') }}
                        </span>
                    </p>
                </div>

                {{-- What an account is for, beside the form on wide screens.
                     On a phone the form is the whole job, so this waits. --}}
                <aside class="edu-auth-aside hidden lg:block" aria-labelledby="edu-auth-aside-title">
                    <h2 id="edu-auth-aside-title">{{ __('Know your school. Be heard, safely.') }}</h2>
                    <ul class="edu-points" role="list">
                        <li>
                            <span class="k-picon k-picon--sm"><x-k-icon name="school" /></span>
                            <div>
                                <h3>{{ __('Compare schools honestly') }}</h3>
                                <p>{{ __('Fees year by year, the facilities a school claims next to what families report, and how it has changed over time.') }}</p>
                            </div>
                        </li>
                        <li>
                            <span class="k-picon k-picon--sm"><x-k-icon name="shield" /></span>
                            <div>
                                <h3>{{ __('Raise a concern safely') }}</h3>
                                <p>{{ __('Complaints are faceless: the school sees that a verified parent or student raised it, never who. Follow it until it is actually resolved.') }}</p>
                            </div>
                        </li>
                        <li>
                            <span class="k-picon k-picon--sm"><x-k-icon name="sprout" /></span>
                            <div>
                                <h3>{{ __('Follow your child’s growth') }}</h3>
                                <p>{{ __('With your consent, teachers and family keep a shared record of what is going well and what comes next. No ranks, no labels.') }}</p>
                            </div>
                        </li>
                    </ul>
                </aside>
            </div>
        </main>
    </body>
</html>
