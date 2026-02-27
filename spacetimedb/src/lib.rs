use spacetimedb::rand::RngCore;
use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// Three-tier role hierarchy: Owner > Manager > Member.
#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum UserRole {
    Owner,
    Manager,
    Member,
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
#[spacetimedb::table(accessor = user_profile, public)]
pub struct UserProfile {
    #[primary_key]
    pub identity: Identity,
    pub company_id: Option<u64>,
    pub full_name: String,
    pub email: String,
    pub role: UserRole,
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
}

/// Invite codes that allow users to join a company without admin hex-pasting.
#[spacetimedb::table(accessor = invite_code, public)]
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

// ---------------------------------------------------------------------------
// Permission helpers
// ---------------------------------------------------------------------------

/// Returns a numeric level for role comparison. Higher = more privileged.
fn role_level(role: &UserRole) -> u8 {
    match role {
        UserRole::Member => 0,
        UserRole::Manager => 1,
        UserRole::Owner => 2,
    }
}

/// Retrieves the caller's profile and verifies they have at least `min_role`.
/// Returns the profile and the company_id on success.
fn require_role_at_least(
    ctx: &ReducerContext,
    min_role: UserRole,
) -> Result<(UserProfile, u64), String> {
    let profile = ctx
        .db
        .user_profile()
        .identity()
        .find(ctx.sender())
        .ok_or("Create a profile first")?;

    let company_id = profile
        .company_id
        .ok_or("You must belong to a company first")?;

    if role_level(&profile.role) < role_level(&min_role) {
        return Err(match min_role {
            UserRole::Owner => "Only the owner can do this".to_string(),
            UserRole::Manager => "Only managers and owners can do this".to_string(),
            UserRole::Member => "You do not have permission".to_string(),
        });
    }

    Ok((profile, company_id))
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

/// Register a new user profile for the calling identity.
///
/// # Errors
/// Returns an error if the name or email is empty, or if the identity already
/// has a profile.
#[spacetimedb::reducer]
#[allow(clippy::needless_pass_by_value)]
pub fn create_user_profile(
    ctx: &ReducerContext,
    full_name: String,
    email: String,
) -> Result<(), String> {
    let full_name = full_name.trim().to_string();
    let email = email.trim().to_string();

    if full_name.is_empty() {
        return Err("Name cannot be empty".to_string());
    }
    if email.is_empty() {
        return Err("Email cannot be empty".to_string());
    }
    if ctx.db.user_profile().identity().find(ctx.sender()).is_some() {
        return Err("Profile already exists".to_string());
    }

    ctx.db.user_profile().insert(UserProfile {
        identity: ctx.sender(),
        company_id: None,
        full_name,
        email,
        role: UserRole::Member,
    });

    Ok(())
}

/// Create a new company and link the caller as its admin owner.
///
/// # Errors
/// Returns an error if the caller has no profile, already belongs to a
/// company, or if the name/slug/location is empty.
#[spacetimedb::reducer]
#[allow(clippy::needless_pass_by_value)]
pub fn create_company(
    ctx: &ReducerContext,
    name: String,
    slug: String,
    location: String,
) -> Result<(), String> {
    let name = name.trim().to_string();
    let slug = slug.trim().to_lowercase().replace(' ', "-");
    let location = location.trim().to_string();

    if name.is_empty() {
        return Err("Company name cannot be empty".to_string());
    }
    if slug.is_empty() {
        return Err("Slug cannot be empty".to_string());
    }
    if location.is_empty() {
        return Err("Location cannot be empty".to_string());
    }

    let profile = ctx
        .db
        .user_profile()
        .identity()
        .find(ctx.sender())
        .ok_or("Create a profile first")?;

    if profile.company_id.is_some() {
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
    ctx.db.user_profile().identity().update(UserProfile {
        company_id: Some(company.id),
        role: UserRole::Owner,
        ..profile
    });

    Ok(())
}

/// Admin generates an invite code for their company.
///
/// # Errors
/// Returns an error if the caller is not an admin or doesn't belong to a
/// company.
#[spacetimedb::reducer]
pub fn generate_invite_code(ctx: &ReducerContext, max_uses: u32) -> Result<(), String> {
    let (_profile, company_id) = require_role_at_least(ctx, UserRole::Manager)?;

    // Build a short readable code from the deterministic RNG
    let charset = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I ambiguity
    let mut code = String::with_capacity(8);
    let mut rng = ctx.rng();
    for i in 0..8 {
        if i == 4 {
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
/// Returns an error if the caller has no profile, already belongs to a
/// company, or the code is invalid/exhausted.
#[spacetimedb::reducer]
#[allow(clippy::needless_pass_by_value)]
pub fn join_company(ctx: &ReducerContext, code: String) -> Result<(), String> {
    let code = code.trim().to_uppercase();

    let profile = ctx
        .db
        .user_profile()
        .identity()
        .find(ctx.sender())
        .ok_or("Create a profile first")?;

    if profile.company_id.is_some() {
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
    ctx.db.user_profile().identity().update(UserProfile {
        company_id: Some(invite.company_id),
        role: UserRole::Member,
        ..profile
    });

    // Decrement uses (or delete if last use)
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
/// Returns an error if the caller is not an admin or the code doesn't belong
/// to their company.
#[spacetimedb::reducer]
#[allow(clippy::needless_pass_by_value)]
pub fn delete_invite_code(ctx: &ReducerContext, code: String) -> Result<(), String> {
    let (_profile, company_id) = require_role_at_least(ctx, UserRole::Manager)?;

    let invite = ctx
        .db
        .invite_code()
        .code()
        .find(&code)
        .ok_or("Invite code not found")?;

    if invite.company_id != company_id {
        return Err("Invite code belongs to a different company".to_string());
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
/// Returns an error if the caller is not an admin, the colleague has no
/// profile, or the colleague already belongs to a company.
#[spacetimedb::reducer]
pub fn add_colleague_by_identity(
    ctx: &ReducerContext,
    colleague_identity: Identity,
) -> Result<(), String> {
    let (_caller, company_id) = require_role_at_least(ctx, UserRole::Manager)?;

    let colleague = ctx
        .db
        .user_profile()
        .identity()
        .find(colleague_identity)
        .ok_or("Colleague profile not found")?;

    if colleague.company_id.is_some() {
        return Err("This user already belongs to a company".to_string());
    }

    ctx.db.user_profile().identity().update(UserProfile {
        company_id: Some(company_id),
        role: UserRole::Member,
        ..colleague
    });

    Ok(())
}

/// Removes a user from the company. Managers can only remove Members;
/// Owners can remove anyone except themselves.
///
/// # Errors
/// Returns an error if the caller lacks permission, the colleague is not in
/// the same company, or the caller tries to remove themselves.
#[spacetimedb::reducer]
pub fn remove_colleague(
    ctx: &ReducerContext,
    colleague_identity: Identity,
) -> Result<(), String> {
    if ctx.sender() == colleague_identity {
        return Err("Cannot remove yourself".to_string());
    }

    let (caller, company_id) = require_role_at_least(ctx, UserRole::Manager)?;

    let colleague = ctx
        .db
        .user_profile()
        .identity()
        .find(colleague_identity)
        .ok_or("Colleague profile not found")?;

    if colleague.company_id != Some(company_id) {
        return Err("Colleague is not in your company".to_string());
    }

    // Hierarchy: cannot remove someone with equal or higher role
    if role_level(&colleague.role) >= role_level(&caller.role) {
        return Err("You can only remove members with a lower role than yours".to_string());
    }

    ctx.db.user_profile().identity().update(UserProfile {
        company_id: None,
        role: UserRole::Member,
        ..colleague
    });

    Ok(())
}

// ---------------------------------------------------------------------------
// Phase 3 — Public Presence
// ---------------------------------------------------------------------------

/// Updates the company's public profile. Requires at least Manager role.
///
/// # Errors
/// Returns an error if the caller lacks permission, doesn't belong to a
/// company, or the name/slug is invalid.
#[spacetimedb::reducer]
#[allow(clippy::needless_pass_by_value)]
pub fn update_company_profile(
    ctx: &ReducerContext,
    name: String,
    slug: String,
    location: String,
    bio: String,
    is_public: bool,
) -> Result<(), String> {
    let name = name.trim().to_string();
    let slug = slug.trim().to_lowercase().replace(' ', "-");
    let location = location.trim().to_string();
    let bio = bio.trim().to_string();

    if name.is_empty() {
        return Err("Company name cannot be empty".to_string());
    }
    if slug.is_empty() {
        return Err("Slug cannot be empty".to_string());
    }

    let (_profile, company_id) = require_role_at_least(ctx, UserRole::Manager)?;

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
        ..company
    });

    Ok(())
}

/// Updates the company's capabilities. Requires at least Manager role.
///
/// # Errors
/// Returns an error if the caller lacks permission or doesn't belong to a
/// company.
#[spacetimedb::reducer]
#[allow(clippy::fn_params_excessive_bools)] // SpacetimeDB reducer: each capability is an independent flag
pub fn update_capabilities(
    ctx: &ReducerContext,
    can_install: bool,
    has_cnc: bool,
    has_large_format: bool,
    has_bucket_truck: bool,
) -> Result<(), String> {
    let (_profile, company_id) = require_role_at_least(ctx, UserRole::Manager)?;

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
/// Returns an error if the caller is not the Owner, the target is not in the
/// same company, or the new role is Owner.
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
        .user_profile()
        .identity()
        .find(target_identity)
        .ok_or("Target user not found")?;

    if target.company_id != Some(company_id) {
        return Err("Target is not in your company".to_string());
    }

    if target.role == UserRole::Owner {
        return Err("Cannot change the role of another Owner".to_string());
    }

    ctx.db.user_profile().identity().update(UserProfile {
        role: new_role,
        ..target
    });

    Ok(())
}

/// Transfers company ownership to another team member. The caller (current
/// Owner) is demoted to Manager and the target becomes the new Owner.
/// Also updates `Company.owner_identity`.
///
/// # Errors
/// Returns an error if the caller is not the Owner or the target is not in
/// the same company.
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
        .user_profile()
        .identity()
        .find(new_owner_identity)
        .ok_or("Target user not found")?;

    if target.company_id != Some(company_id) {
        return Err("Target is not in your company".to_string());
    }

    // Update company owner reference
    let company = ctx
        .db
        .company()
        .id()
        .find(company_id)
        .ok_or("Company not found")?;

    ctx.db.company().id().update(Company {
        owner_identity: new_owner_identity,
        ..company
    });

    // Demote current owner to Manager
    ctx.db.user_profile().identity().update(UserProfile {
        role: UserRole::Manager,
        ..caller
    });

    // Promote target to Owner
    ctx.db.user_profile().identity().update(UserProfile {
        role: UserRole::Owner,
        ..target
    });

    Ok(())
}
