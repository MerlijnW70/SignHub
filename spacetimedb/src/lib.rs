use spacetimedb::{Identity, ReducerContext, Table};

// Tracks connected clients
#[spacetimedb::table(accessor = user, public)]
pub struct User {
    #[primary_key]
    pub identity: Identity,
    pub online: bool,
}

#[spacetimedb::table(accessor = person, public)]
pub struct Person {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub owner: Identity,
    pub name: String,
}

#[spacetimedb::reducer(init)]
pub const fn init(_ctx: &ReducerContext) {
    // Called when the module is first published
}

#[spacetimedb::reducer(client_connected)]
pub fn identity_connected(ctx: &ReducerContext) {
    if let Some(user) = ctx.db.user().identity().find(ctx.sender()) {
        ctx.db.user().identity().update(User { online: true, ..user });
    } else {
        ctx.db.user().insert(User {
            identity: ctx.sender(),
            online: true,
        });
    }
}

#[spacetimedb::reducer(client_disconnected)]
pub fn identity_disconnected(ctx: &ReducerContext) {
    if let Some(user) = ctx.db.user().identity().find(ctx.sender()) {
        ctx.db.user().identity().update(User { online: false, ..user });
    }
}

/// Insert a new person owned by the caller.
///
/// # Errors
/// Returns an error if the name is empty or whitespace-only.
#[spacetimedb::reducer]
#[allow(clippy::needless_pass_by_value)] // SpacetimeDB reducers require owned types
pub fn add(ctx: &ReducerContext, name: String) -> Result<(), String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("Name cannot be empty".to_string());
    }
    ctx.db.person().insert(Person {
        id: 0,
        owner: ctx.sender(),
        name,
    });
    Ok(())
}

/// Update the name of a person the caller owns.
///
/// # Errors
/// Returns an error if the name is empty, the person doesn't exist, or the caller isn't the owner.
#[spacetimedb::reducer]
#[allow(clippy::needless_pass_by_value)] // SpacetimeDB reducers require owned types
pub fn update_person_name(ctx: &ReducerContext, id: u64, name: String) -> Result<(), String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("Name cannot be empty".to_string());
    }
    let person = ctx.db.person().id().find(id).ok_or("Person not found")?;
    if person.owner != ctx.sender() {
        return Err("Not the owner".to_string());
    }
    ctx.db.person().id().update(Person { name, ..person });
    Ok(())
}

/// Delete a person the caller owns.
///
/// # Errors
/// Returns an error if the person doesn't exist or the caller isn't the owner.
#[spacetimedb::reducer]
pub fn delete_person(ctx: &ReducerContext, id: u64) -> Result<(), String> {
    let person = ctx.db.person().id().find(id).ok_or("Person not found")?;
    if person.owner != ctx.sender() {
        return Err("Not the owner".to_string());
    }
    ctx.db.person().id().delete(id);
    Ok(())
}

#[spacetimedb::reducer]
pub fn say_hello(ctx: &ReducerContext) {
    for person in ctx.db.person().iter() {
        log::info!("Hello, {}!", person.name);
    }
    log::info!("Hello, World!");
}
