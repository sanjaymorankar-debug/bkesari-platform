'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { api } from '../../lib/api-client'
import { errorMessage } from '../../lib/auth-context'
import { RequireAuth, TopBar, Shell, ErrorBanner, Avatar, StatusPill } from '../../components/ui'

interface FeedPost {
  id: string
  title: string | null
  content: string
  isPinned: boolean
  createdAt: string
  author: { firstName: string; lastName: string | null }
  postType: { code: string; label: string }
  _count: { comments: number; reactions: number }
}

export default function CommunityFeedPage() {
  const [posts, setPosts] = useState<FeedPost[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .get<FeedPost[]>('/posts')
      .then(setPosts)
      .catch((err) => setError(errorMessage(err)))
  }, [])

  async function react(postId: string) {
    try {
      await api.post(`/posts/${postId}/react`, { type: 'LIKE' })
      setPosts((prev) => prev?.map((p) => (p.id === postId ? { ...p, _count: { ...p._count, reactions: p._count.reactions + 1 } } : p)) ?? null)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <RequireAuth>
      <TopBar />
      <Shell>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h1>Community Feed</h1>
          <Link href="/community/new" className="btn btn-accent">
            New Post
          </Link>
        </div>
        <ErrorBanner message={error} />

        <div className="stack" style={{ marginTop: 16 }}>
          {posts?.length === 0 && <p className="muted">No posts yet — be the first to share something.</p>}
          {posts?.map((p) => (
            <div key={p.id} className="card stack">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div className="row">
                  <Avatar name={`${p.author.firstName} ${p.author.lastName ?? ''}`} />
                  <div>
                    <strong>
                      {p.author.firstName} {p.author.lastName ?? ''}
                    </strong>
                    <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                      {new Date(p.createdAt).toLocaleString()}
                    </p>
                  </div>
                </div>
                <span className="pill pill-neutral">{p.postType.label}</span>
              </div>
              {p.title && <h3 style={{ margin: 0 }}>{p.title}</h3>}
              <p style={{ margin: 0 }}>{p.content}</p>
              <div className="row">
                <button className="btn btn-outline" onClick={() => react(p.id)}>
                  Like ({p._count.reactions})
                </button>
                <Link href={`/community/${p.id}`} className="btn btn-outline">
                  Comments ({p._count.comments})
                </Link>
                {p.isPinned && <StatusPill status="PINNED" />}
              </div>
            </div>
          ))}
        </div>
      </Shell>
    </RequireAuth>
  )
}
