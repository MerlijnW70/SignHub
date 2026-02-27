/**
 * Comprehensive integration test suite for the SignHub SpacetimeDB module.
 *
 * Requires:
 *   1. SpacetimeDB running locally (`spacetime start`)
 *   2. Module freshly published (`spacetime publish new-app-ulf9q --clear-database -y`)
 *
 * Run:
 *   npx vitest run
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, waitFor, expectError, sleep, type TestClient } from './helpers'

// ─── Shared state across all tests ──────────────────────────────────────────
let clientA: TestClient
let clientB: TestClient
let clientC: TestClient
let clientD: TestClient // extra client for permission checks (no account)

// Company IDs (populated during company creation tests)
let companyAId: bigint
let companyBId: bigint

// ─── Setup & Teardown ───────────────────────────────────────────────────────
beforeAll(async () => {
  ;[clientA, clientB, clientC, clientD] = await Promise.all([
    createClient(),
    createClient(),
    createClient(),
    createClient(),
  ])
  // Small delay for subscriptions to stabilize
  await sleep(500)
}, 30_000)

afterAll(() => {
  clientA?.disconnect()
  clientB?.disconnect()
  clientC?.disconnect()
  clientD?.disconnect()
})

// ─── Helper: read table rows from a client's local cache ────────────────────
function getAccounts(client: TestClient) {
  return [...client.conn.db.user_account.iter()]
}

function getCompanies(client: TestClient) {
  return [...client.conn.db.company.iter()]
}

function getConnections(client: TestClient) {
  return [...client.conn.db.company_connection.iter()]
}

function getChats(client: TestClient) {
  return [...client.conn.db.connection_chat.iter()]
}

function getInviteCodes(client: TestClient) {
  return [...client.conn.db.invite_code.iter()]
}

function getCapabilities(client: TestClient) {
  return [...client.conn.db.capability.iter()]
}

function myAccount(client: TestClient) {
  return getAccounts(client).find(
    a => a.identity.toHexString() === client.identity.toHexString()
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. ACCOUNT CREATION
// ═════════════════════════════════════════════════════════════════════════════
describe('1. Account Creation', () => {
  it('clientA creates an account', async () => {
    await clientA.conn.reducers.createAccount({
      fullName: 'Alice van Dijk',
      nickname: 'Alice',
      email: 'alice@alpha.test',
    })
    await waitFor(() => myAccount(clientA) !== undefined)
    const acct = myAccount(clientA)!
    expect(acct.fullName).toBe('Alice van Dijk')
    expect(acct.nickname).toBe('Alice')
    expect(acct.email).toBe('alice@alpha.test')
    expect(acct.companyId).toBeUndefined()
  })

  it('clientB creates an account', async () => {
    await clientB.conn.reducers.createAccount({
      fullName: 'Bob Jansen',
      nickname: 'Bob',
      email: 'bob@beta.test',
    })
    await waitFor(() => myAccount(clientB) !== undefined)
    expect(myAccount(clientB)!.fullName).toBe('Bob Jansen')
  })

  it('clientC creates an account', async () => {
    await clientC.conn.reducers.createAccount({
      fullName: 'Charlie Peters',
      nickname: 'Charlie',
      email: 'charlie@test.test',
    })
    await waitFor(() => myAccount(clientC) !== undefined)
    expect(myAccount(clientC)!.fullName).toBe('Charlie Peters')
  })

  it('rejects empty full name', async () => {
    await expectError(
      () =>
        clientD.conn.reducers.createAccount({
          fullName: '',
          nickname: 'x',
          email: 'x@x.x',
        }),
      'Name cannot be empty'
    )
  })

  it('rejects empty nickname', async () => {
    await expectError(
      () =>
        clientD.conn.reducers.createAccount({
          fullName: 'Test',
          nickname: '',
          email: 'x@x.x',
        }),
      'Nickname cannot be empty'
    )
  })

  it('rejects empty email', async () => {
    await expectError(
      () =>
        clientD.conn.reducers.createAccount({
          fullName: 'Test',
          nickname: 'test',
          email: '',
        }),
      'Email cannot be empty'
    )
  })

  it('rejects name too long (>50 chars)', async () => {
    await expectError(
      () =>
        clientD.conn.reducers.createAccount({
          fullName: 'A'.repeat(51),
          nickname: 'test',
          email: 'x@x.x',
        }),
      'too long'
    )
  })

  it('rejects duplicate account', async () => {
    await expectError(
      () =>
        clientA.conn.reducers.createAccount({
          fullName: 'Alice Again',
          nickname: 'Alice2',
          email: 'alice2@alpha.test',
        }),
      'Account already exists'
    )
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 2. COMPANY CREATION
// ═════════════════════════════════════════════════════════════════════════════
describe('2. Company Creation', () => {
  it('clientA creates Alpha Signs', async () => {
    await clientA.conn.reducers.createCompany({
      name: 'Alpha Signs',
      slug: 'alpha-signs',
      location: 'Amsterdam, NL',
    })
    await waitFor(() => myAccount(clientA)?.companyId != null)
    const acct = myAccount(clientA)!
    companyAId = acct.companyId!
    expect(acct.role.tag).toBe('Owner')
    const company = getCompanies(clientA).find(c => c.id === companyAId)!
    expect(company.name).toBe('Alpha Signs')
    expect(company.slug).toBe('alpha-signs')
  })

  it('clientB creates Beta Signs', async () => {
    await clientB.conn.reducers.createCompany({
      name: 'Beta Signs',
      slug: 'beta-signs',
      location: 'Rotterdam, NL',
    })
    await waitFor(() => myAccount(clientB)?.companyId != null)
    companyBId = myAccount(clientB)!.companyId!
    expect(myAccount(clientB)!.role.tag).toBe('Owner')
  })

  it('rejects empty company name', async () => {
    await expectError(
      () =>
        clientC.conn.reducers.createCompany({
          name: '',
          slug: 'test',
          location: 'Test',
        }),
      'Company name cannot be empty'
    )
  })

  it('rejects empty slug', async () => {
    await expectError(
      () =>
        clientC.conn.reducers.createCompany({
          name: 'Test',
          slug: '',
          location: 'Test',
        }),
      'Slug cannot be empty'
    )
  })

  it('rejects empty location', async () => {
    await expectError(
      () =>
        clientC.conn.reducers.createCompany({
          name: 'Test',
          slug: 'test',
          location: '',
        }),
      'Location cannot be empty'
    )
  })

  it('rejects duplicate slug', async () => {
    await expectError(
      () =>
        clientC.conn.reducers.createCompany({
          name: 'Another',
          slug: 'alpha-signs',
          location: 'Test',
        }),
      'Slug is already taken'
    )
  })

  it('rejects user already in company', async () => {
    await expectError(
      () =>
        clientA.conn.reducers.createCompany({
          name: 'Second Co',
          slug: 'second-co',
          location: 'Test',
        }),
      'already belong to a company'
    )
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 3. INVITE CODE SYSTEM
// ═════════════════════════════════════════════════════════════════════════════
describe('3. Invite Code System', () => {
  let inviteCode: string

  it('clientA generates an invite code', async () => {
    const codesBefore = getInviteCodes(clientA).length
    await clientA.conn.reducers.generateInviteCode({ maxUses: 5 })
    await waitFor(() => getInviteCodes(clientA).length > codesBefore)
    const codes = getInviteCodes(clientA).filter(
      c => c.companyId === companyAId
    )
    expect(codes.length).toBeGreaterThan(0)
    inviteCode = codes[codes.length - 1].code
    expect(codes[codes.length - 1].usesRemaining).toBe(5)
  })

  it('rejects no-company user generating invite code', async () => {
    await expectError(
      () => clientC.conn.reducers.generateInviteCode({ maxUses: 1 }),
      'must belong to a company'
    )
  })

  it('clientC joins Alpha Signs via invite code', async () => {
    await clientC.conn.reducers.joinCompany({ code: inviteCode })
    await waitFor(() => myAccount(clientC)?.companyId != null)
    const acct = myAccount(clientC)!
    expect(acct.companyId).toBe(companyAId)
    expect(acct.role.tag).toBe('Member')
  })

  it('invite code uses decremented', async () => {
    await waitFor(() => {
      const code = getInviteCodes(clientA).find(c => c.code === inviteCode)
      return code !== undefined && code.usesRemaining === 4
    })
    const code = getInviteCodes(clientA).find(c => c.code === inviteCode)!
    expect(code.usesRemaining).toBe(4)
  })

  it('rejects invalid invite code', async () => {
    await expectError(
      () => clientD.conn.reducers.createAccount({
        fullName: 'Dave',
        nickname: 'Dave',
        email: 'dave@test.test',
      }).then(() =>
        clientD.conn.reducers.joinCompany({ code: 'XXXX-XXXX-XXXX-XXXX' })
      ),
      'Invalid invite code'
    )
  })

  it('clientA deletes invite code', async () => {
    await clientA.conn.reducers.deleteInviteCode({ code: inviteCode })
    await waitFor(
      () => getInviteCodes(clientA).find(c => c.code === inviteCode) === undefined
    )
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 4. TEAM MANAGEMENT
// ═════════════════════════════════════════════════════════════════════════════
describe('4. Team Management', () => {
  it('clientA (Owner) changes clientC role to Admin', async () => {
    await clientA.conn.reducers.updateUserRole({
      targetIdentity: clientC.identity,
      newRole: { tag: 'Admin' },
    })
    await waitFor(() => {
      const acct = getAccounts(clientA).find(
        a => a.identity.toHexString() === clientC.identity.toHexString()
      )
      return acct?.role.tag === 'Admin'
    })
  })

  it('rejects Admin trying to change roles', async () => {
    await expectError(
      () =>
        clientC.conn.reducers.updateUserRole({
          targetIdentity: clientA.identity,
          newRole: { tag: 'Member' },
        }),
      'Only the owner'
    )
  })

  it('rejects changing own role', async () => {
    await expectError(
      () =>
        clientA.conn.reducers.updateUserRole({
          targetIdentity: clientA.identity,
          newRole: { tag: 'Admin' },
        }),
      'Cannot change your own role'
    )
  })

  it('rejects assigning Owner via updateUserRole', async () => {
    await expectError(
      () =>
        clientA.conn.reducers.updateUserRole({
          targetIdentity: clientC.identity,
          newRole: { tag: 'Owner' },
        }),
      'transfer_ownership'
    )
  })

  it('clientA transfers ownership to clientC', async () => {
    await clientA.conn.reducers.transferOwnership({
      newOwnerIdentity: clientC.identity,
    })
    await waitFor(() => myAccount(clientA)?.role.tag === 'Admin')
    expect(myAccount(clientA)!.role.tag).toBe('Admin')
    await waitFor(() => {
      const acct = getAccounts(clientA).find(
        a => a.identity.toHexString() === clientC.identity.toHexString()
      )
      return acct?.role.tag === 'Owner'
    })
  })

  it('clientC transfers ownership back to clientA', async () => {
    await clientC.conn.reducers.transferOwnership({
      newOwnerIdentity: clientA.identity,
    })
    await waitFor(() => myAccount(clientA)?.role.tag === 'Owner')
  })

  it('clientA removes clientC from company', async () => {
    await clientA.conn.reducers.removeColleague({
      colleagueIdentity: clientC.identity,
    })
    await waitFor(() => {
      const acct = getAccounts(clientA).find(
        a => a.identity.toHexString() === clientC.identity.toHexString()
      )
      return acct?.companyId == null
    })
  })

  it('rejects removing self', async () => {
    await expectError(
      () =>
        clientA.conn.reducers.removeColleague({
          colleagueIdentity: clientA.identity,
        }),
      'Cannot remove yourself'
    )
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 5. PROFILE & COMPANY SETTINGS
// ═════════════════════════════════════════════════════════════════════════════
describe('5. Profile & Company Settings', () => {
  it('clientA updates profile', async () => {
    await clientA.conn.reducers.updateProfile({
      nickname: 'AliceUpdated',
      email: 'alice-new@alpha.test',
    })
    await waitFor(() => myAccount(clientA)?.nickname === 'AliceUpdated')
    expect(myAccount(clientA)!.email).toBe('alice-new@alpha.test')
  })

  it('rejects empty nickname on update', async () => {
    await expectError(
      () =>
        clientA.conn.reducers.updateProfile({
          nickname: '',
          email: 'alice@alpha.test',
        }),
      'Nickname cannot be empty'
    )
  })

  it('clientA updates company profile', async () => {
    await clientA.conn.reducers.updateCompanyProfile({
      name: 'Alpha Signs BV',
      slug: 'alpha-signs',
      location: 'Amsterdam, NL',
      bio: 'Premium sign makers',
      isPublic: true,
      kvkNumber: '12345678',
    })
    await waitFor(
      () => getCompanies(clientA).find(c => c.id === companyAId)?.bio === 'Premium sign makers'
    )
    const co = getCompanies(clientA).find(c => c.id === companyAId)!
    expect(co.isPublic).toBe(true)
    expect(co.name).toBe('Alpha Signs BV')
  })

  it('rejects no-company user updating company', async () => {
    await expectError(
      () =>
        clientC.conn.reducers.updateCompanyProfile({
          name: 'Test',
          slug: 'test',
          location: 'Test',
          bio: '',
          isPublic: false,
          kvkNumber: '',
        }),
      'must belong to a company'
    )
  })

  it('clientA updates capabilities', async () => {
    // Check capability row exists before update
    const capBefore = getCapabilities(clientA).find(c => c.companyId === companyAId)
    expect(capBefore).toBeDefined()
    // SDK returns booleans as 0/1 numbers for capability fields
    expect(!!capBefore!.canInstall).toBe(false) // default

    await clientA.conn.reducers.updateCapabilities({
      canInstall: true,
      hasCnc: true,
      hasLargeFormat: false,
      hasBucketTruck: false,
    })
    await waitFor(() => {
      const cap = getCapabilities(clientA).find(c => c.companyId === companyAId)
      return cap !== undefined && !!cap.canInstall
    })
    const cap = getCapabilities(clientA).find(c => c.companyId === companyAId)!
    expect(!!cap.hasCnc).toBe(true)
    expect(!!cap.hasLargeFormat).toBe(false)
  })

  it('make Beta Signs public for connection tests', async () => {
    await clientB.conn.reducers.updateCompanyProfile({
      name: 'Beta Signs',
      slug: 'beta-signs',
      location: 'Rotterdam, NL',
      bio: 'Wide format specialists',
      isPublic: true,
      kvkNumber: '',
    })
    await waitFor(
      () => getCompanies(clientB).find(c => c.id === companyBId)?.isPublic === true
    )
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 6. CONNECTION LIFECYCLE
// ═════════════════════════════════════════════════════════════════════════════
describe('6. Connection Lifecycle', () => {
  it('clientA requests connection to Beta Signs with message', async () => {
    const connsBefore = getConnections(clientA).length
    await clientA.conn.reducers.requestConnection({
      targetCompanyId: companyBId,
      message: "Let's collaborate on CNC work!",
    })
    await waitFor(() => getConnections(clientA).length > connsBefore)
    const conn = getConnections(clientA).find(
      c =>
        (c.companyA === companyAId && c.companyB === companyBId) ||
        (c.companyA === companyBId && c.companyB === companyAId)
    )!
    expect(conn.status.tag).toBe('Pending')
    expect(conn.initialMessage).toBe("Let's collaborate on CNC work!")
  })

  it('rejects duplicate request', async () => {
    await expectError(
      () =>
        clientA.conn.reducers.requestConnection({
          targetCompanyId: companyBId,
          message: '',
        }),
      'already exists'
    )
  })

  it('rejects connect to own company', async () => {
    await expectError(
      () =>
        clientA.conn.reducers.requestConnection({
          targetCompanyId: companyAId,
          message: '',
        }),
      'Cannot connect to your own company'
    )
  })

  it('rejects connect to nonexistent company', async () => {
    await expectError(
      () =>
        clientA.conn.reducers.requestConnection({
          targetCompanyId: 99999n,
          message: '',
        }),
      'Target company not found'
    )
  })

  it('clientB accepts the connection', async () => {
    await clientB.conn.reducers.acceptConnection({
      targetCompanyId: companyAId,
    })
    await waitFor(() => {
      const conn = getConnections(clientB).find(
        c =>
          (c.companyA === companyAId && c.companyB === companyBId) ||
          (c.companyA === companyBId && c.companyB === companyAId)
      )
      return conn?.status.tag === 'Accepted'
    })
  })

  it('rejects accept on non-pending connection', async () => {
    await expectError(
      () =>
        clientB.conn.reducers.acceptConnection({
          targetCompanyId: companyAId,
        }),
      'not pending'
    )
  })

  it('clientA disconnects from Beta Signs', async () => {
    await clientA.conn.reducers.disconnectCompany({
      targetCompanyId: companyBId,
    })
    await waitFor(() => {
      const conn = getConnections(clientA).find(
        c =>
          (c.companyA === companyAId && c.companyB === companyBId) ||
          (c.companyA === companyBId && c.companyB === companyAId)
      )
      return conn === undefined
    })
  })

  it('cancel flow: request then cancel', async () => {
    await clientA.conn.reducers.requestConnection({
      targetCompanyId: companyBId,
      message: '',
    })
    await waitFor(() =>
      getConnections(clientA).some(
        c =>
          c.status.tag === 'Pending' &&
          ((c.companyA === companyAId && c.companyB === companyBId) ||
            (c.companyA === companyBId && c.companyB === companyAId))
      )
    )
    await clientA.conn.reducers.cancelRequest({
      targetCompanyId: companyBId,
    })
    await waitFor(
      () =>
        getConnections(clientA).find(
          c =>
            (c.companyA === companyAId && c.companyB === companyBId) ||
            (c.companyA === companyBId && c.companyB === companyAId)
        ) === undefined
    )
  })

  it('decline flow: request then decline', async () => {
    await clientA.conn.reducers.requestConnection({
      targetCompanyId: companyBId,
      message: 'Try again',
    })
    await waitFor(() =>
      getConnections(clientB).some(
        c =>
          c.status.tag === 'Pending' &&
          ((c.companyA === companyAId && c.companyB === companyBId) ||
            (c.companyA === companyBId && c.companyB === companyAId))
      )
    )
    await clientB.conn.reducers.declineConnection({
      targetCompanyId: companyAId,
    })
    await waitFor(
      () =>
        getConnections(clientA).find(
          c =>
            (c.companyA === companyAId && c.companyB === companyBId) ||
            (c.companyA === companyBId && c.companyB === companyAId)
        ) === undefined
    )
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 7. CHAT SYSTEM
// ═════════════════════════════════════════════════════════════════════════════
describe('7. Chat System', () => {
  let connectionId: bigint

  it('setup: request connection with message', async () => {
    await clientA.conn.reducers.requestConnection({
      targetCompanyId: companyBId,
      message: 'Need your wide-format for a project',
    })
    await waitFor(() =>
      getConnections(clientA).some(
        c =>
          c.status.tag === 'Pending' &&
          ((c.companyA === companyAId && c.companyB === companyBId) ||
            (c.companyA === companyBId && c.companyB === companyAId))
      )
    )
    const conn = getConnections(clientA).find(
      c =>
        c.status.tag === 'Pending' &&
        ((c.companyA === companyAId && c.companyB === companyBId) ||
          (c.companyA === companyBId && c.companyB === companyAId))
    )!
    connectionId = conn.id
  })

  it('clientB sends chat on pending connection', async () => {
    const chatsBefore = getChats(clientB).length
    await clientB.conn.reducers.sendConnectionChat({
      connectionId,
      text: 'What dimensions?',
    })
    await waitFor(() => getChats(clientB).length > chatsBefore)
    const chat = getChats(clientB).find(c => c.connectionId === connectionId)!
    expect(chat.text).toBe('What dimensions?')
  })

  it('clientA sends reply', async () => {
    const chatsBefore = getChats(clientA).filter(
      c => c.connectionId === connectionId
    ).length
    await clientA.conn.reducers.sendConnectionChat({
      connectionId,
      text: '3m x 2m vinyl',
    })
    await waitFor(
      () =>
        getChats(clientA).filter(c => c.connectionId === connectionId).length >
        chatsBefore
    )
  })

  it('both messages are in the chat table', async () => {
    await sleep(300)
    const chats = getChats(clientA).filter(
      c => c.connectionId === connectionId
    )
    expect(chats.length).toBe(2)
    const texts = chats.map(c => c.text).sort()
    expect(texts).toContain('What dimensions?')
    expect(texts).toContain('3m x 2m vinyl')
  })

  it('rejects empty message', async () => {
    await expectError(
      () =>
        clientA.conn.reducers.sendConnectionChat({
          connectionId,
          text: '',
        }),
      'cannot be empty'
    )
  })

  it('rejects message too long', async () => {
    await expectError(
      () =>
        clientA.conn.reducers.sendConnectionChat({
          connectionId,
          text: 'X'.repeat(501),
        }),
      'too long'
    )
  })

  it('clientB accepts — chat preserved', async () => {
    await clientB.conn.reducers.acceptConnection({
      targetCompanyId: companyAId,
    })
    await waitFor(() => {
      const conn = getConnections(clientA).find(c => c.id === connectionId)
      return conn?.status.tag === 'Accepted'
    })
    const chats = getChats(clientA).filter(
      c => c.connectionId === connectionId
    )
    expect(chats.length).toBe(2)
  })

  it('chat works on accepted connection', async () => {
    const chatsBefore = getChats(clientA).filter(
      c => c.connectionId === connectionId
    ).length
    await clientA.conn.reducers.sendConnectionChat({
      connectionId,
      text: 'Great, sending specs',
    })
    await waitFor(
      () =>
        getChats(clientA).filter(c => c.connectionId === connectionId).length >
        chatsBefore
    )
  })

  it('cleanup: disconnect', async () => {
    await clientA.conn.reducers.disconnectCompany({
      targetCompanyId: companyBId,
    })
    await waitFor(
      () =>
        getConnections(clientA).find(c => c.id === connectionId) === undefined
    )
    // Chat should also be deleted
    await waitFor(
      () =>
        getChats(clientA).filter(c => c.connectionId === connectionId)
          .length === 0
    )
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 8. GHOSTING & BLOCK
// ═════════════════════════════════════════════════════════════════════════════
describe('8. Ghosting & Block', () => {
  it('clientB blocks clientA (from no connection)', async () => {
    await clientB.conn.reducers.blockCompany({
      targetCompanyId: companyAId,
    })
    await waitFor(() => {
      return getConnections(clientB).some(
        c =>
          ((c.companyA === companyAId && c.companyB === companyBId) ||
            (c.companyA === companyBId && c.companyB === companyAId)) &&
          c.status.tag === 'Blocked'
      )
    }, 10_000)
    const conn = getConnections(clientB).find(
      c =>
        c.status.tag === 'Blocked' &&
        ((c.companyA === companyAId && c.companyB === companyBId) ||
          (c.companyA === companyBId && c.companyB === companyAId))
    )!
    expect(conn).toBeDefined()
    expect(conn.blockedBy).toBeDefined()
  })

  it('ghosting: clientA requests connection — silently succeeds', async () => {
    // Should NOT throw, but also should NOT create a new Pending connection
    await clientA.conn.reducers.requestConnection({
      targetCompanyId: companyBId,
      message: 'Hello?',
    })
    await sleep(500)
    const pending = getConnections(clientA).find(
      c =>
        c.status.tag === 'Pending' &&
        ((c.companyA === companyAId && c.companyB === companyBId) ||
          (c.companyA === companyBId && c.companyB === companyAId))
    )
    expect(pending).toBeUndefined()
  })

  it('rejects clientA trying to unblock (wrong company)', async () => {
    await expectError(
      () =>
        clientA.conn.reducers.unblockCompany({
          targetCompanyId: companyBId,
        }),
      'Only the company that blocked'
    )
  })

  it('clientB unblocks clientA', async () => {
    await clientB.conn.reducers.unblockCompany({
      targetCompanyId: companyAId,
    })
    await waitFor(
      () =>
        getConnections(clientB).find(
          c =>
            c.status.tag === 'Blocked' &&
            ((c.companyA === companyAId && c.companyB === companyBId) ||
              (c.companyA === companyBId && c.companyB === companyAId))
        ) === undefined
    )
  })

  it('block from accepted state', async () => {
    // Request → Accept → Block
    await clientA.conn.reducers.requestConnection({
      targetCompanyId: companyBId,
      message: '',
    })
    await waitFor(() =>
      getConnections(clientB).some(
        c =>
          c.status.tag === 'Pending' &&
          ((c.companyA === companyAId && c.companyB === companyBId) ||
            (c.companyA === companyBId && c.companyB === companyAId))
      )
    )
    await clientB.conn.reducers.acceptConnection({
      targetCompanyId: companyAId,
    })
    await waitFor(() =>
      getConnections(clientB).some(
        c =>
          c.status.tag === 'Accepted' &&
          ((c.companyA === companyAId && c.companyB === companyBId) ||
            (c.companyA === companyBId && c.companyB === companyAId))
      )
    )
    await clientB.conn.reducers.blockCompany({
      targetCompanyId: companyAId,
    })
    await waitFor(() =>
      getConnections(clientB).some(
        c =>
          c.status.tag === 'Blocked' &&
          ((c.companyA === companyAId && c.companyB === companyBId) ||
            (c.companyA === companyBId && c.companyB === companyAId))
      )
    )
    // Clean up
    await clientB.conn.reducers.unblockCompany({
      targetCompanyId: companyAId,
    })
    await waitFor(
      () =>
        getConnections(clientB).find(
          c =>
            (c.companyA === companyAId && c.companyB === companyBId) ||
            (c.companyA === companyBId && c.companyB === companyAId)
        ) === undefined
    )
  })

  it('rejects blocking own company', async () => {
    await expectError(
      () =>
        clientA.conn.reducers.blockCompany({
          targetCompanyId: companyAId,
        }),
      'Cannot block your own company'
    )
  })

  it('chat on blocked connection is rejected', async () => {
    // Block first
    await clientB.conn.reducers.blockCompany({
      targetCompanyId: companyAId,
    })
    await waitFor(() =>
      getConnections(clientB).some(
        c =>
          c.status.tag === 'Blocked' &&
          ((c.companyA === companyAId && c.companyB === companyBId) ||
            (c.companyA === companyBId && c.companyB === companyAId))
      )
    )
    const conn = getConnections(clientB).find(
      c =>
        c.status.tag === 'Blocked' &&
        ((c.companyA === companyAId && c.companyB === companyBId) ||
          (c.companyA === companyBId && c.companyB === companyAId))
    )!
    await expectError(
      () =>
        clientB.conn.reducers.sendConnectionChat({
          connectionId: conn.id,
          text: 'Should fail',
        }),
      'blocked connection'
    )
    // Clean up
    await clientB.conn.reducers.unblockCompany({
      targetCompanyId: companyAId,
    })
    await waitFor(
      () =>
        getConnections(clientB).find(
          c =>
            (c.companyA === companyAId && c.companyB === companyBId) ||
            (c.companyA === companyBId && c.companyB === companyAId)
        ) === undefined
    )
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 9. PERMISSION CHECKS
// ═════════════════════════════════════════════════════════════════════════════
describe('9. Permission Checks', () => {
  it('cleanup: ensure no connection between A and B', async () => {
    // Clean up any leftover connections from prior tests
    const conn = getConnections(clientA).find(
      c =>
        (c.companyA === companyAId && c.companyB === companyBId) ||
        (c.companyA === companyBId && c.companyB === companyAId)
    )
    if (conn) {
      if (conn.status.tag === 'Blocked') {
        // Try to unblock from both sides
        try { await clientB.conn.reducers.unblockCompany({ targetCompanyId: companyAId }) } catch {}
        try { await clientA.conn.reducers.unblockCompany({ targetCompanyId: companyBId }) } catch {}
      } else if (conn.status.tag === 'Accepted') {
        await clientA.conn.reducers.disconnectCompany({ targetCompanyId: companyBId })
      } else if (conn.status.tag === 'Pending') {
        try { await clientA.conn.reducers.cancelRequest({ targetCompanyId: companyBId }) } catch {}
        try { await clientB.conn.reducers.declineConnection({ targetCompanyId: companyAId }) } catch {}
      }
      await waitFor(
        () =>
          getConnections(clientA).find(
            c =>
              (c.companyA === companyAId && c.companyB === companyBId) ||
              (c.companyA === companyBId && c.companyB === companyAId)
          ) === undefined
      )
    }
  })

  it('no-account user cannot create company', async () => {
    // clientD has an account from the invite code test — create a fresh client
    const fresh = await createClient()
    try {
      await expectError(
        () =>
          fresh.conn.reducers.createCompany({
            name: 'Fail Co',
            slug: 'fail-co',
            location: 'Nowhere',
          }),
        'Create an account first'
      )
    } finally {
      fresh.disconnect()
    }
  })

  it('no-company user cannot request connection', async () => {
    await expectError(
      () =>
        clientC.conn.reducers.requestConnection({
          targetCompanyId: companyBId,
          message: '',
        }),
      'must belong to a company'
    )
  })

  it('requesting side cannot accept own request', async () => {
    await clientA.conn.reducers.requestConnection({
      targetCompanyId: companyBId,
      message: '',
    })
    await waitFor(() =>
      getConnections(clientA).some(
        c =>
          c.status.tag === 'Pending' &&
          ((c.companyA === companyAId && c.companyB === companyBId) ||
            (c.companyA === companyBId && c.companyB === companyAId))
      )
    )
    await expectError(
      () =>
        clientA.conn.reducers.acceptConnection({
          targetCompanyId: companyBId,
        }),
      'cannot accept your own'
    )
    // Clean up
    await clientA.conn.reducers.cancelRequest({
      targetCompanyId: companyBId,
    })
    await waitFor(
      () =>
        getConnections(clientA).find(
          c =>
            c.status.tag === 'Pending' &&
            ((c.companyA === companyAId && c.companyB === companyBId) ||
              (c.companyA === companyBId && c.companyB === companyAId))
        ) === undefined
    )
  })

  it('non-requesting side cannot cancel', async () => {
    await clientA.conn.reducers.requestConnection({
      targetCompanyId: companyBId,
      message: '',
    })
    await waitFor(() =>
      getConnections(clientB).some(
        c =>
          c.status.tag === 'Pending' &&
          ((c.companyA === companyAId && c.companyB === companyBId) ||
            (c.companyA === companyBId && c.companyB === companyAId))
      )
    )
    await expectError(
      () =>
        clientB.conn.reducers.cancelRequest({
          targetCompanyId: companyAId,
        }),
      'Only the requesting side'
    )
    // Clean up
    await clientA.conn.reducers.cancelRequest({
      targetCompanyId: companyBId,
    })
    await waitFor(
      () =>
        getConnections(clientA).find(
          c =>
            c.status.tag === 'Pending' &&
            ((c.companyA === companyAId && c.companyB === companyBId) ||
              (c.companyA === companyBId && c.companyB === companyAId))
        ) === undefined
    )
  })

  it('non-party cannot send chat on connection', async () => {
    // Create a connection between A and B
    await clientA.conn.reducers.requestConnection({
      targetCompanyId: companyBId,
      message: '',
    })
    await waitFor(() =>
      getConnections(clientA).some(
        c =>
          c.status.tag === 'Pending' &&
          ((c.companyA === companyAId && c.companyB === companyBId) ||
            (c.companyA === companyBId && c.companyB === companyAId))
      )
    )
    const conn = getConnections(clientA).find(
      c =>
        c.status.tag === 'Pending' &&
        ((c.companyA === companyAId && c.companyB === companyBId) ||
          (c.companyA === companyBId && c.companyB === companyAId))
    )!

    // clientC (no company) tries to chat
    await expectError(
      () =>
        clientC.conn.reducers.sendConnectionChat({
          connectionId: conn.id,
          text: 'Intruder',
        }),
      'must belong to a company'
    )

    // Clean up
    await clientA.conn.reducers.cancelRequest({
      targetCompanyId: companyBId,
    })
    await waitFor(
      () =>
        getConnections(clientA).find(c => c.id === conn.id) === undefined
    )
  })
})
