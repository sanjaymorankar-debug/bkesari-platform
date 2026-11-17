'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '../lib/auth-context'
import { useT, type MessageKey } from '../lib/i18n'
import { KIcon, PIcon, type KIconName } from '../components/kicon'

const FEATURES: { icon: KIconName; title: MessageKey; text: MessageKey }[] = [
  { icon: 'ladwani', title: 'landing.treeTitle', text: 'landing.treeText' },
  { icon: 'search', title: 'landing.directoryTitle', text: 'landing.directoryText' },
  { icon: 'users', title: 'landing.communityTitle', text: 'landing.communityText' },
  { icon: 'calendar', title: 'landing.servicesTitle', text: 'landing.servicesText' },
]

const STEPS: { title: MessageKey; text: MessageKey }[] = [
  { title: 'landing.step1Title', text: 'landing.step1Text' },
  { title: 'landing.step2Title', text: 'landing.step2Text' },
  { title: 'landing.step3Title', text: 'landing.step3Text' },
  { title: 'landing.step4Title', text: 'landing.step4Text' },
]

const TRUST: MessageKey[] = ['landing.trust1', 'landing.trust2', 'landing.trust3', 'landing.trust4']

/**
 * A family tree drawn in shapes only (no words, so nothing to translate):
 * a couple joined by the marriage ring, one of them passed away (dashed),
 * their three children with the Karta ringed, and the next generation.
 * Decorative: the heading beside it says what LadWani is.
 */
function TreeArt() {
  const node = (x: number, y: number, variant = '', width = 110) => (
    <g key={`${x}-${y}`}>
      <rect className={`lw-art__node${variant}`} x={x} y={y} width={width} height="48" rx="12" />
      <circle className="lw-art__face" cx={x + 24} cy={y + 24} r="11" />
      <rect className="lw-art__text" x={x + 44} y={y + 15} width="50" height="7" rx="3.5" />
      <rect className="lw-art__text" x={x + 44} y={y + 27} width="32" height="7" rx="3.5" />
    </g>
  )
  return (
    <svg viewBox="0 0 520 330" aria-hidden="true" focusable="false" className="lw-art">
      <rect className="lw-art__bg" x="1" y="1" width="518" height="328" rx="24" />
      {/* Lines first, so the boxes sit on top of them. */}
      <path className="lw-art__line" d="M275 64v56M95 120h360M95 120v20M275 120v20M455 120v20M275 188v42M210 230h130M210 230v20M340 230v20M455 188v62" />
      {node(110, 40, ' lw-art__node--gone')}
      {node(330, 40)}
      <path className="lw-art__ring-line" d="M220 64h110" />
      <circle className="lw-art__ring" cx="275" cy="64" r="7" />
      {node(40, 140)}
      {node(220, 140, ' lw-art__node--karta')}
      {node(400, 140)}
      {node(160, 250, '', 100)}
      {node(290, 250, '', 100)}
      {node(405, 250, '', 100)}
    </svg>
  )
}

/** LadWani's front door at /ladwani/: what it is, how joining works, how data is kept, Join / Sign in. */
export default function LandingPage() {
  const t = useT()
  const { user, loading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!loading && user) router.replace('/dashboard')
  }, [loading, user, router])

  return (
    <main id="main" className="k-main lw-landing">
      <section className="k-hero" aria-labelledby="lw-hero-title">
        <div>
          <p className="k-eyebrow">
            <KIcon name="ladwani" />
            {t('landing.eyebrow')}
          </p>
          <h1 id="lw-hero-title">{t('landing.title')}</h1>
          <p className="k-hero__lead">{t('landing.lead')}</p>
          <div className="k-hero__actions">
            <Link href="/sign-up" className="k-btn">
              {t('landing.join')}
            </Link>
            <Link href="/sign-in" className="k-link-arrow">
              {t('landing.haveAccount')}
              <KIcon name="arrow-right" />
            </Link>
          </div>
          <p className="lw-lock-note">
            <KIcon name="lock" small />
            <span>{t('auth.separateAccount')}</span>
          </p>
        </div>
        <div className="k-hero__art">
          <TreeArt />
        </div>
      </section>

      <section className="k-section" aria-labelledby="lw-features">
        <div className="k-section-head">
          <h2 id="lw-features">{t('landing.featuresTitle')}</h2>
          <p>{t('landing.featuresLead')}</p>
        </div>
        <ul className="k-features">
          {FEATURES.map((f) => (
            <li key={f.title} className="k-feature">
              <PIcon name={f.icon} />
              <h3>{t(f.title)}</h3>
              <p>{t(f.text)}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="k-section" aria-labelledby="lw-steps">
        <div className="k-section-head">
          <h2 id="lw-steps">{t('landing.stepsTitle')}</h2>
          <p>{t('landing.stepsLead')}</p>
        </div>
        <ol className="k-steps">
          {STEPS.map((s) => (
            <li key={s.title}>
              <h3>{t(s.title)}</h3>
              <p>{t(s.text)}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="k-section lw-trust" aria-labelledby="lw-trust-title">
        <div className="lw-trust__head">
          <PIcon name="shield" size="lg" />
          <h2 id="lw-trust-title">{t('landing.trustTitle')}</h2>
        </div>
        <ul className="lw-checks">
          {TRUST.map((key) => (
            <li key={key}>
              <KIcon name="check" />
              <span>{t(key)}</span>
            </li>
          ))}
        </ul>
        <a href="/privacy" className="k-link-arrow">
          {t('landing.privacyLink')}
          <KIcon name="arrow-right" />
        </a>
      </section>

      <section className="k-cta" aria-labelledby="lw-cta-title">
        <div>
          <h2 id="lw-cta-title">{t('landing.ctaTitle')}</h2>
          <p>{t('landing.ctaText')}</p>
        </div>
        <Link href="/sign-up" className="k-btn">
          {t('landing.join')}
        </Link>
      </section>
    </main>
  )
}
