'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '../../../lib/api-client'
import { errorMessage } from '../../../lib/auth-context'
import { RequireAuth, TopBar, Shell, ErrorBanner } from '../../../components/ui'

interface PostType {
  code: string
  label: string
  requiresApproval: boolean
  isActive: boolean
}

export default function NewPostPage() {
  const router = useRouter()
  const [postTypes, setPostTypes] = useState<PostType[]>([])
  const [form, setForm] = useState({ postTypeCode: '', title: '', content: '' })
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    api
      .get<PostType[]>('/config/post-types')
      .then((types) => {
        const active = types.filter((t) => t.isActive)
        setPostTypes(active)
        if (active.length > 0) setForm((f) => ({ ...f, postTypeCode: f.postTypeCode || active[0].code }))
      })
      .catch((err) => setError(errorMessage(err)))
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const post = await api.post<{ id: string; status: string }>('/posts', {
        postTypeCode: form.postTypeCode,
        title: form.title || undefined,
        content: form.content,
      })
      router.push(post.status === 'PUBLISHED' ? `/community/${post.id}` : '/community')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <RequireAuth>
      <TopBar />
      <Shell>
        <h1>New Post</h1>
        <form onSubmit={submit} className="card stack" style={{ marginTop: 20 }}>
          <ErrorBanner message={error} />
          <div className="field">
            <label htmlFor="postType">Type</label>
            <select id="postType" value={form.postTypeCode} onChange={(e) => setForm({ ...form, postTypeCode: e.target.value })}>
              {postTypes.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.label}
                  {t.requiresApproval ? ' (needs Operator approval)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="title">Title (optional)</label>
            <input id="title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="content">Content</label>
            <textarea id="content" rows={6} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} required autoFocus />
          </div>
          <button className="btn btn-primary" type="submit" disabled={submitting}>
            {submitting ? 'Posting…' : 'Post'}
          </button>
        </form>
      </Shell>
    </RequireAuth>
  )
}
