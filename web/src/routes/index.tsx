import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'

export const Route = createFileRoute('/')({ component: Home })

type Share = {
  id: string
  memberId: string
  memberName: string
  amountCents: number
  paidAt: string | null
}
type Bill = { id: string; homeId: string; title: string; totalCents: number; shares: Share[] }
type ApiResult<T> = { data?: T; error?: string }

async function api<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const response = await fetch(path, {
      ...init,
      headers: { 'content-type': 'application/json', ...init?.headers },
    })
    let body: unknown
    try {
      body = await response.json()
    } catch {
      body = null
    }
    if (!response.ok) {
      const message =
        body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
          ? body.error
          : `Request failed (${response.status})`
      return { error: message }
    }
    return { data: body as T }
  } catch {
    return { error: 'Could not reach the server. Check your connection and try again.' }
  }
}

function Home() {
  const [homeId, setHomeId] = useState(
    () => new URLSearchParams(window.location.search).get('homeId') ?? '',
  )
  const [draftId, setDraftId] = useState(homeId)
  const [bills, setBills] = useState<Bill[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [paying, setPaying] = useState<string | null>(null)
  const [notice, setNotice] = useState('')

  const loadBills = useCallback(async (id: string) => {
    if (!id.trim()) {
      setError('Enter a home ID to see its bills.')
      return
    }
    setLoading(true)
    setError('')
    const result = await api<{ bills: Bill[] }>(`/api/homes/${encodeURIComponent(id.trim())}/bills`)
    setLoading(false)
    if (result.error || !result.data) {
      setBills([])
      setError(result.error ?? 'Could not load bills.')
      return
    }
    setHomeId(id.trim())
    setBills(result.data.bills)
    setNotice('')
    const url = new URL(window.location.href)
    url.searchParams.set('homeId', id.trim())
    window.history.replaceState({}, '', url)
  }, [])

  useEffect(() => {
    if (homeId) void loadBills(homeId)
  }, [homeId, loadBills])

  async function payShare(bill: Bill, share: Share) {
    const key = crypto.randomUUID()
    const paymentId = `${bill.id}:${share.id}`
    setPaying(paymentId)
    setError('')
    const result = await api<Share>(
      `/api/bills/${encodeURIComponent(bill.id)}/shares/${encodeURIComponent(share.id)}/pay`,
      {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
      },
    )
    setPaying(null)
    if (result.error || !result.data) {
      setError(result.error ?? 'Payment failed.')
      return
    }
    setBills((current) =>
      current.map((item) =>
        item.id !== bill.id
          ? item
          : {
              ...item,
              shares: item.shares.map((currentShare) =>
                currentShare.id === share.id
                  ? { ...currentShare, paidAt: result.data?.paidAt ?? null }
                  : currentShare,
              ),
            },
      ),
    )
    setNotice(`${share.memberName}’s share is paid.`)
  }

  return (
    <main
      style={{
        maxWidth: 840,
        margin: '48px auto',
        padding: '0 20px',
        color: '#172033',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <h1 style={{ marginBottom: 8 }}>Shared home bills</h1>
      <p style={{ color: '#596579', marginTop: 0 }}>
        Enter a home ID to review bills and mark individual shares as paid.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void loadBills(draftId)
        }}
        style={{ display: 'flex', gap: 8, margin: '24px 0' }}
      >
        <label
          htmlFor="home-id"
          style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden' }}
        >
          Home ID
        </label>
        <input
          id="home-id"
          value={draftId}
          onChange={(event) => setDraftId(event.target.value)}
          placeholder="Home ID"
          style={{ flex: 1, padding: '11px 12px', border: '1px solid #cbd3df', borderRadius: 8 }}
        />
        <button type="submit" disabled={loading} style={buttonStyle}>
          {loading ? 'Loading…' : 'Load bills'}
        </button>
      </form>
      {error && (
        <p role="alert" style={alertStyle}>
          {error}
        </p>
      )}
      {notice && (
        <p role="status" style={{ color: '#17643b' }}>
          {notice}
        </p>
      )}
      {loading ? (
        <p aria-live="polite">Loading bills…</p>
      ) : !error && homeId && bills.length === 0 ? (
        <p>No bills yet for this home.</p>
      ) : null}
      {bills.map((bill) => (
        <section
          key={bill.id}
          style={{
            border: '1px solid #dce2eb',
            borderRadius: 12,
            padding: 20,
            margin: '16px 0',
            boxShadow: '0 3px 12px #1720330a',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 12,
              alignItems: 'baseline',
            }}
          >
            <h2 style={{ fontSize: 19, margin: 0 }}>{bill.title}</h2>
            <strong>{formatMoney(bill.totalCents)}</strong>
          </div>
          <ul style={{ listStyle: 'none', padding: 0, marginBottom: 0 }}>
            {bill.shares.map((share) => {
              const paymentId = `${bill.id}:${share.id}`
              return (
                <li
                  key={share.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 12,
                    borderTop: '1px solid #edf0f4',
                    padding: '12px 0',
                  }}
                >
                  <span>
                    {share.memberName}: {formatMoney(share.amountCents)}
                  </span>
                  {share.paidAt ? (
                    <span style={{ color: '#17643b' }}>Paid</span>
                  ) : (
                    <button
                      type="button"
                      disabled={paying === paymentId}
                      onClick={() => void payShare(bill, share)}
                      style={buttonStyle}
                    >
                      {paying === paymentId ? 'Paying…' : 'Mark paid'}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </main>
  )
}

function formatMoney(cents: number) {
  return `$${(cents / 100).toFixed(2)}`
}

const buttonStyle = {
  border: 0,
  borderRadius: 8,
  background: '#243b73',
  color: 'white',
  padding: '10px 14px',
  cursor: 'pointer',
}
const alertStyle = { color: '#9b1c1c', background: '#fff0f0', padding: 12, borderRadius: 8 }
