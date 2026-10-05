import test from 'node:test'
import assert from 'node:assert/strict'
import handler from '../../api/send-sms.ts'

type Row = Record<string, unknown>
const active: Row = { id: 'test-member', phone: '01000000001', status: 'active', is_deleted: false, is_suspended: false, is_withdrawn: false, meta: {} }
async function run(row: Row | null, options: { body?: Row; dbError?: boolean; staff?: boolean } = {}) {
  const before = globalThis.fetch
  const settings = { CRON_SECRET: 'synthetic-cron', SUPABASE_URL: 'https://synthetic-88.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-key', SOLAPI_API_KEY: 'synthetic-solapi', SOLAPI_API_SECRET: 'synthetic-solapi-secret', SOLAPI_ENABLED: 'true' }
  const oldEnv = Object.fromEntries(Object.keys(settings).map(k => [k, process.env[k]]))
  Object.assign(process.env, settings)
  let provider = 0, reads = 0
  globalThis.fetch = async input => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    if (url.origin === 'https://synthetic-88.supabase.co') {
      if (url.pathname === '/auth/v1/user') return new Response(JSON.stringify({ id: 'synthetic-user' }), { headers: { 'content-type': 'application/json' } })
      if (url.pathname === '/rest/v1/staff') return new Response(JSON.stringify({ id: 'synthetic-staff', is_active: true }), { headers: { 'content-type': 'application/json' } })
      assert.equal(url.pathname, '/rest/v1/members'); assert.equal(url.searchParams.get('id'), 'eq.test-member'); reads++
      if (options.dbError) throw new Error('synthetic unavailable')
      return new Response(JSON.stringify(row), { headers: { 'content-type': 'application/json' } })
    }
    assert.equal(url.origin, 'https://api.solapi.com', 'only synthetic provider intercept is allowed')
    provider++
    return new Response(JSON.stringify({ statusCode: '2000', messageId: 'synthetic-receipt' }), { headers: { 'content-type': 'application/json' } })
  }
  const result = { status: 0, body: {} as Row }
  try {
    await handler({ method: 'POST', headers: options.staff ? { authorization: 'Bearer synthetic-user' } : { 'x-internal-secret': settings.CRON_SECRET }, body: options.body ?? { member_id: 'test-member', source_site: '88lotto', dest_phone: '01000000001', send_phone: '0212340000', msg_body: 'synthetic' } }, {
      status(code: number) { result.status = code; return this }, json(value: Row) { result.body = value; return this },
    })
    return { ...result, provider, reads }
  } finally {
    globalThis.fetch = before
    for (const [key, value] of Object.entries(oldEnv)) if (value === undefined) delete process.env[key]; else process.env[key] = value
  }
}

test('88 recommendation rechecks current member before provider; local namespace/old reason are allowed', async () => {
  for (const meta of [{}, { source_site: '88lotto', reco_paused: false, reco_pause_reason: 'legacy_import_review', end_date: '2000-01-01' }]) {
    const r = await run({ ...active, meta }); assert.equal(r.provider, 1); assert.equal(r.reads, 1); assert.equal(r.body.ok, true)
  }
})
test('a new hold, inactive state, deleted member or changed phone/site prevents provider request', async () => {
  for (const row of [null, { ...active, meta: { reco_paused: true } }, { ...active, is_deleted: true }, { ...active, is_withdrawn: true }, { ...active, is_suspended: true }, { ...active, status: 'inactive' }, { ...active, phone: '01000000002' }, { ...active, meta: { source_site: 'pluslotto' } }, { ...active, meta: { reco_paused: 'false' } }, { ...active, meta: [] }]) {
    const r = await run(row); assert.equal(r.provider, 0); assert.equal(r.body.ok, false)
  }
})
test('missing/failed member lookup fails closed and never requests a provider', async () => {
  const r = await run(active, { dbError: true }); assert.equal(r.provider, 0); assert.equal(r.status, 503)
  const changed = await run(active, { body: { member_id: 'test-member', source_site: 'pluslotto', dest_phone: '01000000001', send_phone: '0212340000', msg_body: 'synthetic' } })
  assert.equal(changed.provider, 0); assert.equal(changed.reads, 0)
})
test('existing general internal and staff SMS without member context keep their route', async () => {
  const body = { dest_phone: '01000000001', send_phone: '0212340000', msg_body: 'synthetic' }
  for (const staff of [false, true]) { const r = await run(null, { body, staff }); assert.equal(r.provider, 1); assert.equal(r.reads, 0) }
})
