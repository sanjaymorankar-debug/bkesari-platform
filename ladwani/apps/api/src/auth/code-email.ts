import { OTP_TTL_MINUTES } from './otp-rules'

/** The languages of the bkesari shell's switcher (cookie k_lang). */
export type Lang = 'en' | 'mr' | 'hi'
export type CodePurpose = 'sign-up' | 'sign-in' | 'reset'

/** The k_lang cookie's value when it names a language, else English. Never the browser's own language. */
export function langOf(value: unknown): Lang {
  return value === 'mr' || value === 'hi' ? value : 'en'
}

interface Words {
  subject: (code: string) => string
  heading: (code: string) => string
  purpose: Record<CodePurpose, string>
  rules: (minutes: number) => string
  separate: string
  ignore: string
}

/**
 * Marathi and Hindi reuse the web app's wording where it has the same line
 * (auth.separateAccount, "works for 10 minutes": apps/web/src/i18n). Like
 * those files, they still need a native speaker's review before launch.
 */
const WORDS: Record<Lang, Words> = {
  en: {
    subject: (code) => `${code} is your LadWani code`,
    heading: (code) => `Your LadWani code is ${code}`,
    purpose: {
      'sign-up': 'Enter it to finish joining LadWani.',
      'sign-in': 'Enter it to sign in to LadWani.',
      reset: 'Enter it to set a new LadWani password.',
    },
    rules: (m) => `It works for ${m} minutes, once. Never share it with anyone.`,
    separate: 'This is a separate account for LadWani.',
    ignore: "If you didn't ask for this, ignore this email.",
  },
  mr: {
    subject: (code) => `${code} हा तुमचा LadWani कोड आहे`,
    heading: (code) => `तुमचा LadWani कोड: ${code}`,
    purpose: {
      'sign-up': 'LadWani मध्ये सामील होणे पूर्ण करण्यासाठी हा कोड टाका.',
      'sign-in': 'LadWani मध्ये साइन इन करण्यासाठी हा कोड टाका.',
      reset: 'LadWani चा नवीन पासवर्ड ठेवण्यासाठी हा कोड टाका.',
    },
    rules: (m) => `तो ${m} मिनिटे चालेल, फक्त एकदा. तो कोणालाही सांगू नका.`,
    separate: 'हे LadWani साठी स्वतंत्र खाते आहे.',
    ignore: 'तुम्ही हे मागितले नसेल, तर हा ईमेल दुर्लक्षित करा.',
  },
  hi: {
    subject: (code) => `${code} आपका LadWani कोड है`,
    heading: (code) => `आपका LadWani कोड: ${code}`,
    purpose: {
      'sign-up': 'LadWani से जुड़ना पूरा करने के लिए यह कोड डालें।',
      'sign-in': 'LadWani में साइन इन करने के लिए यह कोड डालें।',
      reset: 'LadWani का नया पासवर्ड रखने के लिए यह कोड डालें।',
    },
    rules: (m) => `यह ${m} मिनट तक चलेगा, सिर्फ़ एक बार। इसे किसी को न बताएँ।`,
    separate: 'यह LadWani के लिए अलग खाता है।',
    ignore: 'अगर आपने यह नहीं माँगा, तो इस ईमेल को अनदेखा करें।',
  },
}

/** The email that carries a one-time code: plain text, in the person's language. */
export function codeEmail(code: string, purpose: CodePurpose, lang: Lang = 'en'): { subject: string; text: string } {
  const w = WORDS[lang] ?? WORDS.en
  const text = [
    w.heading(code),
    '',
    `${w.purpose[purpose]} ${w.rules(OTP_TTL_MINUTES)}`,
    '',
    w.separate,
    w.ignore,
    '',
    'LadWani · bkesari',
    '',
  ].join('\n')
  return { subject: w.subject(code), text }
}
