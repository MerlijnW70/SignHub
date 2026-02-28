use spacetimedb::rand::RngCore;
use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// Four-tier role hierarchy: Owner > Admin > Member > Field.
#[derive(SpacetimeType, Copy, Clone, Debug, PartialEq, Eq)]
pub enum UserRole {
    Owner,
    Admin,
    Member,
    Field,
}

/// Status of a connection between two companies.
#[derive(SpacetimeType, Copy, Clone, Debug, PartialEq, Eq)]
pub enum ConnectionStatus {
    Pending,
    Accepted,
    Blocked,
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
/// gets one row here.
#[spacetimedb::table(
    accessor = user_account, public,
    index(accessor = account_by_company, btree(columns = [company_id]))
)]
pub struct UserAccount {
    #[primary_key]
    pub identity: Identity,
    pub full_name: String,
    pub nickname: String,
    pub email: String,
    pub company_id: Option<u64>,
    pub role: UserRole,
    pub created_at: Timestamp,
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
// Permission helpers
// ---------------------------------------------------------------------------

/// Returns a numeric level for role comparison. Higher = more privileged.
const fn role_level(role: UserRole) -> u8 {
    match role {
        UserRole::Field => 0,
        UserRole::Member => 1,
        UserRole::Admin => 2,
        UserRole::Owner => 3,
    }
}

/// Retrieves the caller's account and verifies they have at least `min_role`.
/// Returns the account and the `company_id` on success.
///
/// # Errors
///
/// Returns an error if:
/// - The caller has no account.
/// - The caller does not belong to a company.
/// - The caller's role is below `min_role`.
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
        .company_id
        .ok_or("Not permitted")?;

    if role_level(account.role) < role_level(min_role) {
        return Err(match min_role {
            UserRole::Owner => "Only the owner can do this".to_string(),
            UserRole::Admin => "Only admins and owners can do this".to_string(),
            UserRole::Member | UserRole::Field => "You do not have permission".to_string(),
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
        company_id: None,
        role: UserRole::Member,
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
/// the caller has no account, or the caller already belongs to a company.
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

    if account.company_id.is_some() {
        return Err("You already belong to a company".to_string());
    }

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

    // Link user to company as owner
    ctx.db.user_account().identity().update(UserAccount {
        company_id: Some(company.id),
        role: UserRole::Owner,
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

/// User joins a company using an invite code.
///
/// # Errors
///
/// Returns an error if the caller has no account, already belongs to a company,
/// the code is invalid, or the code has no remaining uses.
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

    if account.company_id.is_some() {
        return Err("You already belong to a company".to_string());
    }

    let invite = ctx
        .db
        .invite_code()
        .code()
        .find(&code)
        .ok_or("Invalid invite code")?;

    if invite.uses_remaining == 0 {
        return Err("Invite code has been fully used".to_string());
    }

    // Link user to the company as a member
    ctx.db.user_account().identity().update(UserAccount {
        company_id: Some(invite.company_id),
        role: UserRole::Member,
        ..account
    });

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
/// found, or the colleague already belongs to a company.
#[spacetimedb::reducer]
pub fn add_colleague_by_identity(
    ctx: &ReducerContext,
    colleague_identity: Identity,
) -> Result<(), String> {
    let (_caller, company_id) = require_role_at_least(ctx, UserRole::Admin)?;

    let colleague = ctx
        .db
        .user_account()
        .identity()
        .find(colleague_identity)
        .ok_or("Colleague account not found")?;

    if colleague.company_id.is_some() {
        return Err("Cannot add this user".to_string());
    }

    ctx.db.user_account().identity().update(UserAccount {
        company_id: Some(company_id),
        role: UserRole::Member,
        ..colleague
    });

    Ok(())
}

/// Removes a user from the company. Admins can only remove Members and Field;
/// Owners can remove anyone except themselves.
///
/// # Errors
///
/// Returns an error if the caller tries to remove themselves, is below Admin
/// role, the colleague is not found, is not in the same company, or has an
/// equal or higher role than the caller.
#[spacetimedb::reducer]
pub fn remove_colleague(
    ctx: &ReducerContext,
    colleague_identity: Identity,
) -> Result<(), String> {
    if ctx.sender() == colleague_identity {
        return Err("Cannot remove yourself".to_string());
    }

    let (caller, company_id) = require_role_at_least(ctx, UserRole::Admin)?;

    let colleague = ctx
        .db
        .user_account()
        .identity()
        .find(colleague_identity)
        .ok_or("Colleague account not found")?;

    if colleague.company_id != Some(company_id) {
        return Err("Colleague is not in your company".to_string());
    }

    // Hierarchy: cannot remove someone with equal or higher role
    if role_level(colleague.role) >= role_level(caller.role) {
        return Err("You can only remove members with a lower role than yours".to_string());
    }

    ctx.db.user_account().identity().update(UserAccount {
        company_id: None,
        role: UserRole::Member,
        ..colleague
    });

    log::info!(
        "AUDIT: User {} of Company {} removed colleague {}",
        id_short(ctx.sender()),
        company_id,
        id_short(colleague_identity)
    );

    Ok(())
}

/// Voluntarily leave your current company. Owners must transfer ownership
/// first — they cannot abandon a company.
///
/// # Errors
///
/// Returns an error if the caller has no account, does not belong to a
/// company, or is the Owner.
#[spacetimedb::reducer]
pub fn leave_company(ctx: &ReducerContext) -> Result<(), String> {
    let account = ctx
        .db
        .user_account()
        .identity()
        .find(ctx.sender())
        .ok_or("Account not found")?;

    account
        .company_id
        .ok_or("You do not belong to a company")?;

    if account.role == UserRole::Owner {
        return Err("Transfer ownership before leaving the company".to_string());
    }

    ctx.db.user_account().identity().update(UserAccount {
        company_id: None,
        role: UserRole::Member,
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

/// Owner changes a team member's role. Only the Owner can change roles.
/// Cannot change your own role or promote someone to Owner (use
/// `transfer_ownership` for that).
///
/// # Errors
///
/// Returns an error if the caller targets themselves, tries to assign Owner,
/// is not the Owner, the target is not found or not in the same company,
/// or the target is already an Owner.
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

    let (_caller, company_id) = require_role_at_least(ctx, UserRole::Owner)?;

    let target = ctx
        .db
        .user_account()
        .identity()
        .find(target_identity)
        .ok_or("Target user not found")?;

    if target.company_id != Some(company_id) {
        return Err("Target is not in your company".to_string());
    }

    if target.role == UserRole::Owner {
        return Err("Cannot change the role of another Owner".to_string());
    }

    ctx.db.user_account().identity().update(UserAccount {
        role: new_role,
        ..target
    });

    log::info!(
        "AUDIT: User {} of Company {} changed role of {} to {:?}",
        id_short(ctx.sender()),
        company_id,
        id_short(target_identity),
        new_role
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

    let (caller, company_id) = require_role_at_least(ctx, UserRole::Owner)?;

    let target = ctx
        .db
        .user_account()
        .identity()
        .find(new_owner_identity)
        .ok_or("Target user not found")?;

    if target.company_id != Some(company_id) {
        return Err("Target is not in your company".to_string());
    }

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

    // Demote current owner to Admin
    ctx.db.user_account().identity().update(UserAccount {
        role: UserRole::Admin,
        ..caller
    });

    // Promote target to Owner
    ctx.db.user_account().identity().update(UserAccount {
        role: UserRole::Owner,
        ..target
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

/// Helper: determine which company the `requested_by` identity belongs to.
///
/// # Errors
///
/// Returns an error if the requesting user or their company cannot be found.
fn requesting_company_id(ctx: &ReducerContext, conn: &Connection) -> Result<u64, String> {
    let account = ctx
        .db
        .user_account()
        .identity()
        .find(conn.requested_by)
        .ok_or("Requesting user not found")?;
    account
        .company_id
        .ok_or_else(|| "Requesting user has no company".to_string())
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

    if requesting_company_id(ctx, &conn)? == my_company_id {
        return Err("You cannot accept your own connection request".to_string());
    }

    ctx.db.company_connection().id().update(Connection {
        status: ConnectionStatus::Accepted,
        ..conn
    });

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

    // 2. Unlink all members (set company_id = None, role = Member)
    let member_ids: Vec<Identity> = ctx
        .db
        .user_account()
        .iter()
        .filter(|a| a.company_id == Some(company_id))
        .map(|a| a.identity)
        .collect();
    for member_id in &member_ids {
        if let Some(account) = ctx.db.user_account().identity().find(*member_id) {
            ctx.db.user_account().identity().update(UserAccount {
                company_id: None,
                role: UserRole::Member,
                ..account
            });
        }
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

    // 5. Delete the company row
    ctx.db.company().id().delete(company_id);

    log::info!(
        "AUDIT: User {} deleted Company {} (name: {}, {} members unlinked)",
        id_short(ctx.sender()),
        company_id,
        company.name,
        member_ids.len()
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

    let account = ctx
        .db
        .user_account()
        .identity()
        .find(ctx.sender())
        .ok_or("Account not found")?;

    let my_company_id = account
        .company_id
        .ok_or("You must belong to a company first")?;

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
        text,
        created_at: ctx.timestamp,
    });

    Ok(())
}
