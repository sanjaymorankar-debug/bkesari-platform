'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '../../../lib/api-client'
import { errorMessage, useAuth } from '../../../lib/auth-context'
import { RequireAuth, TopBar, Shell, ErrorBanner } from '../../../components/ui'

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

const INCOME_RANGES = [
  { value: '', label: 'Prefer not to say' },
  { value: 'BELOW_2L', label: 'Below ₹2 lakh' },
  { value: 'L2_5L', label: '₹2–5 lakh' },
  { value: 'L5_10L', label: '₹5–10 lakh' },
  { value: 'L10_25L', label: '₹10–25 lakh' },
  { value: 'ABOVE_25L', label: 'Above ₹25 lakh' },
  { value: 'NOT_DISCLOSED', label: 'Not disclosed' },
]

export default function EditProfilePage() {
  const router = useRouter()
  const { user } = useAuth()
  const [form, setForm] = useState({
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
  })
  const [skillIds, setSkillIds] = useState<string[]>([])
  const [educationLevels, setEducationLevels] = useState<LookupOption[]>([])
  const [occupations, setOccupations] = useState<LookupOption[]>([])
  const [skillOptions, setSkillOptions] = useState<LookupOption[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.get<LookupOption[]>('/config/education-levels').then(setEducationLevels).catch(() => undefined)
    api.get<LookupOption[]>('/config/occupations').then(setOccupations).catch(() => undefined)
    api.get<(LookupOption & { code: string })[]>('/config/skills').then(setSkillOptions).catch(() => undefined)
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
      .catch((err) => setError(errorMessage(err)))
  }, [])

  function toggleSkill(id: string) {
    setSkillIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]))
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
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
      setNotice('Profile updated.')
      if (user?.memberId) router.push(`/members/${user.memberId}`)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <RequireAuth>
      <TopBar />
      <Shell>
        <h1>Edit my profile</h1>
        <ErrorBanner message={error} />
        {notice && <div className="card" style={{ borderColor: 'var(--success)', color: 'var(--success)', marginBottom: 16 }}>{notice}</div>}

        <form onSubmit={save} className="card stack" style={{ marginTop: 16 }}>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <div className="field" style={{ flex: 1, minWidth: 160 }}>
              <label htmlFor="currentCity">Current city</label>
              <input id="currentCity" value={form.currentCity} onChange={(e) => setForm({ ...form, currentCity: e.target.value })} />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 160 }}>
              <label htmlFor="currentState">Current state</label>
              <input id="currentState" value={form.currentState} onChange={(e) => setForm({ ...form, currentState: e.target.value })} />
            </div>
          </div>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <div className="field" style={{ flex: 1, minWidth: 160 }}>
              <label htmlFor="nativeVillage">Native village</label>
              <input id="nativeVillage" value={form.nativeVillage} onChange={(e) => setForm({ ...form, nativeVillage: e.target.value })} />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 160 }}>
              <label htmlFor="nativeDistrict">Native district</label>
              <input id="nativeDistrict" value={form.nativeDistrict} onChange={(e) => setForm({ ...form, nativeDistrict: e.target.value })} />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 160 }}>
              <label htmlFor="nativeState">Native state</label>
              <input id="nativeState" value={form.nativeState} onChange={(e) => setForm({ ...form, nativeState: e.target.value })} />
            </div>
          </div>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <div className="field" style={{ flex: 1, minWidth: 160 }}>
              <label htmlFor="educationLevelId">Education</label>
              <select id="educationLevelId" value={form.educationLevelId} onChange={(e) => setForm({ ...form, educationLevelId: e.target.value })}>
                <option value="">Prefer not to say</option>
                {educationLevels.map((el) => (
                  <option key={el.id} value={el.id}>{el.label}</option>
                ))}
              </select>
            </div>
            <div className="field" style={{ flex: 1, minWidth: 160 }}>
              <label htmlFor="occupationId">Occupation</label>
              <select id="occupationId" value={form.occupationId} onChange={(e) => setForm({ ...form, occupationId: e.target.value })}>
                <option value="">Prefer not to say</option>
                {occupations.map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="field">
            <label htmlFor="employerOrBusiness">Employer / business name</label>
            <input
              id="employerOrBusiness"
              value={form.employerOrBusiness}
              onChange={(e) => setForm({ ...form, employerOrBusiness: e.target.value })}
              placeholder="e.g. Infosys, or Deshmukh Traders"
            />
          </div>
          <div className="field">
            <label htmlFor="incomeRange">Income range</label>
            <select id="incomeRange" value={form.incomeRange} onChange={(e) => setForm({ ...form, incomeRange: e.target.value })}>
              {INCOME_RANGES.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
            <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>Only visible to you by default.</p>
          </div>
          <div className="field">
            <label htmlFor="bio">About</label>
            <textarea id="bio" rows={4} value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} />
          </div>
          <div className="field">
            <label>Skills</label>
            <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
              {skillOptions.map((s) => (
                <label key={s.id} className="row" style={{ gap: 6, alignItems: 'center' }}>
                  <input type="checkbox" checked={skillIds.includes(s.id)} onChange={() => toggleSkill(s.id)} />
                  {s.label}
                </label>
              ))}
            </div>
          </div>
          <button className="btn btn-primary" type="submit" disabled={saving} style={{ alignSelf: 'flex-start' }}>
            {saving ? 'Saving…' : 'Save profile'}
          </button>
        </form>
      </Shell>
    </RequireAuth>
  )
}
