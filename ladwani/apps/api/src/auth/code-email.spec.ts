import { codeEmail, langOf } from './code-email'

describe('codeEmail', () => {
  it('carries the code, the 10 minutes, the separate account and "ignore this" in English', () => {
    const mail = codeEmail('042917', 'sign-in')
    expect(mail.subject).toBe('042917 is your LadWani code')
    expect(mail.text).toContain('Your LadWani code is 042917')
    expect(mail.text).toContain('Enter it to sign in to LadWani. It works for 10 minutes, once.')
    expect(mail.text).toContain('This is a separate account for LadWani.')
    expect(mail.text).toContain("If you didn't ask for this, ignore this email.")
  })

  it('says what the code is for', () => {
    expect(codeEmail('111111', 'sign-up').text).toContain('finish joining LadWani')
    expect(codeEmail('111111', 'reset').text).toContain('set a new LadWani password')
  })

  it('in Marathi and Hindi, with the web app\'s own wording for the separate account', () => {
    const mr = codeEmail('123456', 'sign-in', 'mr')
    expect(mr.text).toContain('123456')
    expect(mr.text).toContain('हे LadWani साठी स्वतंत्र खाते आहे.')
    expect(mr.text).toContain('10 मिनिटे')
    const hi = codeEmail('123456', 'reset', 'hi')
    expect(hi.text).toContain('यह LadWani के लिए अलग खाता है।')
    expect(hi.text).toContain('10 मिनट')
  })
})

describe('langOf (the k_lang cookie)', () => {
  it('is English unless the shell chose Marathi or Hindi', () => {
    expect(langOf('mr')).toBe('mr')
    expect(langOf('hi')).toBe('hi')
    expect(langOf('en')).toBe('en')
    expect(langOf(undefined)).toBe('en')
    expect(langOf('mr-IN')).toBe('en')
    expect(langOf(['mr'])).toBe('en')
  })
})
