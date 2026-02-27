use spacetimedb::{Identity, ReducerContext, Table};

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
    pub is_admin: bool,
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
        is_admin: false,
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

    // Link user to company as admin
    ctx.db.user_profile().identity().update(UserProfile {
        company_id: Some(company.id),
        is_admin: true,
        ..profile
    });

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
    let admin = ctx
        .db
        .user_profile()
        .identity()
        .find(ctx.sender())
        .ok_or("Profile not found")?;

    if !admin.is_admin {
        return Err("Only admins can add colleagues".to_string());
    }
    let company_id = admin.company_id.ok_or("You don't belong to a company")?;

    let colleague = ctx
        .db
        .user_profile()
        .identity()
        .find(colleague_identity)
        .ok_or("Colleague profile not found")?;

    if colleague.company_id.is_some() {
        return Err("Colleague already belongs to a company".to_string());
    }

    ctx.db.user_profile().identity().update(UserProfile {
        company_id: Some(company_id),
        ..colleague
    });

    Ok(())
}

/// Admin removes a user from their company.
///
/// # Errors
/// Returns an error if the caller is not an admin, or the colleague is not in
/// the same company. Cannot remove yourself.
#[spacetimedb::reducer]
pub fn remove_colleague(
    ctx: &ReducerContext,
    colleague_identity: Identity,
) -> Result<(), String> {
    if ctx.sender() == colleague_identity {
        return Err("Cannot remove yourself".to_string());
    }

    let admin = ctx
        .db
        .user_profile()
        .identity()
        .find(ctx.sender())
        .ok_or("Profile not found")?;

    if !admin.is_admin {
        return Err("Only admins can remove colleagues".to_string());
    }
    let company_id = admin.company_id.ok_or("You don't belong to a company")?;

    let colleague = ctx
        .db
        .user_profile()
        .identity()
        .find(colleague_identity)
        .ok_or("Colleague profile not found")?;

    if colleague.company_id != Some(company_id) {
        return Err("Colleague is not in your company".to_string());
    }

    ctx.db.user_profile().identity().update(UserProfile {
        company_id: None,
        is_admin: false,
        ..colleague
    });

    Ok(())
}

// ---------------------------------------------------------------------------
// Phase 3 — Public Presence
// ---------------------------------------------------------------------------

/// Admin updates their company's public profile.
///
/// # Errors
/// Returns an error if the caller is not an admin or doesn't belong to a
/// company.
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

    let profile = ctx
        .db
        .user_profile()
        .identity()
        .find(ctx.sender())
        .ok_or("Profile not found")?;

    if !profile.is_admin {
        return Err("Only admins can update the company profile".to_string());
    }
    let company_id = profile.company_id.ok_or("You don't belong to a company")?;

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

/// Admin updates their company's capabilities.
///
/// # Errors
/// Returns an error if the caller is not an admin or doesn't belong to a
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
    let profile = ctx
        .db
        .user_profile()
        .identity()
        .find(ctx.sender())
        .ok_or("Profile not found")?;

    if !profile.is_admin {
        return Err("Only admins can update capabilities".to_string());
    }
    let company_id = profile.company_id.ok_or("You don't belong to a company")?;

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
