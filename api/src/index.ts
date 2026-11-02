import { Hono } from 'hono'

type Bindings = { DB: D1Database }
type BillRow = { id: string; home_id: string; title: string; total_cents: number }
type ShareRow = { id: string; member_id: string; amount_cents: number; paid_at: string | null }

const app = new Hono<{ Bindings: Bindings }>()

function error(
  c: { json: (data: { error: string }, status: number) => Response },
  status: number,
  message: string,
) {
  return c.json({ error: message }, status)
}

async function readJson(c: {
  req: { json: <T>() => Promise<T> }
}): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await c.req.json()
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

app.onError((_, c) => c.json({ error: 'Internal server error' }, 500))
app.notFound((c) => c.json({ error: 'Not found' }, 404))

app.get('/api/health', (c) => c.json({ status: 'ok' }))

app.post('/api/homes', async (c) => {
  const body = await readJson(c)
  const name = body?.name
  if (typeof name !== 'string' || !name.trim()) return error(c, 422, 'Name is required')
  const id = crypto.randomUUID()
  await c.env.DB.prepare('INSERT INTO homes (id, name) VALUES (?, ?)').bind(id, name.trim()).run()
  return c.json({ id, name: name.trim() }, 201)
})

app.post('/api/homes/:homeId/members', async (c) => {
  const { homeId } = c.req.param()
  const body = await readJson(c)
  const name = body?.name
  if (typeof name !== 'string' || !name.trim()) return error(c, 422, 'Name is required')
  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()
  if (!home) return error(c, 404, 'Home not found')
  const id = crypto.randomUUID()
  await c.env.DB.prepare('INSERT INTO members (id, home_id, name) VALUES (?, ?, ?)')
    .bind(id, homeId, name.trim())
    .run()
  return c.json({ id, homeId, name: name.trim() }, 201)
})

app.post('/api/homes/:homeId/bills', async (c) => {
  const { homeId } = c.req.param()
  const body = await readJson(c)
  const title = body?.title
  const totalCents = body?.totalCents
  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()
  if (!home) return error(c, 404, 'Home not found')
  if (
    typeof title !== 'string' ||
    !title.trim() ||
    typeof totalCents !== 'number' ||
    !Number.isSafeInteger(totalCents) ||
    totalCents <= 0
  ) {
    return error(c, 422, 'Title and a positive whole number of cents are required')
  }
  const { results: members } = await c.env.DB.prepare(
    'SELECT id FROM members WHERE home_id = ? ORDER BY rowid ASC',
  )
    .bind(homeId)
    .all<{ id: string }>()
  if (members.length === 0) return error(c, 422, 'Home has no members')
  const billId = crypto.randomUUID()
  const statements = [
    c.env.DB.prepare(
      'INSERT INTO bills (id, home_id, title, total_cents) VALUES (?, ?, ?, ?)',
    ).bind(billId, homeId, title.trim(), totalCents),
  ]
  const base = Math.floor(totalCents / members.length)
  const extra = totalCents % members.length
  const shares = members.map((member, index) => ({
    id: crypto.randomUUID(),
    memberId: member.id,
    amountCents: base + (index < extra ? 1 : 0),
    paidAt: null,
  }))
  for (const share of shares) {
    statements.push(
      c.env.DB.prepare(
        'INSERT INTO shares (id, bill_id, member_id, amount_cents) VALUES (?, ?, ?, ?)',
      ).bind(share.id, billId, share.memberId, share.amountCents),
    )
  }
  await c.env.DB.batch(statements)
  return c.json({ id: billId, homeId, title: title.trim(), totalCents, shares }, 201)
})

app.get('/api/homes/:homeId/bills', async (c) => {
  const { homeId } = c.req.param()
  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()
  if (!home) return error(c, 404, 'Home not found')
  const { results } = await c.env.DB.prepare(
    `SELECT b.id, b.home_id, b.title, b.total_cents,
      s.id AS share_id, s.member_id, s.amount_cents, s.paid_at, m.name AS member_name
     FROM bills b LEFT JOIN shares s ON s.bill_id = b.id
     LEFT JOIN members m ON m.id = s.member_id
     WHERE b.home_id = ? ORDER BY b.created_at, b.rowid, m.rowid`,
  )
    .bind(homeId)
    .all<
      BillRow & {
        share_id: string | null
        member_id: string | null
        amount_cents: number | null
        paid_at: string | null
        member_name: string | null
      }
    >()
  const bills = new Map<
    string,
    {
      id: string
      homeId: string
      title: string
      totalCents: number
      shares: Array<Record<string, unknown>>
    }
  >()
  for (const row of results) {
    let bill = bills.get(row.id)
    if (!bill) {
      bill = {
        id: row.id,
        homeId: row.home_id,
        title: row.title,
        totalCents: row.total_cents,
        shares: [],
      }
      bills.set(row.id, bill)
    }
    if (row.share_id && row.member_id)
      bill.shares.push({
        id: row.share_id,
        memberId: row.member_id,
        memberName: row.member_name,
        amountCents: row.amount_cents,
        paidAt: row.paid_at,
      })
  }
  return c.json({ bills: [...bills.values()] })
})

app.post('/api/bills/:billId/shares/:shareId/pay', async (c) => {
  const { billId, shareId } = c.req.param()
  const key = c.req.header('Idempotency-Key')?.trim()
  if (!key) return error(c, 400, 'Idempotency-Key header is required')
  const share = await c.env.DB.prepare(
    `SELECT s.id, s.member_id, s.amount_cents, s.paid_at, s.idempotency_key
     FROM shares s JOIN bills b ON b.id = s.bill_id WHERE b.id = ? AND s.id = ?`,
  )
    .bind(billId, shareId)
    .first<ShareRow & { idempotency_key: string | null }>()
  if (!share) return error(c, 404, 'Bill or share not found')
  if (share.paid_at) {
    if (share.idempotency_key === key)
      return c.json({
        id: share.id,
        memberId: share.member_id,
        amountCents: share.amount_cents,
        paidAt: share.paid_at,
      })
    return error(c, 409, 'Share has already been paid')
  }
  const paidAt = new Date().toISOString()
  const result = await c.env.DB.prepare(
    'UPDATE shares SET paid_at = ?, idempotency_key = ? WHERE id = ? AND paid_at IS NULL',
  )
    .bind(paidAt, key, shareId)
    .run()
  const paid = await c.env.DB.prepare(
    'SELECT id, member_id, amount_cents, paid_at, idempotency_key FROM shares WHERE id = ?',
  )
    .bind(shareId)
    .first<ShareRow & { idempotency_key: string | null }>()
  if (!paid) return error(c, 404, 'Bill or share not found')
  if (result.meta.changes === 0 && paid.idempotency_key !== key)
    return error(c, 409, 'Share has already been paid')
  return c.json({
    id: paid.id,
    memberId: paid.member_id,
    amountCents: paid.amount_cents,
    paidAt: paid.paid_at,
  })
})

app.get('/api/homes/:homeId/balances', async (c) => {
  const { homeId } = c.req.param()
  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()
  if (!home) return error(c, 404, 'Home not found')
  const { results } = await c.env.DB.prepare(
    `SELECT m.id AS member_id, m.name, COALESCE(SUM(CASE WHEN s.paid_at IS NULL THEN s.amount_cents ELSE 0 END), 0) AS outstanding_cents
     FROM members m LEFT JOIN shares s ON s.member_id = m.id LEFT JOIN bills b ON b.id = s.bill_id AND b.home_id = m.home_id
     WHERE m.home_id = ? GROUP BY m.id ORDER BY m.rowid`,
  )
    .bind(homeId)
    .all<{ member_id: string; name: string; outstanding_cents: number }>()
  return c.json({
    balances: results.map((row) => ({
      memberId: row.member_id,
      name: row.name,
      outstandingCents: row.outstanding_cents,
    })),
  })
})

export default app
