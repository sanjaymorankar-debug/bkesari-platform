'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { api } from '../../../lib/api-client'
import { errorMessage } from '../../../lib/auth-context'
import { RequireAuth, TopBar, Shell, ErrorBanner, Avatar } from '../../../components/ui'

interface Comment {
  id: string
  content: string
  createdAt: string
  author: { firstName: string; lastName: string | null }
}

interface PostDetail {
  id: string
  title: string | null
  content: string
  createdAt: string
  author: { firstName: string; lastName: string | null }
  postType: { label: string }
  comments: Comment[]
  _count: { reactions: number }
}

export default function PostDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [post, setPost] = useState<PostDetail | null>(null)
  const [commentText, setCommentText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  function load() {
    api
      .get<PostDetail>(`/posts/${id}`)
      .then(setPost)
      .catch((err) => setError(errorMessage(err)))
  }

  useEffect(load, [id])

  async function addComment(e: React.FormEvent) {
    e.preventDefault()
    if (!commentText.trim()) return
    try {
      await api.post(`/posts/${id}/comments`, { content: commentText })
      setCommentText('')
      load()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  async function react() {
    try {
      await api.post(`/posts/${id}/react`, { type: 'LIKE' })
      load()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  async function report() {
    const reason = window.prompt('Why are you reporting this post?')
    if (!reason) return
    try {
      await api.post(`/posts/${id}/report`, { reason })
      setNotice('Report submitted to moderators.')
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <RequireAuth>
      <TopBar />
      <Shell>
        <ErrorBanner message={error} />
        {notice && <div className="card" style={{ borderColor: 'var(--success)', color: 'var(--success)', marginBottom: 16 }}>{notice}</div>}

        {post && (
          <>
            <div className="card stack" style={{ marginBottom: 20 }}>
              <div className="row">
                <Avatar name={`${post.author.firstName} ${post.author.lastName ?? ''}`} />
                <div>
                  <strong>
                    {post.author.firstName} {post.author.lastName ?? ''}
                  </strong>
                  <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                    {new Date(post.createdAt).toLocaleString()} · {post.postType.label}
                  </p>
                </div>
              </div>
              {post.title && <h2 style={{ margin: 0 }}>{post.title}</h2>}
              <p style={{ margin: 0 }}>{post.content}</p>
              <div className="row">
                <button className="btn btn-outline" onClick={react}>
                  Like ({post._count.reactions})
                </button>
                <button className="btn btn-outline" onClick={report}>
                  Report
                </button>
              </div>
            </div>

            <h3>Comments</h3>
            <form onSubmit={addComment} className="row" style={{ marginBottom: 16 }}>
              <input value={commentText} onChange={(e) => setCommentText(e.target.value)} placeholder="Write a comment…" style={{ flex: 1 }} />
              <button className="btn btn-primary" type="submit">
                Post
              </button>
            </form>

            <div className="stack">
              {post.comments.map((c) => (
                <div key={c.id} className="card row">
                  <Avatar name={`${c.author.firstName} ${c.author.lastName ?? ''}`} />
                  <div>
                    <strong style={{ fontSize: 14 }}>
                      {c.author.firstName} {c.author.lastName ?? ''}
                    </strong>
                    <p style={{ margin: '4px 0 0' }}>{c.content}</p>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </Shell>
    </RequireAuth>
  )
}
