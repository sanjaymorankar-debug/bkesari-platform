'use client'

import { useCallback, useEffect, useId, useState, type FormEvent, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { api } from '../../../lib/api-client'
import { errorText } from '../../../lib/errors'
import { useAuth } from '../../../lib/auth-context'
import { useT } from '../../../lib/i18n'
import { toast } from '../../../lib/kesari'
import { INCOME_RANGES, incomeLabel } from '../../../lib/labels'
import { RequireAuth, TopBar, Shell, ErrorBanner, ErrorState, ListSkeleton, PageHeader } from '../../../components/ui'

interface LookupOption {
  id: string
  label: string
}

interface OwnProfile {
  currentCity?: string | null
  currentState?: string | null
  nativeVillage?: string | null
  nativeDistrict?: string | null
  nativeState?: string | null
  educationLevelId?: string | null
  occupationId?: string | null
  employerOrBusiness?: string | null
  incomeRange?: string | null
  bio?: string | null
  skills?: { id: string; label: string }[]
}

const EMPTY = {
  currentCity: '',
  currentState: '',
  nativeVillage: '',
  nativeDistrict: '',
  nativeState: '',
  educationLevelId: '',
  occupationId: '',
  employerOrBusiness: '',
  incomeRange: '',
  bio: '',
}
type Form = typeof EMPTY

interface Lookups {
  education: LookupOption[]
  occupations: LookupOption[]
  skills: LookupOption[]
}

export default function EditProfilePage() {
  return (
    <RequireAuth>
      <TopBar />
      <Shell>
        <EditProfile />
      </Shell>
    </RequireAuth>
  )
}

/** A labelled text input or select, Kesari-styled, sized by its column (never a fixed text width). */
function Field({ label, hint, children }: { label: string; hint?: string; children: (id: string, describedBy?: string) => ReactNode }) {
  const id = useId()
  return (
    <div className="k-field">
      <label className="k-label" htmlFor={id}>
        {label}
      </label>
      {hint && (
        <span className="k-hint" id={`${id}-hint`}>
          {hint}
        </span>
      )}
      {children(id, hint ? `${id}-hint` : undefined)}
    </div>
  )
}

function Section({ title, lead, children }: { title: string; lead?: string; children: ReactNode }) {
  return (
    <fieldset className="lw-form-section">
      <legend className="lw-form-section__title">{title}</legend>
      {lead && <p className="k-muted lw-form-section__lead">{lead}</p>}
      {children}
    </fieldset>
  )
}

/**
 * The signed-in person's own profile. The form appears once their profile has
 * loaded, so nothing is ever saved over it from an empty form.
 */
function EditProfile() {
  const t = useT()
  const router = useRouter()
  const { user } = useAuth()
  const [form, setForm] = useState<Form | null>(null)
  const [skillIds, setSkillIds] = useState<string[]>([])
  const [lookups, setLookups] = useState<Lookups>({ education: [], occupations: [], skills: [] })
  // The raw failure: put in words when shown, so it follows the language.
  const [loadError, setLoadError] = useState<unknown>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    setLoadError(null)
    setForm(null)
    // The lists are optional extras: a field whose list did not load just offers fewer choices.
    Promise.all([
      api.get<LookupOption[]>('/config/education-levels').catch(() => []),
      api.get<LookupOption[]>('/config/occupations').catch(() => []),
      api.get<LookupOption[]>('/config/skills').catch(() => []),
    ]).then(([education, occupations, skills]) => setLookups({ education, occupations, skills }))
    api
      .get<OwnProfile>('/members/me')
      .then((profile) => {
        setForm({
          currentCity: profile.currentCity ?? '',
          currentState: profile.currentState ?? '',
          nativeVillage: profile.nativeVillage ?? '',
          nativeDistrict: profile.nativeDistrict ?? '',
          nativeState: profile.nativeState ?? '',
          educationLevelId: profile.educationLevelId ?? '',
          occupationId: profile.occupationId ?? '',
          employerOrBusiness: profile.employerOrBusiness ?? '',
          incomeRange: profile.incomeRange ?? '',
          bio: profile.bio ?? '',
        })
        setSkillIds(profile.skills?.map((s) => s.id) ?? [])
      })
      .catch((err) => setLoadError(err ?? new Error()))
  }, [])
  useEffect(load, [load])

  const profileHref = user?.memberId ? `/members/${user.memberId}` : '/dashboard'

  if (loadError != null) {
    return (
      <>
        <PageHeader title={t('editProfile.title')} />
        <ErrorState message={errorText(loadError, t)} onRetry={load} />
      </>
    )
  }
  if (!form) {
    return (
      <>
        <PageHeader title={t('editProfile.title')} lead={t('editProfile.lead')} />
        <ListSkeleton rows={3} />
      </>
    )
  }

  const set = (key: keyof Form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value })

  function toggleSkill(id: string) {
    setSkillIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]))
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!form) return
    setError(null)
    setSaving(true)
    try {
      await api.patch('/members/me', {
        currentCity: form.currentCity || undefined,
        currentState: form.currentState || undefined,
        nativeVillage: form.nativeVillage || undefined,
        nativeDistrict: form.nativeDistrict || undefined,
        nativeState: form.nativeState || undefined,
        educationLevelId: form.educationLevelId || undefined,
        occupationId: form.occupationId || undefined,
        employerOrBusiness: form.employerOrBusiness || undefined,
        incomeRange: form.incomeRange || undefined,
        bio: form.bio || undefined,
        skillIds,
      })
      toast(t('editProfile.saved'), 'success')
      router.push(profileHref)
    } catch (err) {
      setError(errorText(err, t))
      setSaving(false)
    }
  }

  return (
    <>
      <PageHeader title={t('editProfile.title')} lead={t('editProfile.lead')} crumbs={[{ href: profileHref, label: t('nav.profile') }, { label: t('editProfile.title') }]} />
      <form onSubmit={save} className="lw-form" noValidate>
        <ErrorBanner message={error} />

        <Section title={t('editProfile.livesTitle')}>
          <div className="lw-two">
            <Field label={t('field.city')}>{(id) => <input id={id} className="k-input" autoComplete="address-level2" value={form.currentCity} onChange={set('currentCity')} />}</Field>
            <Field label={t('field.state')}>{(id) => <input id={id} className="k-input" autoComplete="address-level1" value={form.currentState} onChange={set('currentState')} />}</Field>
          </div>
        </Section>

        <Section title={t('editProfile.nativeTitle')} lead={t('editProfile.nativeLead')}>
          <Field label={t('field.village')}>{(id) => <input id={id} className="k-input" value={form.nativeVillage} onChange={set('nativeVillage')} />}</Field>
          <div className="lw-two">
            <Field label={t('field.district')}>{(id) => <input id={id} className="k-input" value={form.nativeDistrict} onChange={set('nativeDistrict')} />}</Field>
            <Field label={t('field.state')}>{(id) => <input id={id} className="k-input" value={form.nativeState} onChange={set('nativeState')} />}</Field>
          </div>
        </Section>

        <Section title={t('editProfile.workTitle')}>
          <div className="lw-two">
            <Field label={t('field.education')}>
              {(id) => (
                <select id={id} className="k-select" value={form.educationLevelId} onChange={set('educationLevelId')}>
                  <option value="">{t('common.choose')}</option>
                  {lookups.education.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label={t('field.occupation')}>
              {(id) => (
                <select id={id} className="k-select" value={form.occupationId} onChange={set('occupationId')}>
                  <option value="">{t('common.choose')}</option>
                  {lookups.occupations.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>
          <Field label={t('field.employer')} hint={t('field.employerHint')}>
            {(id, describedBy) => <input id={id} className="k-input" aria-describedby={describedBy} value={form.employerOrBusiness} onChange={set('employerOrBusiness')} />}
          </Field>
          <Field label={t('field.income')} hint={t('field.incomeHint')}>
            {(id, describedBy) => (
              <select id={id} className="k-select" aria-describedby={describedBy} value={form.incomeRange} onChange={set('incomeRange')}>
                <option value="">{t('common.choose')}</option>
                {INCOME_RANGES.map((r) => (
                  <option key={r} value={r}>
                    {incomeLabel(t, r)}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </Section>

        <Section title={t('editProfile.aboutTitle')}>
          <Field label={t('field.bio')} hint={t('field.bioHint')}>
            {(id, describedBy) => <textarea id={id} className="k-textarea" rows={4} aria-describedby={describedBy} value={form.bio} onChange={set('bio')} />}
          </Field>
          {lookups.skills.length > 0 && (
            <fieldset className="lw-fieldset k-field">
              <legend className="k-label">{t('profile.skills')}</legend>
              <span className="k-hint">{t('editProfile.skillsHint')}</span>
              <ul className="lw-skill-picks">
                {lookups.skills.map((s) => (
                  <li key={s.id}>
                    <label className="lw-skill-pick">
                      <input type="checkbox" checked={skillIds.includes(s.id)} onChange={() => toggleSkill(s.id)} />
                      <span>{s.label}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          )}
        </Section>

        <div className="lw-form__actions">
          <Link href={profileHref} className="k-btn k-btn--secondary">
            {t('common.cancel')}
          </Link>
          <button className="k-btn" type="submit" aria-busy={saving || undefined} disabled={saving}>
            {t('editProfile.save')}
          </button>
        </div>
      </form>
    </>
  )
}
