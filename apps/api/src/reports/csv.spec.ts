import { toCsv } from './csv'

describe('toCsv', () => {
  it('returns an empty string for no rows', () => {
    expect(toCsv([])).toBe('')
  })

  it('writes a header row followed by one row per record', () => {
    const csv = toCsv([{ a: 1, b: 'x' }, { a: 2, b: 'y' }])
    expect(csv).toBe('a,b\n1,x\n2,y')
  })

  it('quotes and escapes values containing commas, quotes, or newlines', () => {
    const csv = toCsv([{ name: 'Deshmukh, Ravi', note: 'He said "hi"\nagain' }])
    expect(csv).toBe('name,note\n"Deshmukh, Ravi","He said ""hi""\nagain"')
  })

  it('renders null/undefined as an empty field', () => {
    const csv = toCsv([{ a: null, b: undefined }])
    expect(csv).toBe('a,b\n,')
  })
})
