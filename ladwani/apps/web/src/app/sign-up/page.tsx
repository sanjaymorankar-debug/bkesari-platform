'use client'

import { useCallback, useEffect, useId, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth, errorMessage } from '../../lib/auth-context'
import { api, ApiError } from '../../lib/api-client'
import { useT, type MessageKey } from '../../lib/i18n'
import { clearProgress, loadProgress, saveProgress, type SignUpProgress } from '../../lib/sign-up-progress'
import { ID_PROOF_TYPES, MAX_ID_PROOF_BYTES, uploadDocument } from '../../lib/upload'
import { AuthFrame, DevCode, OtpInput, TextField, cleanMobile } from '../../components/auth-ui'
import { ErrorBanner, ErrorState, ListSkeleton } from '../../components/ui'
import { Icon } from '../../components/icons'
import places from '../../data/places.json'

type Step = SignUpProgress['step']
const STEPS: MessageKey[] = ['signUp.step1', 'signUp.step2', 'signUp.step3', 'signUp.step4']

export default function SignUpPage() {
  const t = useT()
  const router = useRouter()
  const { user, loading } = useAuth()
  // Step 1 is in the page as built, so a first visit paints the form at once
  // and nothing moves; saved progress (another step, typed values) replaces it
  // once read, remounting the step so its fields pick the values up.
  const [progress, setProgress] = useState<SignUpProgress>({ step: 1 })
  const [restored, setRestored] = useState(false)

  useEffect(() => {
    let saved = loadProgress()
    try {
      const asked = Number(new URLSearchParams(window.location.search).get('step'))
      if ([2, 3, 4].includes(asked)) saved = { ...(saved ?? {}), step: asked as Step }
    } catch {
      // no query
    }
    if (saved) setProgress(saved)
    setRestored(true)
  }, [])

  const update = useCallback((patch: Partial<SignUpProgress>) => {
    setProgress((prev) => {
      const next = { ...prev, ...patch } as SignUpProgress
      saveProgress(next)
      return next
    })
  }, [])

  // Steps 2-4 save to the account, so they need its session: without one (or
  // until it is known), step 1, which signs in again.
  const step: Step = user && !loading ? (progress.step === 1 ? 2 : progress.step) : 1

  return (
    <AuthFrame
      title={t('signUp.title')}
      lead={t('signUp.lead')}
      footer={
        <p>
          {t('signUp.haveAccount')} <Link href="/sign-in">{t('signUp.signIn')}</Link>
        </p>
      }
    >
      <p className="k-stepper__count" aria-live="polite">
        {t('signUp.stepCount', { n: step, total: STEPS.length })}: {t(STEPS[step - 1])}
      </p>
      <ol className="k-stepper">
        {STEPS.map((key, i) => (
          <li key={key} aria-current={i + 1 === step ? 'step' : undefined} data-done={i + 1 < step ? '' : undefined}>
            {t(key)}
          </li>
        ))}
      </ol>

      {step === 1 && <StepMobile key={restored ? 'restored' : 'built'} progress={progress} onDone={(patch) => update({ ...patch, step: 2 })} />}
      {step === 2 && <StepProfile progress={progress} onDone={(patch) => update({ ...patch, step: 3 })} />}
      {step === 3 && <StepPlace progress={progress} onBack={() => update({ step: 2 })} onDone={(patch) => update({ ...patch, step: 4 })} />}
      {step === 4 && (
        <StepIdProof
          progress={progress}
          onBack={() => update({ step: 3 })}
          onDone={() => {
            clearProgress()
            router.push('/pending')
          }}
        />
      )}
    </AuthFrame>
  )
}

interface StepProps {
  progress: SignUpProgress
  onDone: (patch: Partial<SignUpProgress>) => void
  onBack?: () => void
}

function StepButtons({ busy, onBack, label }: { busy: boolean; onBack?: () => void; label?: string }) {
  const t = useT()
  return (
    <div className="k-row k-row--between lw-steps">
      {onBack ? (
        <button type="button" className="k-btn k-btn--secondary" onClick={onBack} disabled={busy}>
          {t('common.back')}
        </button>
      ) : (
        <span />
      )}
      <button type="submit" className="k-btn" aria-busy={busy || undefined} disabled={busy}>
        {label ?? t('common.continue')}
      </button>
    </div>
  )
}

/** Step 1: name and mobile, then the code sent to it. Creates the account and signs it in. */
function StepMobile({ progress, onDone }: StepProps) {
  const t = useT()
  const { loginWithOtp } = useAuth()
  const [firstName, setFirstName] = useState(progress.firstName ?? '')
  const [lastName, setLastName] = useState(progress.lastName ?? '')
  const [mobile, setMobile] = useState(progress.mobile ?? '')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [sent, setSent] = useState<{ existing: boolean; devCode: string | null } | null>(null)
  const [otp, setOtp] = useState('')
  const [otpError, setOtpError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function sendCode(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const clean = cleanMobile(mobile)
    const next: Record<string, string> = {}
    if (firstName.trim().length < 2) next.firstName = t('validation.firstName')
    if (!lastName.trim()) next.lastName = t('validation.lastName')
    if (!clean) next.mobile = t('validation.mobile')
    setErrors(next)
    if (Object.keys(next).length) return
    setBusy(true)
    try {
      saveProgress({ ...progress, step: 1, firstName: firstName.trim(), lastName: lastName.trim(), mobile: clean })
      const reply = await api.postFull<{ userId: string }>('/auth/register', { firstName: firstName.trim(), lastName: lastName.trim(), mobile: clean })
      setSent({ existing: false, devCode: reply.devOtp ?? null })
      setMobile(clean)
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // Already registered (perhaps an earlier, unfinished sign-up): sign in with a code and carry on.
        try {
          const reply = await api.postFull<{ sent: boolean }>('/auth/otp/send', { mobile: clean })
          setSent({ existing: true, devCode: reply.devOtp ?? null })
          setMobile(clean)
        } catch (inner) {
          setError(errorMessage(inner))
        }
      } else {
        setError(errorMessage(err))
      }
    } finally {
      setBusy(false)
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault()
    if (!/^\d{6}$/.test(otp)) {
      setOtpError(t('validation.otp'))
      return
    }
    setOtpError(null)
    setBusy(true)
    try {
      await loginWithOtp(mobile, otp)
      onDone({ firstName: firstName.trim(), lastName: lastName.trim(), mobile })
    } catch (err) {
      setOtpError(errorMessage(err))
      setBusy(false)
    }
  }

  if (sent) {
    return (
      <form onSubmit={verify} noValidate>
        <ErrorBanner message={error} />
        <p>{sent.existing ? t('signUp.existingAccount', { mobile }) : t('signUp.codeSent', { mobile })}</p>
        <DevCode code={sent.devCode} />
        <OtpInput label={t('field.otp')} error={otpError} onChange={setOtp} autoFocus />
        <StepButtons busy={busy} onBack={() => setSent(null)} label={t('signUp.verify')} />
      </form>
    )
  }

  return (
    <form onSubmit={sendCode} noValidate>
      <ErrorBanner message={error} />
      <div className="lw-two">
        <TextField label={t('field.firstName')} autoComplete="given-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} error={errors.firstName} autoFocus />
        <TextField label={t('field.lastName')} autoComplete="family-name" value={lastName} onChange={(e) => setLastName(e.target.value)} error={errors.lastName} />
      </div>
      <TextField
        label={t('field.mobile')}
        hint={t('field.mobileHint')}
        type="tel"
        inputMode="numeric"
        autoComplete="tel-national"
        value={mobile}
        onChange={(e) => setMobile(e.target.value)}
        error={errors.mobile}
      />
      <StepButtons busy={busy} label={t('signIn.sendCode')} />
    </form>
  )
}

interface Option {
  id: string
  label: string
}

const GENDERS: { value: string; label: MessageKey }[] = [
  { value: 'FEMALE', label: 'gender.FEMALE' },
  { value: 'MALE', label: 'gender.MALE' },
  { value: 'OTHER', label: 'gender.OTHER' },
  { value: 'NOT_STATED', label: 'gender.NOT_STATED' },
]

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

/** Step 2: the basic profile. */
function StepProfile({ progress, onDone }: StepProps) {
  const t = useT()
  const [gender, setGender] = useState(progress.gender ?? '')
  const [dateOfBirth, setDateOfBirth] = useState(progress.dateOfBirth ?? '')
  const [educationLevelId, setEducationLevelId] = useState(progress.educationLevelId ?? '')
  const [occupationId, setOccupationId] = useState(progress.occupationId ?? '')
  const [lookups, setLookups] = useState<{ education: Option[]; occupations: Option[] } | null>(null)
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const genderId = useId()
  const educationId = useId()
  const occupationFieldId = useId()

  const loadLookups = useCallback(() => {
    setLookupError(null)
    setLookups(null)
    Promise.all([api.get<Option[]>('/config/education-levels'), api.get<Option[]>('/config/occupations')])
      .then(([education, occupations]) => setLookups({ education, occupations }))
      .catch((err) => setLookupError(errorMessage(err)))
  }, [])
  useEffect(loadLookups, [loadLookups])

  async function save(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const next: Record<string, string> = {}
    if (!gender) next.gender = t('validation.gender')
    const age = dateOfBirth ? (Date.now() - new Date(dateOfBirth).getTime()) / (365.25 * 24 * 3600 * 1000) : NaN
    if (!dateOfBirth || Number.isNaN(age)) next.dateOfBirth = t('validation.dateOfBirth')
    else if (age < 0 || age > 120) next.dateOfBirth = t('validation.dateOfBirthRange')
    setErrors(next)
    if (Object.keys(next).length) return
    setBusy(true)
    try {
      await api.patch('/members/me', {
        gender,
        dateOfBirth,
        ...(educationLevelId ? { educationLevelId } : {}),
        ...(occupationId ? { occupationId } : {}),
      })
      onDone({ gender, dateOfBirth, educationLevelId, occupationId })
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <form onSubmit={save} noValidate>
      <ErrorBanner message={error} />
      <fieldset className="k-field lw-fieldset" aria-describedby={`${genderId}-error`} aria-invalid={errors.gender ? true : undefined}>
        <legend className="k-label">{t('field.gender')}</legend>
        <div className="lw-choices">
          {GENDERS.map((g) => (
            <label key={g.value} className="k-check">
              <input type="radio" name="gender" value={g.value} checked={gender === g.value} onChange={() => setGender(g.value)} />
              <span>{t(g.label)}</span>
            </label>
          ))}
        </div>
        <span className="k-error" id={`${genderId}-error`} role={errors.gender ? 'alert' : undefined}>
          {errors.gender ?? ''}
        </span>
      </fieldset>
      <TextField label={t('field.dateOfBirth')} type="date" max={todayIso()} value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} error={errors.dateOfBirth} />

      {lookupError && <ErrorState message={lookupError} onRetry={loadLookups} />}
      {!lookups && !lookupError && <ListSkeleton rows={1} />}
      {lookups && (
        <>
          <div className="k-field">
            <label className="k-label" htmlFor={educationId}>
              {t('field.education')} <span className="k-hint">{t('common.optional')}</span>
            </label>
            <select id={educationId} className="k-select" value={educationLevelId} onChange={(e) => setEducationLevelId(e.target.value)}>
              <option value="">{t('common.choose')}</option>
              {lookups.education.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="k-field">
            <label className="k-label" htmlFor={occupationFieldId}>
              {t('field.occupation')} <span className="k-hint">{t('common.optional')}</span>
            </label>
            <select id={occupationFieldId} className="k-select" value={occupationId} onChange={(e) => setOccupationId(e.target.value)}>
              <option value="">{t('common.choose')}</option>
              {lookups.occupations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </>
      )}
      <StepButtons busy={busy} />
    </form>
  )
}

interface PlaceData {
  states: { name: string; districts: { name: string; talukas: string[] }[] }[]
}
const PLACES = places as PlaceData

/** A text field with a searchable list (native <datalist>), which also takes a name not in the list. */
function SearchSelect({ label, value, onChange, options, error, hint }: { label: string; value: string; onChange: (v: string) => void; options: string[]; error?: string; hint?: string }) {
  const listId = useId()
  return (
    <>
      <TextField label={label} hint={hint} list={options.length ? listId : undefined} autoComplete="off" value={value} onChange={(e) => onChange(e.target.value)} error={error} />
      {options.length > 0 && (
        <datalist id={listId}>
          {options.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
      )}
    </>
  )
}

/**
 * Step 3: the family's native place, State -> District -> Taluka -> Village.
 * The lists come from src/data/places.json (Maharashtra; a stand-in until the
 * API's lookups module serves geography). Any name can be typed.
 * TODO: members have no taluka column yet, so it is saved with the village
 * ("Village, Taluka") in native_village until one is added.
 */
function StepPlace({ progress, onDone, onBack }: StepProps) {
  const t = useT()
  const [state, setState] = useState(progress.state ?? 'Maharashtra')
  const [district, setDistrict] = useState(progress.district ?? '')
  const [taluka, setTaluka] = useState(progress.taluka ?? '')
  const [village, setVillage] = useState(progress.village ?? '')
  const [currentCity, setCurrentCity] = useState(progress.currentCity ?? '')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const stateData = PLACES.states.find((s) => s.name.toLowerCase() === state.trim().toLowerCase())
  const districtData = stateData?.districts.find((d) => d.name.toLowerCase() === district.trim().toLowerCase())
  async function save(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const next: Record<string, string> = {}
    if (!state.trim()) next.state = t('validation.required')
    if (!district.trim()) next.district = t('validation.required')
    if (!taluka.trim()) next.taluka = t('validation.required')
    if (!village.trim()) next.village = t('validation.required')
    setErrors(next)
    if (Object.keys(next).length) return
    setBusy(true)
    try {
      await api.patch('/members/me', {
        nativeState: state.trim(),
        nativeDistrict: district.trim(),
        nativeVillage: `${village.trim()}, ${taluka.trim()}`,
        ...(currentCity.trim() ? { currentCity: currentCity.trim() } : {}),
      })
      onDone({ state: state.trim(), district: district.trim(), taluka: taluka.trim(), village: village.trim(), currentCity: currentCity.trim() })
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <form onSubmit={save} noValidate>
      <ErrorBanner message={error} />
      <p className="k-muted">{t('signUp.placeLead')}</p>
      {/* Changing a level clears the levels under it. */}
      <SearchSelect
        label={t('field.state')}
        value={state}
        onChange={(v) => {
          setState(v)
          setDistrict('')
          setTaluka('')
        }}
        options={PLACES.states.map((s) => s.name)}
        error={errors.state}
      />
      <SearchSelect
        label={t('field.district')}
        value={district}
        onChange={(v) => {
          setDistrict(v)
          setTaluka('')
        }}
        options={stateData?.districts.map((d) => d.name) ?? []}
        error={errors.district}
        hint={t('field.searchHint')}
      />
      <SearchSelect label={t('field.taluka')} value={taluka} onChange={setTaluka} options={districtData?.talukas ?? []} error={errors.taluka} hint={t('field.searchHint')} />
      <TextField label={t('field.village')} hint={t('field.villageHint')} value={village} onChange={(e) => setVillage(e.target.value)} error={errors.village} />
      <TextField label={`${t('field.currentCity')} (${t('common.optional')})`} value={currentCity} onChange={(e) => setCurrentCity(e.target.value)} autoComplete="address-level2" />
      <StepButtons busy={busy} onBack={onBack} />
    </form>
  )
}

const ID_KINDS: { value: string; label: MessageKey }[] = [
  { value: 'AADHAAR_MASKED', label: 'idProof.AADHAAR_MASKED' },
  { value: 'VOTER_ID', label: 'idProof.VOTER_ID' },
  { value: 'PAN', label: 'idProof.PAN' },
  { value: 'DRIVING_LICENCE', label: 'idProof.DRIVING_LICENCE' },
  { value: 'PASSPORT', label: 'idProof.PASSPORT' },
  { value: 'OTHER', label: 'idProof.OTHER' },
]

/** Step 4: the ID proof, with a preview, the self-declaration and consent (DPDP Act 2023). */
function StepIdProof({ progress, onDone, onBack }: StepProps) {
  const t = useT()
  const [kind, setKind] = useState(progress.idProofKind ?? 'AADHAAR_MASKED')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [declared, setDeclared] = useState(false)
  const [consented, setConsented] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const kindId = useId()
  const fileId = useId()

  useEffect(() => {
    if (!file || !file.type.startsWith('image/')) {
      setPreview(null)
      return
    }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  function pick(list: FileList | null) {
    const chosen = list?.[0] ?? null
    setErrors((e) => ({ ...e, file: '' }))
    if (!chosen) return setFile(null)
    if (!(ID_PROOF_TYPES as readonly string[]).includes(chosen.type)) {
      setFile(null)
      return setErrors((e) => ({ ...e, file: t('validation.fileType') }))
    }
    // Large photos are shrunk before upload; a PDF must already fit.
    if (chosen.type === 'application/pdf' && chosen.size > MAX_ID_PROOF_BYTES) {
      setFile(null)
      return setErrors((e) => ({ ...e, file: t('validation.fileSize') }))
    }
    setFile(chosen)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const next: Record<string, string> = {}
    if (!file) next.file = t('validation.fileRequired')
    if (!declared) next.declared = t('validation.declaration')
    if (!consented) next.consented = t('validation.consent')
    setErrors(next)
    if (Object.keys(next).length) return
    setBusy(true)
    try {
      const idProofFileId = await uploadDocument(file!)
      await api.post('/auth/sign-up/complete', { idProofFileId, idProofKind: kind, selfDeclaration: true, dataConsent: true })
      onDone({})
    } catch (err) {
      setError(err instanceof ApiError && err.status === 413 ? t('validation.fileSize') : errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <ErrorBanner message={error} />
      <p className="k-muted">{t('signUp.idLead')}</p>
      <div className="k-field">
        <label className="k-label" htmlFor={kindId}>
          {t('field.idKind')}
        </label>
        <select id={kindId} className="k-select" value={kind} onChange={(e) => setKind(e.target.value)}>
          {ID_KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {t(k.label)}
            </option>
          ))}
        </select>
        {kind === 'AADHAAR_MASKED' && <span className="k-hint">{t('signUp.aadhaarHint')}</span>}
      </div>

      <div className="k-field">
        <label className="k-upload" htmlFor={fileId}>
          <Icon name="upload" size={28} />
          <strong>{file ? t('signUp.fileChange') : t('signUp.fileChoose')}</strong>
          <span className="k-hint" id={`${fileId}-hint`}>
            {t('signUp.fileHint')}
          </span>
          <input
            id={fileId}
            type="file"
            accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
            aria-describedby={`${fileId}-hint ${fileId}-error`}
            aria-invalid={errors.file ? true : undefined}
            onChange={(e) => pick(e.target.files)}
          />
        </label>
        <span className="k-error" id={`${fileId}-error`} role={errors.file ? 'alert' : undefined}>
          {errors.file ?? ''}
        </span>
        {file && (
          <div className="k-upload__preview" aria-live="polite">
            {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL, nothing to optimise */}
            {preview ? <img src={preview} alt={t('signUp.previewAlt')} /> : null}
            <p className="k-small">
              {file.name} · {Math.max(1, Math.round(file.size / 1024))} KB
            </p>
          </div>
        )}
      </div>

      <label className="k-check">
        <input type="checkbox" checked={declared} onChange={(e) => setDeclared(e.target.checked)} aria-invalid={errors.declared ? true : undefined} />
        <span>{t('signUp.declaration')}</span>
      </label>
      <span className="k-error" role={errors.declared ? 'alert' : undefined}>
        {errors.declared ?? ''}
      </span>
      <label className="k-check">
        <input type="checkbox" checked={consented} onChange={(e) => setConsented(e.target.checked)} aria-invalid={errors.consented ? true : undefined} />
        <span>
          {t('signUp.consent')} <a href="/privacy">{t('signUp.privacyLink')}</a>
        </span>
      </label>
      <span className="k-error" role={errors.consented ? 'alert' : undefined}>
        {errors.consented ?? ''}
      </span>
      <StepButtons busy={busy} onBack={onBack} label={t('signUp.finish')} />
    </form>
  )
}
