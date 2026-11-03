'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '../lib/auth-context'
import { useT, type MessageKey } from '../lib/i18n'
import { Icon, type IconName } from '../components/icons'

const FEATURES: { icon: IconName; title: MessageKey; text: MessageKey }[] = [
  { icon: 'tree', title: 'landing.treeTitle', text: 'landing.treeText' },
  { icon: 'search', title: 'landing.directoryTitle', text: 'landing.directoryText' },
  { icon: 'feed', title: 'landing.communityTitle', text: 'landing.communityText' },
  { icon: 'services', title: 'landing.servicesTitle', text: 'landing.servicesText' },
]

/** LadWani's front door at /ladwani/: what it is, how data is kept, Join / Sign in. */
export default function LandingPage() {
  const t = useT()
  const { user, loading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!loading && user) router.replace('/dashboard')
  }, [loading, user, router])

  return (
    <main id="main" className="k-main lw-landing">
      <section className="lw-hero" aria-labelledby="lw-hero-title">
        <p className="lw-wordmark">{t('app.name')}</p>
        <h1 id="lw-hero-title">{t('landing.title')}</h1>
        <p className="k-lead">{t('landing.lead')}</p>
        <div className="k-row">
          <Link href="/sign-up" className="k-btn">
            {t('landing.join')}
          </Link>
          <Link href="/sign-in" className="k-btn k-btn--secondary">
            {t('landing.signIn')}
          </Link>
        </div>
        <p className="lw-separate">{t('auth.separateAccount')}</p>
      </section>

      <section className="k-section" aria-labelledby="lw-features">
        <h2 id="lw-features">{t('landing.featuresTitle')}</h2>
        <ul className="k-grid lw-plain-list">
          {FEATURES.map((f) => (
            <li key={f.title} className="k-tile">
              <div className="k-tile__head">
                <span className="k-tile__icon">
                  <Icon name={f.icon} />
                </span>
                <h3 className="k-tile__name">{t(f.title)}</h3>
              </div>
              <p className="k-tile__text">{t(f.text)}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="k-section k-card lw-trust" aria-labelledby="lw-trust-title">
        <div className="k-tile__head">
          <span className="k-tile__icon">
            <Icon name="shield" />
          </span>
          <h2 id="lw-trust-title" className="lw-h3">
            {t('landing.trustTitle')}
          </h2>
        </div>
        <ul className="lw-checks">
          <li>{t('landing.trust1')}</li>
          <li>{t('landing.trust2')}</li>
          <li>{t('landing.trust3')}</li>
          <li>{t('landing.trust4')}</li>
        </ul>
        <p>
          <a href="/privacy">{t('landing.privacyLink')}</a>
        </p>
      </section>
    </main>
  )
}
