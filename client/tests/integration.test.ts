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

function getNotifications(client: TestClient) {
  return [...client.conn.db.notification.iter()]
}

function getProjects(client: TestClient) {
  return [...client.conn.db.project.iter()]
}

function getProjectMembers(client: TestClient) {
  return [...client.conn.db.project_member.iter()]
}

function getProjectChats(client: TestClient) {
  return [...client.conn.db.project_chat.iter()]
}

function getMembers(client: TestClient) {
  return [...client.conn.db.company_member.iter()]
}

function myAccount(client: TestClient) {
  return getAccounts(client).find(
    a => a.identity.toHexString() === client.identity.toHexString()
  )
}

function myMembership(client: TestClient, companyId?: bigint) {
  const cid = companyId ?? myAccount(client)?.activeCompanyId
  if (cid == null) return undefined
  return getMembers(client).find(
    m => m.identity.toHexString() === client.identity.toHexString() && m.companyId === cid
  )
}

function membershipOf(client: TestClient, targetIdentityHex: string, companyId: bigint) {
  return getMembers(client).find(
    m => m.identity.toHexString() === targetIdentityHex && m.companyId === companyId
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
    expect(acct.activeCompanyId).toBeUndefined()
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
    await waitFor(() => myAccount(clientA)?.activeCompanyId != null)
    const acct = myAccount(clientA)!
    companyAId = acct.activeCompanyId!
    expect(myMembership(clientA)?.role.tag).toBe('Owner')
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
    await waitFor(() => myAccount(clientB)?.activeCompanyId != null)
    companyBId = myAccount(clientB)!.activeCompanyId!
    expect(myMembership(clientB)?.role.tag).toBe('Owner')
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

  it('allows user to create a second company (multi-company)', async () => {
    await clientA.conn.reducers.createCompany({
      name: 'Second Co',
      slug: 'second-co',
      location: 'Test',
    })
    await waitFor(() => getCompanies(clientA).find(c => c.slug === 'second-co') != null)
    // Switch back to Alpha Signs
    await clientA.conn.reducers.switchActiveCompany({ companyId: companyAId })
    await waitFor(() => myAccount(clientA)?.activeCompanyId === companyAId)
    // Clean up: delete the second company (switch to it first to delete)
    const secondCo = getCompanies(clientA).find(c => c.slug === 'second-co')!
    await clientA.conn.reducers.switchActiveCompany({ companyId: secondCo.id })
    await waitFor(() => myAccount(clientA)?.activeCompanyId === secondCo.id)
    await clientA.conn.reducers.deleteCompany({})
    await waitFor(() => getCompanies(clientA).find(c => c.slug === 'second-co') == null)
    // Switch back
    await waitFor(() => myAccount(clientA)?.activeCompanyId === companyAId)
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
      'Not permitted'
    )
  })

  it('clientC joins Alpha Signs via invite code', async () => {
    await clientC.conn.reducers.joinCompany({ code: inviteCode })
    await waitFor(() => myAccount(clientC)?.activeCompanyId != null)
    const acct = myAccount(clientC)!
    expect(acct.activeCompanyId).toBe(companyAId)
    expect(myMembership(clientC)?.role.tag).toBe('Pending')
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
      const mem = membershipOf(clientA, clientC.identity.toHexString(), companyAId)
      return mem?.role.tag === 'Admin'
    })
  })

  it('rejects Admin trying to change roles', async () => {
    await expectError(
      () =>
        clientC.conn.reducers.updateUserRole({
          targetIdentity: clientA.identity,
          newRole: { tag: 'Member' },
        }),
      'Cannot change the role of someone at or above your level'
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
    await waitFor(() => myMembership(clientA, companyAId)?.role.tag === 'Admin')
    expect(myMembership(clientA, companyAId)!.role.tag).toBe('Admin')
    await waitFor(() => {
      const mem = membershipOf(clientA, clientC.identity.toHexString(), companyAId)
      return mem?.role.tag === 'Owner'
    })
  })

  it('clientC transfers ownership back to clientA', async () => {
    await clientC.conn.reducers.transferOwnership({
      newOwnerIdentity: clientA.identity,
    })
    await waitFor(() => myMembership(clientA, companyAId)?.role.tag === 'Owner')
  })

  it('clientA removes clientC from company', async () => {
    await clientA.conn.reducers.removeColleague({
      colleagueIdentity: clientC.identity,
    })
    await waitFor(() => {
      const mem = membershipOf(clientA, clientC.identity.toHexString(), companyAId)
      return mem === undefined
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
      'Not permitted'
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
    expect(conn.blockingCompanyId).toBeDefined()
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
        'Account not found'
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
      'Not permitted'
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
      'Not permitted'
    )

    // Clean up — accept the connection (we need it for project tests)
    await clientB.conn.reducers.acceptConnection({
      targetCompanyId: companyAId,
    })
    await waitFor(() => {
      const c = getConnections(clientA).find(cc => cc.id === conn.id)
      return c?.status.tag === 'Accepted'
    })
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 10. NOTIFICATIONS
// ═════════════════════════════════════════════════════════════════════════════
describe('10. Notifications', () => {
  it('notifications were generated from earlier actions', async () => {
    await sleep(300)
    // clientA should have notifications from various actions (connection requests, etc.)
    const notifs = getNotifications(clientA)
    // At minimum, the accepted connection should have generated a notification
    expect(notifs.length).toBeGreaterThan(0)
  })

  it('clientA marks a notification as read', async () => {
    const notif = getNotifications(clientA).find(n => !n.isRead)!
    expect(notif).toBeDefined()
    const notifId = notif.id

    await clientA.conn.reducers.markNotificationRead({ notificationId: notifId })
    await waitFor(() => {
      const n = getNotifications(clientA).find(nn => nn.id === notifId)
      return n?.isRead === true
    })
  })

  it('clientA marks all notifications read', async () => {
    await sleep(300)
    const myIdentityHex = clientA.identity.toHexString()
    const myUnreadBefore = getNotifications(clientA).filter(
      n => n.companyId === companyAId && !n.isRead &&
        n.recipientIdentity.toHexString() === myIdentityHex
    )
    await clientA.conn.reducers.markAllNotificationsRead({ companyId: companyAId })
    if (myUnreadBefore.length === 0) {
      // Nothing to mark, just confirm no error
      return
    }
    await waitFor(() => {
      const unread = getNotifications(clientA).filter(
        n => n.companyId === companyAId && !n.isRead &&
          n.recipientIdentity.toHexString() === myIdentityHex
      )
      return unread.length === 0
    })
  })

  it('clientA clears read notifications', async () => {
    const myIdentityHex = clientA.identity.toHexString()
    const readBefore = getNotifications(clientA).filter(
      n => n.companyId === companyAId && n.isRead &&
        n.recipientIdentity.toHexString() === myIdentityHex
    ).length
    // Only clears if there are read notifications
    if (readBefore > 0) {
      await clientA.conn.reducers.clearNotifications({ companyId: companyAId })
      await waitFor(() => {
        const readAfter = getNotifications(clientA).filter(
          n => n.companyId === companyAId && n.isRead &&
            n.recipientIdentity.toHexString() === myIdentityHex
        ).length
        return readAfter < readBefore
      })
    }
  })

  it('rejects marking someone else notification as read', async () => {
    // Generate a notification for clientB by having A send a chat
    const conn = getConnections(clientA).find(
      c =>
        c.status.tag === 'Accepted' &&
        ((c.companyA === companyAId && c.companyB === companyBId) ||
          (c.companyA === companyBId && c.companyB === companyAId))
    )!
    await clientA.conn.reducers.sendConnectionChat({
      connectionId: conn.id,
      text: 'Notification test msg',
    })
    await waitFor(() => getNotifications(clientB).some(n => !n.isRead))
    const bNotif = getNotifications(clientB).find(n => !n.isRead)!

    await expectError(
      () => clientA.conn.reducers.markNotificationRead({ notificationId: bNotif.id }),
      'Not your notification'
    )
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 11. PROJECT LIFECYCLE
// ═════════════════════════════════════════════════════════════════════════════
describe('11. Project Lifecycle', () => {
  let projectId: bigint

  it('clientA creates a project', async () => {
    const projectsBefore = getProjects(clientA).length
    await clientA.conn.reducers.createProject({
      name: 'Hospital Utrecht Signage',
      description: 'Large hospital signage project',
    })
    await waitFor(() => getProjects(clientA).length > projectsBefore)
    const project = getProjects(clientA).find(
      p => p.name === 'Hospital Utrecht Signage'
    )!
    expect(project).toBeDefined()
    expect(project.ownerCompanyId).toBe(companyAId)
    expect(project.description).toBe('Large hospital signage project')
    projectId = project.id

    // Owner company auto-added as Accepted member
    const members = getProjectMembers(clientA).filter(
      m => m.projectId === projectId
    )
    expect(members.length).toBe(1)
    expect(members[0].companyId).toBe(companyAId)
    expect(members[0].status.tag).toBe('Accepted')
  })

  it('rejects empty project name', async () => {
    await expectError(
      () => clientA.conn.reducers.createProject({ name: '', description: 'test' }),
      'Project name cannot be empty'
    )
  })

  it('rejects project name too long', async () => {
    await expectError(
      () => clientA.conn.reducers.createProject({ name: 'X'.repeat(81), description: 'test' }),
      'too long'
    )
  })

  it('clientA invites clientB company to project', async () => {
    const membersBefore = getProjectMembers(clientA).filter(
      m => m.projectId === projectId
    ).length
    await clientA.conn.reducers.inviteToProject({
      projectId,
      targetCompanyId: companyBId,
    })
    await waitFor(() =>
      getProjectMembers(clientA).filter(m => m.projectId === projectId).length > membersBefore
    )
    const invite = getProjectMembers(clientA).find(
      m => m.projectId === projectId && m.companyId === companyBId
    )!
    expect(invite.status.tag).toBe('Invited')
  })

  it('rejects duplicate invite', async () => {
    await expectError(
      () => clientA.conn.reducers.inviteToProject({
        projectId,
        targetCompanyId: companyBId,
      }),
      'already been invited'
    )
  })

  it('rejects inviting own company', async () => {
    await expectError(
      () => clientA.conn.reducers.inviteToProject({
        projectId,
        targetCompanyId: companyAId,
      }),
      'Cannot invite your own company'
    )
  })

  it('clientB gets notification about project invite', async () => {
    await waitFor(() =>
      getNotifications(clientB).some(
        n => n.notificationType.tag === 'ProjectInvite'
      )
    )
    const notif = getNotifications(clientB).find(
      n => n.notificationType.tag === 'ProjectInvite'
    )!
    expect(notif.body).toContain('Hospital Utrecht Signage')
  })

  it('clientB accepts project invite', async () => {
    await clientB.conn.reducers.acceptProjectInvite({ projectId })
    await waitFor(() => {
      const m = getProjectMembers(clientB).find(
        mm => mm.projectId === projectId && mm.companyId === companyBId
      )
      return m?.status.tag === 'Accepted'
    })
  })

  it('clientA gets notification about project accepted', async () => {
    await waitFor(() =>
      getNotifications(clientA).some(
        n => n.notificationType.tag === 'ProjectAccepted'
      )
    )
  })

  it('clientA sends project chat', async () => {
    const chatsBefore = getProjectChats(clientA).filter(
      c => c.projectId === projectId
    ).length
    await clientA.conn.reducers.sendProjectChat({
      projectId,
      text: 'The permits are approved',
    })
    await waitFor(() =>
      getProjectChats(clientA).filter(c => c.projectId === projectId).length > chatsBefore
    )
    const chat = getProjectChats(clientA).find(
      c => c.projectId === projectId && c.text === 'The permits are approved'
    )!
    expect(chat.sender.toHexString()).toBe(clientA.identity.toHexString())
  })

  it('clientB sees the project chat', async () => {
    await waitFor(() =>
      getProjectChats(clientB).some(
        c => c.projectId === projectId && c.text === 'The permits are approved'
      )
    )
  })

  it('clientB sends project chat reply', async () => {
    await clientB.conn.reducers.sendProjectChat({
      projectId,
      text: 'Great, we will start production',
    })
    await waitFor(() =>
      getProjectChats(clientB).some(
        c => c.projectId === projectId && c.text === 'Great, we will start production'
      )
    )
  })

  it('clientA gets notification about project chat', async () => {
    await waitFor(() =>
      getNotifications(clientA).some(
        n => n.notificationType.tag === 'ProjectChat'
      )
    )
  })

  it('rejects empty project chat', async () => {
    await expectError(
      () => clientA.conn.reducers.sendProjectChat({ projectId, text: '' }),
      'cannot be empty'
    )
  })

  it('rejects project chat too long', async () => {
    await expectError(
      () => clientA.conn.reducers.sendProjectChat({ projectId, text: 'X'.repeat(501) }),
      'too long'
    )
  })

  it('clientA kicks clientB from project', async () => {
    await clientA.conn.reducers.kickFromProject({
      projectId,
      targetCompanyId: companyBId,
    })
    await waitFor(() => {
      const m = getProjectMembers(clientA).find(
        mm => mm.projectId === projectId && mm.companyId === companyBId
      )
      return m?.status.tag === 'Kicked'
    })
  })

  it('clientB gets notification about being kicked', async () => {
    await waitFor(() =>
      getNotifications(clientB).some(
        n => n.notificationType.tag === 'ProjectKicked'
      )
    )
  })

  it('re-invite after kick cleans up old row', async () => {
    await clientA.conn.reducers.inviteToProject({
      projectId,
      targetCompanyId: companyBId,
    })
    await waitFor(() => {
      const m = getProjectMembers(clientA).find(
        mm => mm.projectId === projectId && mm.companyId === companyBId
      )
      return m?.status.tag === 'Invited'
    })
    // Accept again for leave test
    await clientB.conn.reducers.acceptProjectInvite({ projectId })
    await waitFor(() => {
      const m = getProjectMembers(clientB).find(
        mm => mm.projectId === projectId && mm.companyId === companyBId
      )
      return m?.status.tag === 'Accepted'
    })
  })

  it('clientB leaves project', async () => {
    await clientB.conn.reducers.leaveProject({ projectId })
    await waitFor(() => {
      const m = getProjectMembers(clientB).find(
        mm => mm.projectId === projectId && mm.companyId === companyBId
      )
      return m?.status.tag === 'Left'
    })
  })

  it('clientA gets notification about company leaving', async () => {
    await waitFor(() =>
      getNotifications(clientA).some(
        n => n.notificationType.tag === 'ProjectLeft'
      )
    )
  })

  it('re-invite after leave works', async () => {
    await clientA.conn.reducers.inviteToProject({
      projectId,
      targetCompanyId: companyBId,
    })
    await waitFor(() => {
      const m = getProjectMembers(clientA).find(
        mm => mm.projectId === projectId && mm.companyId === companyBId
      )
      return m?.status.tag === 'Invited'
    })
    // Decline this time
    await clientB.conn.reducers.declineProjectInvite({ projectId })
    await waitFor(() => {
      const m = getProjectMembers(clientB).find(
        mm => mm.projectId === projectId && mm.companyId === companyBId
      )
      return m === undefined
    })
  })

  it('clientA gets notification about project declined', async () => {
    await waitFor(() =>
      getNotifications(clientA).some(
        n => n.notificationType.tag === 'ProjectDeclined'
      )
    )
  })

  it('clientA deletes the project', async () => {
    await clientA.conn.reducers.deleteProject({ projectId })
    await waitFor(() =>
      getProjects(clientA).find(p => p.id === projectId) === undefined
    )
    // All members and chats cascade-deleted
    const members = getProjectMembers(clientA).filter(m => m.projectId === projectId)
    expect(members.length).toBe(0)
    const chats = getProjectChats(clientA).filter(c => c.projectId === projectId)
    expect(chats.length).toBe(0)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 12. PROJECT SECURITY
// ═════════════════════════════════════════════════════════════════════════════
describe('12. Project Security', () => {
  let projectId: bigint

  it('setup: create a project for security tests', async () => {
    await clientA.conn.reducers.createProject({
      name: 'Security Test Project',
      description: 'For permission testing',
    })
    await waitFor(() =>
      getProjects(clientA).some(p => p.name === 'Security Test Project')
    )
    projectId = getProjects(clientA).find(
      p => p.name === 'Security Test Project'
    )!.id
  })

  it('no-company user cannot create project', async () => {
    await expectError(
      () => clientC.conn.reducers.createProject({ name: 'Fail', description: 'fail' }),
      'Not permitted'
    )
  })

  it('non-owner cannot invite to project', async () => {
    // clientB is not the owner of this project
    await expectError(
      () => clientB.conn.reducers.inviteToProject({
        projectId,
        targetCompanyId: companyAId,
      }),
      'Only the owner company can invite'
    )
  })

  it('invite requires accepted connection', async () => {
    // Disconnect A and B first, then try to invite
    await clientA.conn.reducers.disconnectCompany({ targetCompanyId: companyBId })
    await waitFor(() =>
      getConnections(clientA).find(
        c =>
          c.status.tag === 'Accepted' &&
          ((c.companyA === companyAId && c.companyB === companyBId) ||
            (c.companyA === companyBId && c.companyB === companyAId))
      ) === undefined
    )
    await expectError(
      () => clientA.conn.reducers.inviteToProject({
        projectId,
        targetCompanyId: companyBId,
      }),
      'accepted connection'
    )
    // Re-establish connection for subsequent tests
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
    await clientB.conn.reducers.acceptConnection({ targetCompanyId: companyAId })
    await waitFor(() =>
      getConnections(clientA).some(
        c =>
          c.status.tag === 'Accepted' &&
          ((c.companyA === companyAId && c.companyB === companyBId) ||
            (c.companyA === companyBId && c.companyB === companyAId))
      )
    )
  })

  it('non-member cannot send project chat', async () => {
    // clientB is not a member of this project
    await expectError(
      () => clientB.conn.reducers.sendProjectChat({
        projectId,
        text: 'Intruder message',
      }),
      'not a member'
    )
  })

  it('non-owner cannot kick from project', async () => {
    // Invite and accept B first so they are a member
    await clientA.conn.reducers.inviteToProject({
      projectId,
      targetCompanyId: companyBId,
    })
    await waitFor(() =>
      getProjectMembers(clientA).some(
        m => m.projectId === projectId && m.companyId === companyBId && m.status.tag === 'Invited'
      )
    )
    await clientB.conn.reducers.acceptProjectInvite({ projectId })
    await waitFor(() => {
      const m = getProjectMembers(clientB).find(
        mm => mm.projectId === projectId && mm.companyId === companyBId
      )
      return m?.status.tag === 'Accepted'
    })

    // clientB (non-owner) tries to kick A
    await expectError(
      () => clientB.conn.reducers.kickFromProject({
        projectId,
        targetCompanyId: companyAId,
      }),
      'Only the owner company can kick'
    )
  })

  it('owner cannot kick self', async () => {
    await expectError(
      () => clientA.conn.reducers.kickFromProject({
        projectId,
        targetCompanyId: companyAId,
      }),
      'Cannot kick your own company'
    )
  })

  it('owner cannot leave (must delete)', async () => {
    await expectError(
      () => clientA.conn.reducers.leaveProject({ projectId }),
      'Owner company cannot leave'
    )
  })

  it('non-owner cannot delete project', async () => {
    await expectError(
      () => clientB.conn.reducers.deleteProject({ projectId }),
      'Only the owner company can delete'
    )
  })

  it('no pending invitation — cannot accept', async () => {
    // clientC has no company, but even with a company they have no invite
    await expectError(
      () => clientC.conn.reducers.acceptProjectInvite({ projectId }),
      'Not permitted'
    )
  })

  it('cleanup: delete security test project', async () => {
    await clientA.conn.reducers.deleteProject({ projectId })
    await waitFor(() =>
      getProjects(clientA).find(p => p.id === projectId) === undefined
    )
  })
})
