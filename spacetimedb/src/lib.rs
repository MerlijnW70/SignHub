use spacetimedb::rand::RngCore;
use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// Six-tier role hierarchy: Owner > Admin > Member > Installer > Field > Pending.
/// Users who join via invite code start as Pending until activated by
/// an Admin or Owner.
#[derive(SpacetimeType, Copy, Clone, Debug, PartialEq, Eq)]
pub enum UserRole {
    Owner,
    Admin,
    Member,
    Installer,
    Field,
    Pending,
}

/// Status of a connection between two companies.
#[derive(SpacetimeType, Copy, Clone, Debug, PartialEq, Eq)]
pub enum ConnectionStatus {
    Pending,
    Accepted,
    Blocked,
}

/// Types of in-app notifications.
#[derive(SpacetimeType, Copy, Clone, Debug, PartialEq, Eq)]
pub enum NotificationType {
    MemberJoined,
    ConnectionRequest,
    ConnectionAccepted,
    ConnectionDeclined,
    ChatMessage,
    RoleChanged,
    MemberRemoved,
    ProjectInvite,
    ProjectAccepted,
    ProjectDeclined,
    ProjectChat,
    ProjectKicked,
    ProjectLeft,
}

/// Status of a company's membership in a project room.
#[derive(SpacetimeType, Copy, Clone, Debug, PartialEq, Eq)]
pub enum ProjectMemberStatus {
    Invited,
    Accepted,
    Left,
    Kicked,
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

/// Tracks which clients are currently connected.
#[spacetimedb::table(accessor = online_user, public)]
pub struct OnlineUser {
    #[primary_key]
    pub identity: Identity,
    pub online: bool,
}

/// A registered user account. Every connected identity that completes sign-up
/// gets one row here. The `active_company_id` tracks which company the user
/// is currently operating as (they may belong to multiple via `CompanyMember`).
#[spacetimedb::table(accessor = user_account, public)]
pub struct UserAccount {
    #[primary_key]
    pub identity: Identity,
    pub full_name: String,
    pub nickname: String,
    pub email: String,
    pub active_company_id: Option<u64>,
    pub created_at: Timestamp,
}

/// Many-to-many mapping between users and companies. A user can belong to
/// multiple companies, each with an independent role.
#[spacetimedb::table(
    accessor = company_member, public,
    index(accessor = member_by_company, btree(columns = [company_id])),
    index(accessor = member_by_identity, btree(columns = [identity]))
)]
pub struct CompanyMember {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub identity: Identity,
    pub company_id: u64,
    pub role: UserRole,
    pub joined_at: Timestamp,
}

/// A sign-shop / company in the directory.
#[spacetimedb::table(accessor = company, public)]
pub struct Company {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub owner_identity: Identity,
    pub name: String,
    #[unique]
    pub slug: String,
    pub location: String,
    pub bio: String,
    pub is_public: bool,
    pub kvk_number: String,
}

/// Invite codes that allow users to join a company without admin hex-pasting.
#[spacetimedb::table(
    accessor = invite_code, public,
    index(accessor = invite_by_company, btree(columns = [company_id]))
)]
pub struct InviteCode {
    #[primary_key]
    #[unique]
    pub code: String,
    pub company_id: u64,
    pub created_by: Identity,
    pub uses_remaining: u32,
}

/// Equipment and service capabilities for a company (1:1 with Company).
#[allow(clippy::struct_excessive_bools)] // Domain model: each capability is an independent flag
#[spacetimedb::table(accessor = capability, public)]
pub struct Capability {
    #[primary_key]
    pub company_id: u64,
    pub can_install: bool,
    pub has_cnc: bool,
    pub has_large_format: bool,
    pub has_bucket_truck: bool,
}

/// A connection between two companies. `company_a` is always the lower ID.
#[spacetimedb::table(
    accessor = company_connection, public,
    index(accessor = conn_by_company_a, btree(columns = [company_a])),
    index(accessor = conn_by_company_b, btree(columns = [company_b]))
)]
pub struct Connection {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub company_a: u64,
    pub company_b: u64,
    pub status: ConnectionStatus,
    pub requested_by: Identity,
    pub blocking_company_id: Option<u64>,
    pub initial_message: String,
    pub created_at: Timestamp,
}

/// Chat messages exchanged within a connection (during Pending or Accepted).
#[spacetimedb::table(
    accessor = connection_chat, public,
    index(accessor = chat_by_connection, btree(columns = [connection_id]))
)]
pub struct ConnectionChat {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub connection_id: u64,
    pub sender: Identity,
    pub text: String,
    pub created_at: Timestamp,
}

/// Records that a user has used a specific invite code. Prevents reuse of the
/// same code by the same user after leaving and rejoining.
#[spacetimedb::table(
    accessor = used_invite_code,
    index(accessor = used_by_identity, btree(columns = [identity]))
)]
pub struct UsedInviteCode {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub identity: Identity,
    pub code: String,
    pub company_id: u64,
}

/// In-app notifications. Each row targets a specific user within a company context.
#[spacetimedb::table(
    accessor = notification, public,
    index(accessor = notif_by_recipient, btree(columns = [recipient_identity]))
)]
pub struct Notification {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub recipient_identity: Identity,
    pub company_id: u64,
    pub notification_type: NotificationType,
    pub title: String,
    pub body: String,
    pub is_read: bool,
    pub created_at: Timestamp,
}

/// A project room where 3+ companies collaborate on a job.
#[spacetimedb::table(accessor = project, public)]
pub struct Project {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub owner_company_id: u64,
    pub name: String,
    pub description: String,
    pub created_by: Identity,
    pub created_at: Timestamp,
}

/// Tracks which companies are members of which projects.
#[spacetimedb::table(
    accessor = project_member, public,
    index(accessor = pm_by_project, btree(columns = [project_id])),
    index(accessor = pm_by_company, btree(columns = [company_id]))
)]
pub struct ProjectMember {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub project_id: u64,
    pub company_id: u64,
    pub status: ProjectMemberStatus,
    pub invited_by: Identity,
    pub joined_at: Timestamp,
}

/// Chat messages within a project room.
#[spacetimedb::table(
    accessor = project_chat, public,
    index(accessor = pchat_by_project, btree(columns = [project_id]))
)]
pub struct ProjectChat {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub project_id: u64,
    pub sender: Identity,
    pub text: String,
    pub created_at: Timestamp,
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/// Maximum allowed string lengths for user-facing fields.
const MAX_FULL_NAME: usize = 50;
const MAX_NICKNAME: usize = 25;
const MAX_EMAIL: usize = 100;
const MAX_COMPANY_NAME: usize = 50;
const MAX_SLUG: usize = 50;
const MAX_LOCATION: usize = 100;
const MAX_BIO: usize = 500;
const MAX_KVK_NUMBER: usize = 20;
const MAX_INVITE_CODE: usize = 25;
const MAX_MESSAGE: usize = 500;
const MAX_PROJECT_NAME: usize = 80;
const MAX_PROJECT_DESCRIPTION: usize = 500;

/// Validates that a trimmed string does not exceed `max_len` characters.
fn validate_length(value: &str, field: &str, max_len: usize) -> Result<(), String> {
    if value.len() > max_len {
        return Err(format!("{field} is too long (max {max_len} characters)"));
    }
    Ok(())
}

/// Validates that a trimmed string is not empty.
fn validate_not_empty(value: &str, field: &str) -> Result<(), String> {
    if value.is_empty() {
        return Err(format!("{field} cannot be empty"));
    }
    Ok(())
}

/// Validates email format: local@domain.tld with structural checks.
fn validate_email(email: &str) -> Result<(), String> {
    let parts: Vec<&str> = email.splitn(2, '@').collect();
    if parts.len() != 2 {
        return Err("Invalid email format".to_string());
    }

    let local = parts[0];
    let domain = parts[1];

    // Local part: non-empty, max 64 chars, no leading/trailing dots
    if local.is_empty() || local.len() > 64 {
        return Err("Invalid email format".to_string());
    }
    if local.starts_with('.') || local.ends_with('.') || local.contains("..") {
        return Err("Invalid email format".to_string());
    }

    // Domain: non-empty, has dot, no leading/trailing/consecutive dots
    if domain.is_empty() || !domain.contains('.') {
        return Err("Invalid email format".to_string());
    }
    if domain.starts_with('.') || domain.ends_with('.') || domain.contains("..") {
        return Err("Invalid email format".to_string());
    }

    // TLD must be at least 2 characters
    let tld = domain.rsplit('.').next().unwrap_or("");
    if tld.len() < 2 {
        return Err("Invalid email format".to_string());
    }

    Ok(())
}

/// Validates that an invite code matches the XXXX-XXXX-XXXX-XXXX format
/// using the unambiguous charset (no 0/O/1/I).
fn validate_invite_code_format(code: &str) -> Result<(), String> {
    const VALID_CHARS: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let parts: Vec<&str> = code.split('-').collect();
    if parts.len() != 4 {
        return Err("Invalid invite code".to_string());
    }
    for part in &parts {
        if part.len() != 4 || !part.bytes().all(|b| VALID_CHARS.contains(&b)) {
            return Err("Invalid invite code".to_string());
        }
    }
    Ok(())
}

/// Normalizes a slug: lowercase, spaces to dashes, collapse consecutive
/// dashes, strip leading/trailing dashes.
fn normalize_slug(raw: &str) -> String {
    let mut slug = raw.trim().to_lowercase().replace(' ', "-");
    // Collapse consecutive dashes
    while slug.contains("--") {
        slug = slug.replace("--", "-");
    }
    // Strip leading/trailing dashes
    slug.trim_matches('-').to_string()
}

/// Truncates a string to at most `max_chars` characters (Unicode-safe)
/// and appends "..." if truncated.
fn truncate_preview(s: &str, max_chars: usize) -> String {
    let mut chars = s.chars();
    let truncated: String = chars.by_ref().take(max_chars).collect();
    if chars.next().is_some() {
        format!("{truncated}...")
    } else {
        truncated
    }
}

/// Formats an Identity for logging (first 12 hex chars).
fn id_short(identity: Identity) -> String {
    let hex = identity.to_hex().to_string();
    if hex.len() > 12 {
        format!("{}...", &hex[..12])
    } else {
        hex
    }
}

// ---------------------------------------------------------------------------
// Notification helpers
// ---------------------------------------------------------------------------

/// Insert a notification for a single recipient.
fn notify(
    ctx: &ReducerContext,
    recipient: Identity,
    company_id: u64,
    notification_type: NotificationType,
    title: String,
    body: String,
) {
    ctx.db.notification().insert(Notification {
        id: 0,
        recipient_identity: recipient,
        company_id,
        notification_type,
        title,
        body,
        is_read: false,
        created_at: ctx.timestamp,
    });
}

/// Insert a notification for all members of a company with at least `min_role`,
/// optionally excluding a specific identity (typically the actor).
fn notify_company_role(
    ctx: &ReducerContext,
    company_id: u64,
    min_role: UserRole,
    exclude: Option<Identity>,
    notification_type: NotificationType,
    title: String,
    body: String,
) {
    let recipients: Vec<Identity> = ctx
        .db
        .company_member()
        .member_by_company()
        .filter(&company_id)
        .filter(|m| role_level(m.role) >= role_level(min_role))
        .filter(|m| exclude != Some(m.identity))
        .map(|m| m.identity)
        .collect();

    for recipient in recipients {
        notify(ctx, recipient, company_id, notification_type, title.clone(), body.clone());
    }
}

// ---------------------------------------------------------------------------
// Project helpers
// ---------------------------------------------------------------------------

fn find_project_membership(
    ctx: &ReducerContext,
    project_id: u64,
    company_id: u64,
    status: ProjectMemberStatus,
) -> Option<ProjectMember> {
    ctx.db
        .project_member()
        .pm_by_project()
        .filter(&project_id)
        .find(|m| m.company_id == company_id && m.status == status)
}

fn delete_project_cascade(ctx: &ReducerContext, project_id: u64) {
    // 1. Delete all chat messages
    let chat_ids: Vec<u64> = ctx
        .db
        .project_chat()
        .pchat_by_project()
        .filter(&project_id)
        .map(|c| c.id)
        .collect();
    for id in chat_ids {
        ctx.db.project_chat().id().delete(id);
    }

    // 2. Delete all members
    let member_ids: Vec<u64> = ctx
        .db
        .project_member()
        .pm_by_project()
        .filter(&project_id)
        .map(|m| m.id)
        .collect();
    for id in member_ids {
        ctx.db.project_member().id().delete(id);
    }

    // 3. Delete notifications for this project (project_id stored in company_id field won't match,
    //    but we can clean up by iterating — projects use their own notification types)

    // 4. Delete the project row
    ctx.db.project().id().delete(project_id);
}

// ---------------------------------------------------------------------------
// Permission helpers
// ---------------------------------------------------------------------------

/// Returns a numeric level for role comparison. Higher = more privileged.
const fn role_level(role: UserRole) -> u8 {
    match role {
        UserRole::Pending => 0,
        UserRole::Field => 1,
        UserRole::Installer => 2,
        UserRole::Member => 3,
        UserRole::Admin => 4,
        UserRole::Owner => 5,
    }
}

/// Finds a user's membership in a specific company, if it exists.
fn find_membership(
    ctx: &ReducerContext,
    identity: Identity,
    company_id: u64,
) -> Option<CompanyMember> {
    ctx.db
        .company_member()
        .member_by_identity()
        .filter(&identity)
        .find(|m| m.company_id == company_id)
}

/// After removing a membership, update the user's `active_company_id` to the
/// next available membership whose company still exists, or `None` if none remain.
fn reassign_active_company(ctx: &ReducerContext, identity: Identity, removed_company_id: u64) {
    if let Some(account) = ctx.db.user_account().identity().find(identity) {
        if account.active_company_id == Some(removed_company_id) {
            let next = ctx
                .db
                .company_member()
                .member_by_identity()
                .filter(&identity)
                .find(|m| ctx.db.company().id().find(m.company_id).is_some());
            ctx.db.user_account().identity().update(UserAccount {
                active_company_id: next.map(|m| m.company_id),
                ..account
            });
        }
    }
}

/// Retrieves the caller's account and verifies they have at least `min_role`
/// in their active company. Returns the account and the active company ID.
///
/// # Errors
///
/// Returns an error if:
/// - The caller has no account.
/// - The caller has no active company.
/// - The caller has no membership in their active company.
/// - The caller's role in that company is below `min_role`.
fn require_role_at_least(
    ctx: &ReducerContext,
    min_role: UserRole,
) -> Result<(UserAccount, u64), String> {
    let account = ctx
        .db
        .user_account()
        .identity()
        .find(ctx.sender())
        .ok_or("Not permitted")?;

    let company_id = account
        .active_company_id
        .ok_or("Not permitted")?;

    // Verify the company still exists
    ctx.db
        .company()
        .id()
        .find(company_id)
        .ok_or("Not permitted")?;

    let membership = find_membership(ctx, ctx.sender(), company_id)
        .ok_or("Not permitted")?;

    if role_level(membership.role) < role_level(min_role) {
        return Err(match min_role {
            UserRole::Owner => "Only the owner can do this".to_string(),
            UserRole::Admin => "Only admins and owners can do this".to_string(),
            UserRole::Member | UserRole::Installer | UserRole::Field | UserRole::Pending => {
                "You do not have permission".to_string()
            }
        });
    }

    Ok((account, company_id))
}

/// Finds an existing connection between two companies (order-independent).
fn find_connection(ctx: &ReducerContext, a: u64, b: u64) -> Option<Connection> {
    let (lo, hi) = if a <= b { (a, b) } else { (b, a) };
    let result = ctx
        .db
        .company_connection()
        .conn_by_company_a()
        .filter(&lo)
        .find(|c| c.company_b == hi);
    result
}

/// Deletes all chat messages associated with a connection.
fn delete_connection_chat(ctx: &ReducerContext, connection_id: u64) {
    let chat_ids: Vec<u64> = ctx
        .db
        .connection_chat()
        .chat_by_connection()
        .filter(&connection_id)
        .map(|c| c.id)
        .collect();
    for id in chat_ids {
        ctx.db.connection_chat().id().delete(id);
    }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

#[spacetimedb::reducer(init)]
pub const fn init(_ctx: &ReducerContext) {}

#[spacetimedb::reducer(client_connected)]
pub fn client_connected(ctx: &ReducerContext) {
    if let Some(user) = ctx.db.online_user().identity().find(ctx.sender()) {
        ctx.db
            .online_user()
            .identity()
            .update(OnlineUser { online: true, ..user });
    } else {
        ctx.db.online_user().insert(OnlineUser {
            identity: ctx.sender(),
            online: true,
        });
    }
}

#[spacetimedb::reducer(client_disconnected)]
pub fn client_disconnected(ctx: &ReducerContext) {
    if let Some(user) = ctx.db.online_user().identity().find(ctx.sender()) {
        ctx.db
            .online_user()
            .identity()
            .update(OnlineUser { online: false, ..user });
    }
}

// ---------------------------------------------------------------------------
// Phase 1 — Onboarding
// ---------------------------------------------------------------------------

/// Register a new user account for the calling identity.
///
/// # Errors
///
/// Returns an error if any field is empty or the account already exists.
#[spacetimedb::reducer]
#[allow(clippy::needless_pass_by_value)]
pub fn create_account(
    ctx: &ReducerContext,
    full_name: String,
    nickname: String,
    email: String,
) -> Result<(), String> {
    let full_name = full_name.trim().to_string();
    let nickname = nickname.trim().to_string();
    let email = email.trim().to_string();

    validate_not_empty(&full_name, "Name")?;
    validate_not_empty(&nickname, "Nickname")?;
    validate_not_empty(&email, "Email")?;
    validate_length(&full_name, "Full name", MAX_FULL_NAME)?;
    validate_length(&nickname, "Nickname", MAX_NICKNAME)?;
    validate_length(&email, "Email", MAX_EMAIL)?;
    validate_email(&email)?;
    if ctx.db.user_account().identity().find(ctx.sender()).is_some() {
        return Err("Account already exists".to_string());
    }

    ctx.db.user_account().insert(UserAccount {
        identity: ctx.sender(),
        full_name,
        nickname,
        email,
        active_company_id: None,
        created_at: ctx.timestamp,
    });

    Ok(())
}

/// User updates their own profile (nickname and email only).
///
/// # Errors
///
/// Returns an error if any field is empty or the account does not exist.
#[spacetimedb::reducer]
#[allow(clippy::needless_pass_by_value)]
pub fn update_profile(
    ctx: &ReducerContext,
    nickname: String,
    email: String,
) -> Result<(), String> {
    let nickname = nickname.trim().to_string();
    let email = email.trim().to_string();

    validate_not_empty(&nickname, "Nickname")?;
    validate_not_empty(&email, "Email")?;
    validate_length(&nickname, "Nickname", MAX_NICKNAME)?;
    validate_length(&email, "Email", MAX_EMAIL)?;
    validate_email(&email)?;

    let account = ctx
        .db
        .user_account()
        .identity()
        .find(ctx.sender())
        .ok_or("Account not found")?;

    ctx.db.user_account().identity().update(UserAccount {
        nickname,
        email,
        ..account
    });

    Ok(())
}

/// Create a new company and link the caller as its owner.
///
/// # Errors
///
/// Returns an error if any required field is empty, the slug is taken,
/// or the caller has no account.
#[spacetimedb::reducer]
#[allow(clippy::needless_pass_by_value)]
pub fn create_company(
    ctx: &ReducerContext,
    name: String,
    slug: String,
    location: String,
) -> Result<(), String> {
    let name = name.trim().to_string();
    let slug = normalize_slug(&slug);
    let location = location.trim().to_string();

    validate_not_empty(&name, "Company name")?;
    validate_not_empty(&slug, "Slug")?;
    validate_not_empty(&location, "Location")?;
    validate_length(&name, "Company name", MAX_COMPANY_NAME)?;
    validate_length(&slug, "Slug", MAX_SLUG)?;
    validate_length(&location, "Location", MAX_LOCATION)?;

    let account = ctx
        .db
        .user_account()
        .identity()
        .find(ctx.sender())
        .ok_or("Account not found")?;

    // Check slug uniqueness (unique constraint will also enforce this)
    if ctx.db.company().slug().find(&slug).is_some() {
        return Err("Slug is already taken".to_string());
    }

    let company = ctx.db.company().insert(Company {
        id: 0,
        owner_identity: ctx.sender(),
        name,
        slug,
        location,
        bio: String::new(),
        is_public: false,
        kvk_number: String::new(),
    });

    // Create default capabilities row
    ctx.db.capability().insert(Capability {
        company_id: company.id,
        can_install: false,
        has_cnc: false,
        has_large_format: false,
        has_bucket_truck: false,
    });

    // Create membership as Owner
    ctx.db.company_member().insert(CompanyMember {
        id: 0,
        identity: ctx.sender(),
        company_id: company.id,
        role: UserRole::Owner,
        joined_at: ctx.timestamp,
    });

    // Set as active company
    ctx.db.user_account().identity().update(UserAccount {
        active_company_id: Some(company.id),
        ..account
    });

    Ok(())
}

/// Admin generates an invite code for their company.
///
/// # Errors
///
/// Returns an error if the caller is below Admin role.
#[spacetimedb::reducer]
pub fn generate_invite_code(ctx: &ReducerContext, max_uses: u32) -> Result<(), String> {
    let (_account, company_id) = require_role_at_least(ctx, UserRole::Admin)?;

    // Build a readable 16-character code (XXXX-XXXX-XXXX-XXXX) from the
    // deterministic RNG. Uses an unambiguous charset (no 0/O/1/I).
    let charset = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let mut code = String::with_capacity(19); // 16 chars + 3 dashes
    let mut rng = ctx.rng();
    for i in 0..16 {
        if i > 0 && i % 4 == 0 {
            code.push('-');
        }
        #[allow(clippy::cast_possible_truncation)] // Modulo charset.len() keeps value small
        let idx = (rng.next_u64() as usize) % charset.len();
        code.push(charset[idx] as char);
    }

    ctx.db.invite_code().insert(InviteCode {
        code,
        company_id,
        created_by: ctx.sender(),
        uses_remaining: if max_uses == 0 { 1 } else { max_uses },
    });

    Ok(())
}

/// User joins a company using an invite code. Users can join multiple
/// companies — each membership is independent with its own role.
///
/// # Errors
///
/// Returns an error if the caller has no account, is already a member of
/// this specific company, the code is invalid, or the code has no remaining uses.
#[spacetimedb::reducer]
#[allow(clippy::needless_pass_by_value)]
pub fn join_company(ctx: &ReducerContext, code: String) -> Result<(), String> {
    let code = code.trim().to_uppercase();
    validate_length(&code, "Invite code", MAX_INVITE_CODE)?;
    validate_invite_code_format(&code)?;

    let account = ctx
        .db
        .user_account()
        .identity()
        .find(ctx.sender())
        .ok_or("Account not found")?;

    let invite = ctx
        .db
        .invite_code()
        .code()
        .find(&code)
        .ok_or("Invalid invite code")?;

    // Check not already a member of THIS company
    if find_membership(ctx, ctx.sender(), invite.company_id).is_some() {
        return Err("You are already a member of this company".to_string());
    }

    if invite.uses_remaining == 0 {
        return Err("Invite code has been fully used".to_string());
    }

    // Check if this user has already used this specific code
    let already_used = ctx
        .db
        .used_invite_code()
        .used_by_identity()
        .filter(&ctx.sender())
        .any(|u| u.code == code);
    if already_used {
        return Err("You have already used this invite code".to_string());
    }

    // Record the usage before linking
    ctx.db.used_invite_code().insert(UsedInviteCode {
        id: 0,
        identity: ctx.sender(),
        code: code.clone(),
        company_id: invite.company_id,
    });

    // Create membership as Pending — an Admin or Owner must activate them
    ctx.db.company_member().insert(CompanyMember {
        id: 0,
        identity: ctx.sender(),
        company_id: invite.company_id,
        role: UserRole::Pending,
        joined_at: ctx.timestamp,
    });

    // Capture before potential move
    let joiner_name = account.nickname.clone();

    // Set as active company if user has no active company
    if account.active_company_id.is_none() {
        ctx.db.user_account().identity().update(UserAccount {
            active_company_id: Some(invite.company_id),
            ..account
        });
    }

    // Decrement uses (or delete if last use).
    // This is atomic: SpacetimeDB reducers are transactional, so the
    // find → check → decrement sequence cannot race with another caller.
    if invite.uses_remaining <= 1 {
        ctx.db.invite_code().code().delete(&code);
    } else {
        ctx.db.invite_code().code().update(InviteCode {
            uses_remaining: invite.uses_remaining - 1,
            ..invite
        });
    }

    // Notify admins/owners that a new member joined
    let company_name = ctx.db.company().id().find(invite.company_id)
        .map(|c| c.name.clone())
        .unwrap_or_default();
    notify_company_role(
        ctx,
        invite.company_id,
        UserRole::Admin,
        Some(ctx.sender()),
        NotificationType::MemberJoined,
        "New member joined".to_string(),
        format!("{} joined {}", joiner_name, company_name),
    );

    Ok(())
}

/// Admin deletes an invite code.
///
/// # Errors
///
/// Returns an error if the caller is below Admin role, the code is not found,
/// or the code belongs to a different company.
#[spacetimedb::reducer]
#[allow(clippy::needless_pass_by_value)]
pub fn delete_invite_code(ctx: &ReducerContext, code: String) -> Result<(), String> {
    let (_account, company_id) = require_role_at_least(ctx, UserRole::Admin)?;

    let invite = ctx
        .db
        .invite_code()
        .code()
        .find(&code)
        .ok_or("Invite code not found")?;

    if invite.company_id != company_id {
        return Err("Invite code not found".to_string());
    }

    ctx.db.invite_code().code().delete(&code);
    Ok(())
}

// ---------------------------------------------------------------------------
// Phase 2 — Team Management
// ---------------------------------------------------------------------------

/// Admin adds another registered user to their company.
///
/// # Errors
///
/// Returns an error if the caller is below Admin role, the colleague is not
/// found, or the colleague is already a member of this company.
#[spacetimedb::reducer]
pub fn add_colleague_by_identity(
    ctx: &ReducerContext,
    colleague_identity: Identity,
) -> Result<(), String> {
    let (_caller, company_id) = require_role_at_least(ctx, UserRole::Admin)?;

    ctx.db
        .user_account()
        .identity()
        .find(colleague_identity)
        .ok_or("Colleague account not found")?;

    if find_membership(ctx, colleague_identity, company_id).is_some() {
        return Err("User is already a member of this company".to_string());
    }

    ctx.db.company_member().insert(CompanyMember {
        id: 0,
        identity: colleague_identity,
        company_id,
        role: UserRole::Member,
        joined_at: ctx.timestamp,
    });

    Ok(())
}

/// Removes a user from the company. Admins can only remove Members, Field,
/// and Pending; Owners can remove anyone except themselves.
///
/// # Errors
///
/// Returns an error if the caller tries to remove themselves, is below Admin
/// role, the colleague is not a member of the same company, or has an
/// equal or higher role than the caller.
#[spacetimedb::reducer]
pub fn remove_colleague(
    ctx: &ReducerContext,
    colleague_identity: Identity,
) -> Result<(), String> {
    if ctx.sender() == colleague_identity {
        return Err("Cannot remove yourself".to_string());
    }

    let (_caller, company_id) = require_role_at_least(ctx, UserRole::Admin)?;

    let caller_membership = find_membership(ctx, ctx.sender(), company_id)
        .ok_or("Not permitted")?;

    let colleague_membership = find_membership(ctx, colleague_identity, company_id)
        .ok_or("Colleague is not in your company")?;

    // Hierarchy: cannot remove someone with equal or higher role
    if role_level(colleague_membership.role) >= role_level(caller_membership.role) {
        return Err("You can only remove members with a lower role than yours".to_string());
    }

    // Delete the membership
    ctx.db.company_member().id().delete(colleague_membership.id);

    // If their active company was this one, reassign
    reassign_active_company(ctx, colleague_identity, company_id);

    log::info!(
        "AUDIT: User {} of Company {} removed colleague {}",
        id_short(ctx.sender()),
        company_id,
        id_short(colleague_identity)
    );

    // Notify the removed colleague
    let company_name = ctx.db.company().id().find(company_id)
        .map(|c| c.name.clone())
        .unwrap_or_default();
    notify(
        ctx,
        colleague_identity,
        company_id,
        NotificationType::MemberRemoved,
        "Removed from company".to_string(),
        format!("You were removed from {}", company_name),
    );

    Ok(())
}

/// Voluntarily leave the active company. Owners must transfer ownership
/// first — they cannot abandon a company.
///
/// # Errors
///
/// Returns an error if the caller has no account, has no active company,
/// has no membership in that company, or is the Owner.
#[spacetimedb::reducer]
pub fn leave_company(ctx: &ReducerContext) -> Result<(), String> {
    let account = ctx
        .db
        .user_account()
        .identity()
        .find(ctx.sender())
        .ok_or("Account not found")?;

    let company_id = account
        .active_company_id
        .ok_or("You do not belong to a company")?;

    let membership = find_membership(ctx, ctx.sender(), company_id)
        .ok_or("You are not a member of this company")?;

    if membership.role == UserRole::Owner {
        return Err("Transfer ownership before leaving the company".to_string());
    }

    // Delete membership
    ctx.db.company_member().id().delete(membership.id);

    // Switch active company to next available, or None
    reassign_active_company(ctx, ctx.sender(), company_id);

    Ok(())
}

/// Switch the user's active company context. The user must have a membership
/// in the target company.
///
/// # Errors
///
/// Returns an error if the caller has no account or is not a member of the
/// target company.
#[spacetimedb::reducer]
pub fn switch_active_company(ctx: &ReducerContext, company_id: u64) -> Result<(), String> {
    let account = ctx
        .db
        .user_account()
        .identity()
        .find(ctx.sender())
        .ok_or("Account not found")?;

    ctx.db
        .company()
        .id()
        .find(company_id)
        .ok_or("Company not found")?;

    find_membership(ctx, ctx.sender(), company_id)
        .ok_or("You are not a member of this company")?;

    ctx.db.user_account().identity().update(UserAccount {
        active_company_id: Some(company_id),
        ..account
    });

    Ok(())
}

// ---------------------------------------------------------------------------
// Phase 3 — Public Presence
// ---------------------------------------------------------------------------

/// Updates the company's public profile. Requires at least Admin role.
///
/// # Errors
///
/// Returns an error if the caller is below Admin role, required fields are
/// empty, or the new slug is already taken by another company.
#[spacetimedb::reducer]
#[allow(clippy::needless_pass_by_value)]
pub fn update_company_profile(
    ctx: &ReducerContext,
    name: String,
    slug: String,
    location: String,
    bio: String,
    is_public: bool,
    kvk_number: String,
) -> Result<(), String> {
    let name = name.trim().to_string();
    let slug = normalize_slug(&slug);
    let location = location.trim().to_string();
    let bio = bio.trim().to_string();
    let kvk_number = kvk_number.trim().to_string();

    validate_not_empty(&name, "Company name")?;
    validate_not_empty(&slug, "Slug")?;
    validate_not_empty(&location, "Location")?;
    validate_length(&name, "Company name", MAX_COMPANY_NAME)?;
    validate_length(&slug, "Slug", MAX_SLUG)?;
    validate_length(&location, "Location", MAX_LOCATION)?;
    validate_length(&bio, "Bio", MAX_BIO)?;
    validate_length(&kvk_number, "KVK number", MAX_KVK_NUMBER)?;

    let (_account, company_id) = require_role_at_least(ctx, UserRole::Admin)?;

    let company = ctx
        .db
        .company()
        .id()
        .find(company_id)
        .ok_or("Company not found")?;

    // If slug changed, check uniqueness
    if slug != company.slug && ctx.db.company().slug().find(&slug).is_some() {
        return Err("Slug is already taken".to_string());
    }

    ctx.db.company().id().update(Company {
        name,
        slug,
        location,
        bio,
        is_public,
        kvk_number,
        ..company
    });

    Ok(())
}

/// Updates the company's capabilities. Requires at least Admin role.
///
/// # Errors
///
/// Returns an error if the caller is below Admin role or capabilities are not
/// found for the company.
#[spacetimedb::reducer]
#[allow(clippy::fn_params_excessive_bools)] // SpacetimeDB reducer: each capability is an independent flag
pub fn update_capabilities(
    ctx: &ReducerContext,
    can_install: bool,
    has_cnc: bool,
    has_large_format: bool,
    has_bucket_truck: bool,
) -> Result<(), String> {
    let (_account, company_id) = require_role_at_least(ctx, UserRole::Admin)?;

    let cap = ctx
        .db
        .capability()
        .company_id()
        .find(company_id)
        .ok_or("Capabilities not found")?;

    ctx.db.capability().company_id().update(Capability {
        can_install,
        has_cnc,
        has_large_format,
        has_bucket_truck,
        ..cap
    });

    Ok(())
}

// ---------------------------------------------------------------------------
// Phase 4 — Role Management
// ---------------------------------------------------------------------------

/// Admin or Owner changes a team member's role in their company.
/// Cannot change your own role or promote someone to Owner (use
/// `transfer_ownership` for that). Admins can only assign roles below
/// their own level; Owners can assign any non-Owner role.
///
/// # Errors
///
/// Returns an error if the caller targets themselves, tries to assign Owner,
/// is below Admin, the target has no membership in the same company,
/// the target has an equal or higher role, or the caller tries to assign
/// a role at or above their own level.
#[spacetimedb::reducer]
pub fn update_user_role(
    ctx: &ReducerContext,
    target_identity: Identity,
    new_role: UserRole,
) -> Result<(), String> {
    if ctx.sender() == target_identity {
        return Err("Cannot change your own role".to_string());
    }

    if new_role == UserRole::Owner {
        return Err("Use transfer_ownership to assign the Owner role".to_string());
    }

    let (_caller, company_id) = require_role_at_least(ctx, UserRole::Admin)?;

    let caller_membership = find_membership(ctx, ctx.sender(), company_id)
        .ok_or("Not permitted")?;

    let target_membership = find_membership(ctx, target_identity, company_id)
        .ok_or("Target is not in your company")?;

    // Cannot change role of someone at or above your level
    if role_level(target_membership.role) >= role_level(caller_membership.role) {
        return Err("Cannot change the role of someone at or above your level".to_string());
    }

    // Cannot promote someone to or above your own level (unless Owner)
    if caller_membership.role != UserRole::Owner
        && role_level(new_role) >= role_level(caller_membership.role)
    {
        return Err("Cannot assign a role at or above your own level".to_string());
    }

    ctx.db.company_member().id().update(CompanyMember {
        role: new_role,
        ..target_membership
    });

    log::info!(
        "AUDIT: User {} of Company {} changed role of {} to {:?}",
        id_short(ctx.sender()),
        company_id,
        id_short(target_identity),
        new_role
    );

    // Notify the target that their role was changed
    let company_name = ctx.db.company().id().find(company_id)
        .map(|c| c.name.clone())
        .unwrap_or_default();
    notify(
        ctx,
        target_identity,
        company_id,
        NotificationType::RoleChanged,
        "Role updated".to_string(),
        format!("Your role in {} was changed to {:?}", company_name, new_role),
    );

    Ok(())
}

/// Transfers company ownership to another team member. The caller (current
/// Owner) is demoted to Admin and the target becomes the new Owner.
/// Also updates `Company.owner_identity`.
///
/// # Errors
///
/// Returns an error if the caller targets themselves, is not the Owner,
/// the target is not found, or the target is not in the same company.
#[spacetimedb::reducer]
pub fn transfer_ownership(
    ctx: &ReducerContext,
    new_owner_identity: Identity,
) -> Result<(), String> {
    if ctx.sender() == new_owner_identity {
        return Err("You are already the owner".to_string());
    }

    let (_caller, company_id) = require_role_at_least(ctx, UserRole::Owner)?;

    let caller_membership = find_membership(ctx, ctx.sender(), company_id)
        .ok_or("Not permitted")?;

    let target_membership = find_membership(ctx, new_owner_identity, company_id)
        .ok_or("Target is not in your company")?;

    // Update company owner reference — double-check caller is the recorded owner
    let company = ctx
        .db
        .company()
        .id()
        .find(company_id)
        .ok_or("Company not found")?;

    if company.owner_identity != ctx.sender() {
        return Err("Only the owner can do this".to_string());
    }

    ctx.db.company().id().update(Company {
        owner_identity: new_owner_identity,
        ..company
    });

    // Demote current owner to Admin (on CompanyMember)
    ctx.db.company_member().id().update(CompanyMember {
        role: UserRole::Admin,
        ..caller_membership
    });

    // Promote target to Owner (on CompanyMember)
    ctx.db.company_member().id().update(CompanyMember {
        role: UserRole::Owner,
        ..target_membership
    });

    log::info!(
        "AUDIT: User {} of Company {} transferred ownership to {}",
        id_short(ctx.sender()),
        company_id,
        id_short(new_owner_identity)
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Phase 5 — Inter-Company Connections
// ---------------------------------------------------------------------------

/// Helper: determine which company the `requested_by` identity belongs to
/// within this connection. Checks membership in both sides of the connection
/// rather than relying on `active_company_id` (which may have changed since
/// the request was made).
///
/// # Errors
///
/// Returns an error if the requesting user is not a member of either company.
fn requesting_company_id(ctx: &ReducerContext, conn: &Connection) -> Result<u64, String> {
    if find_membership(ctx, conn.requested_by, conn.company_a).is_some() {
        return Ok(conn.company_a);
    }
    if find_membership(ctx, conn.requested_by, conn.company_b).is_some() {
        return Ok(conn.company_b);
    }
    Err("Requesting user is not a member of either connected company".to_string())
}

/// Request a connection with another company. If the target has blocked us
/// the call succeeds silently (ghosting — the block is never revealed).
///
/// # Errors
///
/// Returns an error if the caller is below Admin role, targets their own
/// company, the target company does not exist, the message is too long,
/// or a non-blocked connection already exists.
#[spacetimedb::reducer]
#[allow(clippy::needless_pass_by_value)]
pub fn request_connection(
    ctx: &ReducerContext,
    target_company_id: u64,
    message: String,
) -> Result<(), String> {
    let message = message.trim().to_string();
    validate_length(&message, "Message", MAX_MESSAGE)?;

    let (_caller, my_company_id) = require_role_at_least(ctx, UserRole::Admin)?;

    if my_company_id == target_company_id {
        return Err("Cannot connect to your own company".to_string());
    }

    ctx.db
        .company()
        .id()
        .find(target_company_id)
        .ok_or("Target company not found")?;

    if let Some(conn) = find_connection(ctx, my_company_id, target_company_id) {
        if conn.status == ConnectionStatus::Blocked {
            // Ghosting: silently succeed so the block is never revealed
            return Ok(());
        }
        return Err("A connection already exists between these companies".to_string());
    }

    let (lo, hi) = if my_company_id <= target_company_id {
        (my_company_id, target_company_id)
    } else {
        (target_company_id, my_company_id)
    };

    ctx.db.company_connection().insert(Connection {
        id: 0,
        company_a: lo,
        company_b: hi,
        status: ConnectionStatus::Pending,
        requested_by: ctx.sender(),
        blocking_company_id: None,
        initial_message: message,
        created_at: ctx.timestamp,
    });

    // Notify target company admins/owners of the incoming request
    let my_company_name = ctx.db.company().id().find(my_company_id)
        .map(|c| c.name.clone())
        .unwrap_or_default();
    notify_company_role(
        ctx,
        target_company_id,
        UserRole::Admin,
        None,
        NotificationType::ConnectionRequest,
        "Connection request".to_string(),
        format!("{} wants to connect", my_company_name),
    );

    Ok(())
}

/// Cancel a pending connection request. Only the requesting company can cancel.
///
/// # Errors
///
/// Returns an error if the caller is below Admin role, no pending connection
/// exists, or the caller's company is not the requesting side.
#[spacetimedb::reducer]
pub fn cancel_request(
    ctx: &ReducerContext,
    target_company_id: u64,
) -> Result<(), String> {
    let (_caller, my_company_id) = require_role_at_least(ctx, UserRole::Admin)?;

    let conn = find_connection(ctx, my_company_id, target_company_id)
        .ok_or("No connection exists")?;

    if conn.status != ConnectionStatus::Pending {
        return Err("Connection is not pending".to_string());
    }

    if requesting_company_id(ctx, &conn)? != my_company_id {
        return Err("Only the requesting side can cancel a request".to_string());
    }

    delete_connection_chat(ctx, conn.id);
    ctx.db.company_connection().id().delete(conn.id);
    Ok(())
}

/// Accept a pending connection request. Only the non-requesting company
/// can accept.
///
/// # Errors
///
/// Returns an error if the caller is below Admin role, no pending connection
/// exists, or the caller's company is the requesting side.
#[spacetimedb::reducer]
pub fn accept_connection(
    ctx: &ReducerContext,
    target_company_id: u64,
) -> Result<(), String> {
    let (_caller, my_company_id) = require_role_at_least(ctx, UserRole::Admin)?;

    let conn = find_connection(ctx, my_company_id, target_company_id)
        .ok_or("No connection exists")?;

    if conn.status != ConnectionStatus::Pending {
        return Err("Connection is not pending".to_string());
    }

    let requesting_cid = requesting_company_id(ctx, &conn)?;

    if requesting_cid == my_company_id {
        return Err("You cannot accept your own connection request".to_string());
    }

    ctx.db.company_connection().id().update(Connection {
        status: ConnectionStatus::Accepted,
        ..conn
    });

    // Notify the requesting company that their request was accepted
    let my_company_name = ctx.db.company().id().find(my_company_id)
        .map(|c| c.name.clone())
        .unwrap_or_default();
    notify_company_role(
        ctx,
        requesting_cid,
        UserRole::Admin,
        None,
        NotificationType::ConnectionAccepted,
        "Connection accepted".to_string(),
        format!("{} accepted your connection request", my_company_name),
    );

    Ok(())
}

/// Decline a pending connection request (soft reject — deletes the row).
/// Only the non-requesting company can decline.
///
/// # Errors
///
/// Returns an error if the caller is below Admin role, no pending connection
/// exists, or the caller's company is the requesting side.
#[spacetimedb::reducer]
pub fn decline_connection(
    ctx: &ReducerContext,
    target_company_id: u64,
) -> Result<(), String> {
    let (_caller, my_company_id) = require_role_at_least(ctx, UserRole::Admin)?;

    let conn = find_connection(ctx, my_company_id, target_company_id)
        .ok_or("No connection exists")?;

    if conn.status != ConnectionStatus::Pending {
        return Err("Connection is not pending".to_string());
    }

    if requesting_company_id(ctx, &conn)? == my_company_id {
        return Err("You cannot decline your own connection request".to_string());
    }

    // Notify the requesting company that their request was declined
    let requesting_cid = requesting_company_id(ctx, &conn)?;
    let my_company_name = ctx.db.company().id().find(my_company_id)
        .map(|c| c.name.clone())
        .unwrap_or_default();
    notify_company_role(
        ctx,
        requesting_cid,
        UserRole::Admin,
        None,
        NotificationType::ConnectionDeclined,
        "Connection declined".to_string(),
        format!("{} declined your connection request", my_company_name),
    );

    delete_connection_chat(ctx, conn.id);
    ctx.db.company_connection().id().delete(conn.id);
    Ok(())
}

/// Block a company. Works from any state — updates an existing connection to
/// Blocked, or creates a new Blocked row. If already blocked, silently
/// succeeds without overwriting the original `blocked_by`.
///
/// # Errors
///
/// Returns an error if the caller is below Admin role or targets their own
/// company.
#[spacetimedb::reducer]
pub fn block_company(
    ctx: &ReducerContext,
    target_company_id: u64,
) -> Result<(), String> {
    let (_caller, my_company_id) = require_role_at_least(ctx, UserRole::Admin)?;

    if my_company_id == target_company_id {
        return Err("Cannot block your own company".to_string());
    }

    ctx.db
        .company()
        .id()
        .find(target_company_id)
        .ok_or("Target company not found")?;

    if let Some(conn) = find_connection(ctx, my_company_id, target_company_id) {
        if conn.status == ConnectionStatus::Blocked {
            // Already blocked — keep original blocker, silently succeed
            return Ok(());
        }
        ctx.db.company_connection().id().update(Connection {
            status: ConnectionStatus::Blocked,
            blocking_company_id: Some(my_company_id),
            ..conn
        });
    } else {
        let (lo, hi) = if my_company_id <= target_company_id {
            (my_company_id, target_company_id)
        } else {
            (target_company_id, my_company_id)
        };

        ctx.db.company_connection().insert(Connection {
            id: 0,
            company_a: lo,
            company_b: hi,
            status: ConnectionStatus::Blocked,
            requested_by: ctx.sender(),
            blocking_company_id: Some(my_company_id),
            initial_message: String::new(),
            created_at: ctx.timestamp,
        });
    }

    log::info!(
        "AUDIT: User {} of Company {} blocked Company {}",
        id_short(ctx.sender()),
        my_company_id,
        target_company_id
    );

    Ok(())
}

/// Unblock a company. Only the company that performed the block can unblock.
///
/// # Errors
///
/// Returns an error if the caller is below Admin role, no blocked connection
/// exists, or the caller's company is not the one that performed the block.
#[spacetimedb::reducer]
pub fn unblock_company(
    ctx: &ReducerContext,
    target_company_id: u64,
) -> Result<(), String> {
    let (_caller, my_company_id) = require_role_at_least(ctx, UserRole::Admin)?;

    let conn = find_connection(ctx, my_company_id, target_company_id)
        .ok_or("No connection exists")?;

    if conn.status != ConnectionStatus::Blocked {
        return Err("Connection is not blocked".to_string());
    }

    // Only the company that performed the block can unblock
    if let Some(blocker_company) = conn.blocking_company_id {
        if blocker_company != my_company_id {
            return Err("Only the company that blocked can unblock".to_string());
        }
    }

    ctx.db.company_connection().id().delete(conn.id);

    log::info!(
        "AUDIT: User {} of Company {} unblocked Company {}",
        id_short(ctx.sender()),
        my_company_id,
        target_company_id
    );

    Ok(())
}

/// Disconnect from a company. Deletes the Accepted connection row.
///
/// # Errors
///
/// Returns an error if the caller is below Admin role, no connection exists,
/// or the connection is not in Accepted status.
#[spacetimedb::reducer]
pub fn disconnect_company(
    ctx: &ReducerContext,
    target_company_id: u64,
) -> Result<(), String> {
    let (_caller, my_company_id) = require_role_at_least(ctx, UserRole::Admin)?;

    let conn = find_connection(ctx, my_company_id, target_company_id)
        .ok_or("No connection exists")?;

    if conn.status != ConnectionStatus::Accepted {
        return Err("Connection is not active".to_string());
    }

    delete_connection_chat(ctx, conn.id);
    ctx.db.company_connection().id().delete(conn.id);
    Ok(())
}

// ---------------------------------------------------------------------------
// Company Deletion (cascade-aware)
// ---------------------------------------------------------------------------

/// Permanently deletes a company and all associated data. Only the Owner can
/// do this. Cascades to: invite codes, capabilities, connections (+ chat),
/// and unlinks all members.
///
/// # Errors
///
/// Returns an error if the caller is not the Owner or the company is not found.
#[spacetimedb::reducer]
pub fn delete_company(ctx: &ReducerContext) -> Result<(), String> {
    let (_caller, company_id) = require_role_at_least(ctx, UserRole::Owner)?;

    let company = ctx
        .db
        .company()
        .id()
        .find(company_id)
        .ok_or("Company not found")?;

    if company.owner_identity != ctx.sender() {
        return Err("Only the owner can do this".to_string());
    }

    // 1. Delete all invite codes for this company
    let invite_codes: Vec<String> = ctx
        .db
        .invite_code()
        .invite_by_company()
        .filter(&company_id)
        .map(|ic| ic.code)
        .collect();
    for code in invite_codes {
        ctx.db.invite_code().code().delete(&code);
    }

    // 2. Delete all memberships and reassign active companies
    let members: Vec<(u64, Identity)> = ctx
        .db
        .company_member()
        .member_by_company()
        .filter(&company_id)
        .map(|m| (m.id, m.identity))
        .collect();
    for (member_id, member_identity) in &members {
        ctx.db.company_member().id().delete(*member_id);
        reassign_active_company(ctx, *member_identity, company_id);
    }

    // 3. Delete capability row
    ctx.db.capability().company_id().delete(company_id);

    // 4. Delete all connections and their chat messages
    let conn_ids: Vec<u64> = ctx
        .db
        .company_connection()
        .conn_by_company_a()
        .filter(&company_id)
        .map(|c| c.id)
        .collect();
    let conn_ids_b: Vec<u64> = ctx
        .db
        .company_connection()
        .conn_by_company_b()
        .filter(&company_id)
        .map(|c| c.id)
        .collect();
    for conn_id in conn_ids.iter().chain(conn_ids_b.iter()) {
        delete_connection_chat(ctx, *conn_id);
        ctx.db.company_connection().id().delete(*conn_id);
    }

    // 5. Delete all notifications for this company
    let notif_ids: Vec<u64> = ctx
        .db
        .notification()
        .iter()
        .filter(|n| n.company_id == company_id)
        .map(|n| n.id)
        .collect();
    for notif_id in notif_ids {
        ctx.db.notification().id().delete(notif_id);
    }

    // 6. Cascade-delete projects owned by this company
    let owned_project_ids: Vec<u64> = ctx
        .db
        .project()
        .iter()
        .filter(|p| p.owner_company_id == company_id)
        .map(|p| p.id)
        .collect();
    for pid in owned_project_ids {
        delete_project_cascade(ctx, pid);
    }

    // 7. Remove this company from projects it was a member of (not owner)
    //    Collect affected project IDs before deleting memberships, so we can
    //    check for orphaned projects afterward (scoped, not full table scan).
    let affected_project_ids: Vec<u64> = ctx
        .db
        .project_member()
        .pm_by_company()
        .filter(&company_id)
        .map(|m| m.project_id)
        .collect();
    let pm_ids: Vec<u64> = ctx
        .db
        .project_member()
        .pm_by_company()
        .filter(&company_id)
        .map(|m| m.id)
        .collect();
    for pm_id in pm_ids {
        ctx.db.project_member().id().delete(pm_id);
    }

    // 8. Auto-delete any affected projects left with 0 Accepted members
    for pid in affected_project_ids {
        // Project may have already been cascade-deleted in step 6
        if ctx.db.project().id().find(pid).is_none() {
            continue;
        }
        let has_accepted = ctx
            .db
            .project_member()
            .pm_by_project()
            .filter(&pid)
            .any(|m| m.status == ProjectMemberStatus::Accepted);
        if !has_accepted {
            delete_project_cascade(ctx, pid);
        }
    }

    // 9. Delete the company row
    ctx.db.company().id().delete(company_id);

    log::info!(
        "AUDIT: User {} deleted Company {} (name: {}, {} members unlinked)",
        id_short(ctx.sender()),
        company_id,
        company.name,
        members.len()
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Phase 6 — Connection Chat
// ---------------------------------------------------------------------------

/// Send a chat message within a connection. Only allowed when the connection
/// is Pending or Accepted, and the caller belongs to one of the two companies.
///
/// # Errors
///
/// Returns an error if the caller has no account or company, the connection
/// is not found, the connection is Blocked, the caller's company is not
/// part of the connection, or the message is empty or too long.
#[spacetimedb::reducer]
#[allow(clippy::needless_pass_by_value)]
pub fn send_connection_chat(
    ctx: &ReducerContext,
    connection_id: u64,
    text: String,
) -> Result<(), String> {
    let text = text.trim().to_string();
    if text.is_empty() {
        return Err("Message cannot be empty".to_string());
    }
    validate_length(&text, "Message", MAX_MESSAGE)?;

    // Pending users cannot chat — they must be activated first
    let (_account, my_company_id) = require_role_at_least(ctx, UserRole::Field)?;

    let conn = ctx
        .db
        .company_connection()
        .id()
        .find(connection_id)
        .ok_or("Connection not found")?;

    if conn.status == ConnectionStatus::Blocked {
        return Err("Cannot chat on a blocked connection".to_string());
    }

    if conn.company_a != my_company_id && conn.company_b != my_company_id {
        return Err("Your company is not part of this connection".to_string());
    }

    ctx.db.connection_chat().insert(ConnectionChat {
        id: 0,
        connection_id,
        sender: ctx.sender(),
        text: text.clone(),
        created_at: ctx.timestamp,
    });

    // Notify the other company about the new message
    let other_company_id = if conn.company_a == my_company_id {
        conn.company_b
    } else {
        conn.company_a
    };
    let sender_name = _account.nickname.clone();
    let preview = truncate_preview(&text, 50);
    notify_company_role(
        ctx,
        other_company_id,
        UserRole::Field,
        None,
        NotificationType::ChatMessage,
        "New message".to_string(),
        format!("{}: {}", sender_name, preview),
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Phase 7 — Notifications
// ---------------------------------------------------------------------------

/// Mark a single notification as read.
#[spacetimedb::reducer]
pub fn mark_notification_read(ctx: &ReducerContext, notification_id: u64) -> Result<(), String> {
    let notif = ctx
        .db
        .notification()
        .id()
        .find(notification_id)
        .ok_or("Notification not found")?;

    if notif.recipient_identity != ctx.sender() {
        return Err("Not your notification".to_string());
    }

    ctx.db.notification().id().update(Notification {
        is_read: true,
        ..notif
    });

    Ok(())
}

/// Mark all unread notifications as read for the caller within a specific company.
#[spacetimedb::reducer]
pub fn mark_all_notifications_read(ctx: &ReducerContext, company_id: u64) -> Result<(), String> {
    let _account = ctx
        .db
        .user_account()
        .identity()
        .find(ctx.sender())
        .ok_or("Account not found")?;

    let to_update: Vec<Notification> = ctx
        .db
        .notification()
        .notif_by_recipient()
        .filter(&ctx.sender())
        .filter(|n| n.company_id == company_id && !n.is_read)
        .collect();

    for notif in to_update {
        ctx.db.notification().id().update(Notification {
            is_read: true,
            ..notif
        });
    }

    Ok(())
}

/// Delete all read notifications for the caller within a specific company.
#[spacetimedb::reducer]
pub fn clear_notifications(ctx: &ReducerContext, company_id: u64) -> Result<(), String> {
    let _account = ctx
        .db
        .user_account()
        .identity()
        .find(ctx.sender())
        .ok_or("Account not found")?;

    let to_delete: Vec<u64> = ctx
        .db
        .notification()
        .notif_by_recipient()
        .filter(&ctx.sender())
        .filter(|n| n.company_id == company_id && n.is_read)
        .map(|n| n.id)
        .collect();

    for id in to_delete {
        ctx.db.notification().id().delete(id);
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Phase 8 — Projects (Multi-Company Rooms)
// ---------------------------------------------------------------------------

/// Create a new project room. The caller's active company becomes the owner
/// and is automatically added as an Accepted member.
#[spacetimedb::reducer]
pub fn create_project(
    ctx: &ReducerContext,
    name: String,
    description: String,
) -> Result<(), String> {
    let (_account, company_id) = require_role_at_least(ctx, UserRole::Admin)?;

    let name = name.trim().to_string();
    let description = description.trim().to_string();
    validate_not_empty(&name, "Project name")?;
    validate_length(&name, "Project name", MAX_PROJECT_NAME)?;
    validate_length(&description, "Description", MAX_PROJECT_DESCRIPTION)?;

    let project = ctx.db.project().insert(Project {
        id: 0,
        owner_company_id: company_id,
        name: name.clone(),
        description,
        created_by: ctx.sender(),
        created_at: ctx.timestamp,
    });

    // Auto-add creator's company as Accepted member
    ctx.db.project_member().insert(ProjectMember {
        id: 0,
        project_id: project.id,
        company_id,
        status: ProjectMemberStatus::Accepted,
        invited_by: ctx.sender(),
        joined_at: ctx.timestamp,
    });

    log::info!(
        "AUDIT: User {} created Project {} '{}' (owner company {})",
        id_short(ctx.sender()),
        project.id,
        name,
        company_id
    );

    Ok(())
}

/// Invite another company to a project. Only admins+ of the project owner
/// company can invite. Cleans up old Left/Kicked rows before inserting.
#[spacetimedb::reducer]
pub fn invite_to_project(
    ctx: &ReducerContext,
    project_id: u64,
    target_company_id: u64,
) -> Result<(), String> {
    let (_account, company_id) = require_role_at_least(ctx, UserRole::Admin)?;

    let project = ctx
        .db
        .project()
        .id()
        .find(project_id)
        .ok_or("Project not found")?;

    if project.owner_company_id != company_id {
        return Err("Only the owner company can invite".to_string());
    }

    // Target company must exist
    let _target = ctx
        .db
        .company()
        .id()
        .find(target_company_id)
        .ok_or("Target company not found")?;

    if target_company_id == company_id {
        return Err("Cannot invite your own company".to_string());
    }

    // Require an accepted connection between the two companies
    let conn = find_connection(ctx, company_id, target_company_id);
    match conn {
        Some(c) if c.status == ConnectionStatus::Accepted => { /* ok */ }
        _ => return Err("You must have an accepted connection with this company first".to_string()),
    }

    // Check for existing membership
    let existing: Option<ProjectMember> = ctx
        .db
        .project_member()
        .pm_by_project()
        .filter(&project_id)
        .find(|m| m.company_id == target_company_id);

    if let Some(existing_member) = existing {
        match existing_member.status {
            ProjectMemberStatus::Accepted => {
                return Err("Company is already a member of this project".to_string());
            }
            ProjectMemberStatus::Invited => {
                return Err("Company has already been invited".to_string());
            }
            ProjectMemberStatus::Left | ProjectMemberStatus::Kicked => {
                // Clean up old row so we can re-invite
                ctx.db.project_member().id().delete(existing_member.id);
            }
        }
    }

    ctx.db.project_member().insert(ProjectMember {
        id: 0,
        project_id,
        company_id: target_company_id,
        status: ProjectMemberStatus::Invited,
        invited_by: ctx.sender(),
        joined_at: ctx.timestamp,
    });

    // Notify target company admins
    notify_company_role(
        ctx,
        target_company_id,
        UserRole::Admin,
        None,
        NotificationType::ProjectInvite,
        format!("Project invitation: {}", project.name),
        format!(
            "Your company has been invited to join project '{}'",
            project.name
        ),
    );

    log::info!(
        "AUDIT: User {} invited Company {} to Project {} '{}'",
        id_short(ctx.sender()),
        target_company_id,
        project_id,
        project.name
    );

    Ok(())
}

/// Accept a pending project invitation. Caller must be admin+ of the invited company.
#[spacetimedb::reducer]
pub fn accept_project_invite(ctx: &ReducerContext, project_id: u64) -> Result<(), String> {
    let (_account, company_id) = require_role_at_least(ctx, UserRole::Admin)?;

    let project = ctx
        .db
        .project()
        .id()
        .find(project_id)
        .ok_or("Project not found")?;

    let membership = find_project_membership(ctx, project_id, company_id, ProjectMemberStatus::Invited)
        .ok_or("No pending invitation found")?;

    ctx.db.project_member().id().update(ProjectMember {
        status: ProjectMemberStatus::Accepted,
        joined_at: ctx.timestamp,
        ..membership
    });

    let company_name = ctx
        .db
        .company()
        .id()
        .find(company_id)
        .map(|c| c.name.clone())
        .unwrap_or_else(|| "Unknown".to_string());

    // Notify all other Accepted companies' admins
    let other_accepted: Vec<u64> = ctx
        .db
        .project_member()
        .pm_by_project()
        .filter(&project_id)
        .filter(|m| m.status == ProjectMemberStatus::Accepted && m.company_id != company_id)
        .map(|m| m.company_id)
        .collect();

    for cid in other_accepted {
        notify_company_role(
            ctx,
            cid,
            UserRole::Admin,
            None,
            NotificationType::ProjectAccepted,
            format!("{} joined project", company_name),
            format!(
                "{} accepted the invitation to project '{}'",
                company_name, project.name
            ),
        );
    }

    log::info!(
        "AUDIT: Company {} accepted invite to Project {} '{}'",
        company_id,
        project_id,
        project.name
    );

    Ok(())
}

/// Decline a pending project invitation. Deletes the Invited row.
#[spacetimedb::reducer]
pub fn decline_project_invite(ctx: &ReducerContext, project_id: u64) -> Result<(), String> {
    let (_account, company_id) = require_role_at_least(ctx, UserRole::Admin)?;

    let project = ctx
        .db
        .project()
        .id()
        .find(project_id)
        .ok_or("Project not found")?;

    let membership = find_project_membership(ctx, project_id, company_id, ProjectMemberStatus::Invited)
        .ok_or("No pending invitation found")?;

    ctx.db.project_member().id().delete(membership.id);

    let company_name = ctx
        .db
        .company()
        .id()
        .find(company_id)
        .map(|c| c.name.clone())
        .unwrap_or_else(|| "Unknown".to_string());

    // Notify owner company admins
    notify_company_role(
        ctx,
        project.owner_company_id,
        UserRole::Admin,
        None,
        NotificationType::ProjectDeclined,
        format!("{} declined project invite", company_name),
        format!(
            "{} declined the invitation to project '{}'",
            company_name, project.name
        ),
    );

    log::info!(
        "AUDIT: Company {} declined invite to Project {} '{}'",
        company_id,
        project_id,
        project.name
    );

    Ok(())
}

/// Send a chat message in a project room. Caller must be Field+ in an Accepted
/// member company. Fan-out notifications to all other Accepted companies.
#[spacetimedb::reducer]
pub fn send_project_chat(
    ctx: &ReducerContext,
    project_id: u64,
    text: String,
) -> Result<(), String> {
    let (account, company_id) = require_role_at_least(ctx, UserRole::Field)?;

    let project = ctx
        .db
        .project()
        .id()
        .find(project_id)
        .ok_or("Project not found")?;

    // Caller's company must be an Accepted member
    find_project_membership(ctx, project_id, company_id, ProjectMemberStatus::Accepted)
        .ok_or("Your company is not a member of this project")?;

    let text = text.trim().to_string();
    validate_not_empty(&text, "Message")?;
    validate_length(&text, "Message", MAX_MESSAGE)?;

    ctx.db.project_chat().insert(ProjectChat {
        id: 0,
        project_id,
        sender: ctx.sender(),
        text: text.clone(),
        created_at: ctx.timestamp,
    });

    let sender_name = account.nickname.clone();
    let company_name = ctx
        .db
        .company()
        .id()
        .find(company_id)
        .map(|c| c.name.clone())
        .unwrap_or_else(|| "Unknown".to_string());
    let preview = truncate_preview(&text, 80);

    // Notify all other Accepted companies (Field+)
    let other_accepted: Vec<u64> = ctx
        .db
        .project_member()
        .pm_by_project()
        .filter(&project_id)
        .filter(|m| m.status == ProjectMemberStatus::Accepted && m.company_id != company_id)
        .map(|m| m.company_id)
        .collect();

    for cid in other_accepted {
        notify_company_role(
            ctx,
            cid,
            UserRole::Field,
            None,
            NotificationType::ProjectChat,
            format!("{} — {}", project.name, company_name),
            format!("[{}] {}: {}", company_name, sender_name, preview),
        );
    }

    log::info!(
        "AUDIT: User {} sent chat in Project {} (company {})",
        id_short(ctx.sender()),
        project_id,
        company_id
    );

    Ok(())
}

/// Leave a project. The owner company cannot leave (must delete the project).
/// If no Accepted members remain after leaving, the project is auto-deleted.
#[spacetimedb::reducer]
pub fn leave_project(ctx: &ReducerContext, project_id: u64) -> Result<(), String> {
    let (_account, company_id) = require_role_at_least(ctx, UserRole::Admin)?;

    let project = ctx
        .db
        .project()
        .id()
        .find(project_id)
        .ok_or("Project not found")?;

    if project.owner_company_id == company_id {
        return Err("Owner company cannot leave. Delete the project instead.".to_string());
    }

    let membership = find_project_membership(ctx, project_id, company_id, ProjectMemberStatus::Accepted)
        .ok_or("Your company is not a member of this project")?;

    ctx.db.project_member().id().update(ProjectMember {
        status: ProjectMemberStatus::Left,
        ..membership
    });

    let company_name = ctx
        .db
        .company()
        .id()
        .find(company_id)
        .map(|c| c.name.clone())
        .unwrap_or_else(|| "Unknown".to_string());

    // Notify other Accepted companies' admins
    let other_accepted: Vec<u64> = ctx
        .db
        .project_member()
        .pm_by_project()
        .filter(&project_id)
        .filter(|m| m.status == ProjectMemberStatus::Accepted && m.company_id != company_id)
        .map(|m| m.company_id)
        .collect();

    for cid in &other_accepted {
        notify_company_role(
            ctx,
            *cid,
            UserRole::Admin,
            None,
            NotificationType::ProjectLeft,
            format!("{} left project", company_name),
            format!(
                "{} left project '{}'",
                company_name, project.name
            ),
        );
    }

    log::info!(
        "AUDIT: User {} (Company {}) left Project {} '{}'",
        id_short(ctx.sender()),
        company_id,
        project_id,
        project.name
    );

    // If no Accepted members remain at all, auto-delete the project
    let remaining_accepted = ctx
        .db
        .project_member()
        .pm_by_project()
        .filter(&project_id)
        .any(|m| m.status == ProjectMemberStatus::Accepted);
    if !remaining_accepted {
        delete_project_cascade(ctx, project_id);
        log::info!(
            "AUDIT: Project {} '{}' auto-deleted (no accepted members remain)",
            project_id,
            project.name
        );
    }

    Ok(())
}

/// Kick a company from a project. Only the owner company's admins can kick.
#[spacetimedb::reducer]
pub fn kick_from_project(
    ctx: &ReducerContext,
    project_id: u64,
    target_company_id: u64,
) -> Result<(), String> {
    let (_account, company_id) = require_role_at_least(ctx, UserRole::Admin)?;

    let project = ctx
        .db
        .project()
        .id()
        .find(project_id)
        .ok_or("Project not found")?;

    if project.owner_company_id != company_id {
        return Err("Only the owner company can kick members".to_string());
    }

    if target_company_id == company_id {
        return Err("Cannot kick your own company".to_string());
    }

    let membership = find_project_membership(ctx, project_id, target_company_id, ProjectMemberStatus::Accepted)
        .ok_or("Target company is not an active member")?;

    ctx.db.project_member().id().update(ProjectMember {
        status: ProjectMemberStatus::Kicked,
        ..membership
    });

    let target_name = ctx
        .db
        .company()
        .id()
        .find(target_company_id)
        .map(|c| c.name.clone())
        .unwrap_or_else(|| "Unknown".to_string());

    // Notify kicked company's admins
    notify_company_role(
        ctx,
        target_company_id,
        UserRole::Admin,
        None,
        NotificationType::ProjectKicked,
        format!("Removed from project '{}'", project.name),
        format!(
            "Your company has been removed from project '{}'",
            project.name
        ),
    );

    // Notify other remaining Accepted companies' admins
    let other_accepted: Vec<u64> = ctx
        .db
        .project_member()
        .pm_by_project()
        .filter(&project_id)
        .filter(|m| {
            m.status == ProjectMemberStatus::Accepted
                && m.company_id != company_id
                && m.company_id != target_company_id
        })
        .map(|m| m.company_id)
        .collect();

    for cid in other_accepted {
        notify_company_role(
            ctx,
            cid,
            UserRole::Admin,
            None,
            NotificationType::ProjectKicked,
            format!("{} removed from project", target_name),
            format!(
                "{} was removed from project '{}'",
                target_name, project.name
            ),
        );
    }

    log::info!(
        "AUDIT: User {} kicked Company {} from Project {} '{}'",
        id_short(ctx.sender()),
        target_company_id,
        project_id,
        project.name
    );

    Ok(())
}

/// Delete a project entirely. Only the owner company's admins can delete.
/// Cascade-deletes all members and chat messages.
#[spacetimedb::reducer]
pub fn delete_project(ctx: &ReducerContext, project_id: u64) -> Result<(), String> {
    let (_account, company_id) = require_role_at_least(ctx, UserRole::Admin)?;

    let project = ctx
        .db
        .project()
        .id()
        .find(project_id)
        .ok_or("Project not found")?;

    if project.owner_company_id != company_id {
        return Err("Only the owner company can delete the project".to_string());
    }

    let project_name = project.name.clone();

    // Notify all other Accepted members before deleting
    let other_accepted: Vec<u64> = ctx
        .db
        .project_member()
        .pm_by_project()
        .filter(&project_id)
        .filter(|m| m.status == ProjectMemberStatus::Accepted && m.company_id != company_id)
        .map(|m| m.company_id)
        .collect();

    for cid in other_accepted {
        notify_company_role(
            ctx,
            cid,
            UserRole::Admin,
            None,
            NotificationType::ProjectLeft,
            format!("Project '{}' deleted", project_name),
            format!(
                "Project '{}' has been deleted by the owner",
                project_name
            ),
        );
    }

    delete_project_cascade(ctx, project_id);

    log::info!(
        "AUDIT: User {} deleted Project {} '{}'",
        id_short(ctx.sender()),
        project_id,
        project_name
    );

    Ok(())
}
