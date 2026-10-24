<?php

namespace App\Routing;

use Illuminate\Support\Facades\URL;
use Livewire\Features\SupportFileUploads\GenerateSignedUploadUrl;

/**
 * Livewire's signed upload (and preview) URLs, made to work under the path
 * this app is published under.
 *
 * Livewire signs the *relative* route URL and checks the signature against
 * the path of the request that comes back. Under the hub those are two
 * different paths: the relative URL carries the `/edu` prefix (the generator's
 * root is pinned to APP_URL), while the request arrives with the prefix
 * already stripped. Livewire then made the URL absolute by putting the root in
 * front of a path that already had the prefix, so the browser posted to
 * `/edu/edu/livewire/upload-file`, a 404, and even the right address would
 * have failed the signature check. Every file upload in the app, complaint
 * evidence among them, failed with "failed to upload".
 *
 * Here the URL is signed with the generator's root briefly released, so the
 * signature covers the path the app will actually be asked for, and only then
 * is it made absolute under APP_URL for the browser.
 *
 * Swapped in by AppServiceProvider only when APP_URL has a path.
 */
class BasePathSignedUploadUrl extends GenerateSignedUploadUrl
{
    public function signedRoute($name, $expiration, $parameters = [])
    {
        $generator = URL::getFacadeRoot();
        $publishedRoot = rtrim((string) config('app.url'), '/');

        $generator->forceRootUrl(null);

        try {
            $relative = $generator->temporarySignedRoute($name, $expiration, $parameters, false);
        } finally {
            $generator->forceRootUrl($publishedRoot);
        }

        return $generator->to($relative);
    }
}
