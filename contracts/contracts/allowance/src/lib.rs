#![no_std]

//! Stellar Allowance — an on-chain spending mandate.
//!
//! The owner deposits USDC and sets rules. The agent holds no funds; it can only ask this
//! contract to pay, and every request is checked against the rules before any money moves.

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error, token,
    Address, Env, Symbol, Vec,
};

/// Hard cap on window history length, so a busy agent cannot grow the entry unboundedly.
pub const MAX_HISTORY: u32 = 200;

#[contracttype]
#[derive(Clone)]
pub struct Rules {
    /// Most that may move in a single call.
    pub max_per_call: i128,
    /// Width of the rolling window, in ledgers. ~17280 ≈ 1 day; use ~60 for a demo.
    pub window_ledgers: u32,
    /// Most that may move in total across the window.
    pub window_cap: i128,
    /// Addresses the agent is permitted to pay.
    pub allowlist: Vec<Address>,
}

#[contracttype]
#[derive(Clone)]
pub struct SpendEntry {
    pub amount: i128,
    pub ledger: u32,
}

#[contracttype]
#[derive(Clone)]
pub struct Window {
    pub history: Vec<SpendEntry>,
    pub cached_total: i128,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Owner,
    Agent,
    Token,
    Native,
    Rules,
    Revoked,
    Window,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum AllowanceError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    InvalidAmount = 3,
    Revoked = 4,
    ExceedsPerCall = 5,
    RecipientNotAllowed = 6,
    ExceedsWindow = 7,
    HistoryFull = 8,
}

#[contractevent]
#[derive(Clone)]
pub struct Deposited {
    #[topic]
    pub from: Address,
    pub amount: i128,
}

#[contractevent]
#[derive(Clone)]
pub struct Withdrawn {
    #[topic]
    pub to: Address,
    pub amount: i128,
}

/// Emitted on every allowed spend. The gateway reads `reference` back off the chain to
/// prove this payment settles the challenge it issued — see BUILD_PLAN, "the ref binding".
#[contractevent]
#[derive(Clone)]
pub struct SpendRecorded {
    #[topic]
    pub to: Address,
    #[topic]
    pub reference: Symbol,
    pub amount: i128,
}

#[contractevent]
#[derive(Clone)]
pub struct AgentRevoked {
    #[topic]
    pub owner: Address,
}

#[contractevent]
#[derive(Clone)]
pub struct AgentResumed {
    #[topic]
    pub owner: Address,
}

#[contract]
pub struct Allowance;

#[contractimpl]
impl Allowance {
    /// Runs once, at deployment, and does everything the owner is setting up.
    ///
    /// The owner deploys this themselves, so their single signature both creates the contract
    /// and funds it. Stellar allows a transaction carrying a Soroban call to carry nothing
    /// else, so creating and funding could never be two operations in one transaction — but
    /// they can be one operation, because a deploy runs its constructor inside the same
    /// invocation.
    ///
    /// `require_auth` on the owner covers both nested token transfers through the auth tree,
    /// which is what keeps this to one confirmation.
    ///
    /// The agent is set here and nowhere else. No function can change it, which is a stronger
    /// guarantee than a runtime guard and a shorter thing to audit: every allowlist decision
    /// this contract makes is on behalf of exactly one key, forever.
    ///
    /// `native` is the native XLM asset contract. A contract can only move a token by calling
    /// a token contract, and no host function returns the native one — so it has to be told,
    /// once, rather than on every call where it could be passed wrongly.
    ///
    /// Both amounts may be zero. Setting up now and funding later is a real workflow; the UI
    /// discourages it rather than this refusing it.
    pub fn __constructor(
        env: Env,
        owner: Address,
        token: Address,
        native: Address,
        agent: Address,
        rules: Rules,
        usdc_in: i128,
        xlm_to_agent: i128,
    ) {
        // A constructor cannot return an error, so this panics. A negative amount is a client
        // bug, and letting one through would silently reverse a transfer's direction.
        if usdc_in < 0 || xlm_to_agent < 0 {
            panic_with_error!(&env, AllowanceError::InvalidAmount);
        }
        owner.require_auth();

        env.storage().instance().set(&DataKey::Owner, &owner);
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage().instance().set(&DataKey::Native, &native);
        env.storage().instance().set(&DataKey::Agent, &agent);
        env.storage().instance().set(&DataKey::Rules, &rules);
        env.storage().instance().set(&DataKey::Revoked, &false);

        if usdc_in > 0 {
            token::TokenClient::new(&env, &token).transfer(
                &owner,
                &env.current_contract_address(),
                &usdc_in,
            );
            Deposited { from: owner.clone(), amount: usdc_in }.publish(&env);
        }

        if xlm_to_agent > 0 {
            // Straight from the owner to the agent. This contract never holds XLM.
            token::TokenClient::new(&env, &native).transfer(&owner, &agent, &xlm_to_agent);
        }
    }

    /// Everything the owner changes afterwards, in one invocation and one signature.
    ///
    /// Replaces `deposit` and `set_rules`. Changing a rate limit while adding credits used to
    /// be two confirmations; it is one. What that leaves is a contract where money departs
    /// through exactly two named functions — `withdraw` and `spend` — a property an auditor can
    /// establish from the function list alone.
    ///
    /// `rules: None` means *leave them alone*, never *clear them*. The caller sends a diff of
    /// what the owner actually touched, so an edit that only added credits must not arrive
    /// carrying an allowlist and overwrite the real one.
    ///
    /// `write(None, 0, 0)` is a legal no-op, because that diff is legitimately empty when the
    /// owner changed only the name — which this contract does not store.
    ///
    /// The owner is loaded, not passed. `deposit` used to take a `from` purely to check it
    /// against the owner already in storage, which is an argument that can be wrong for no
    /// benefit. The agent is not a parameter at all: it cannot change.
    ///
    /// Rules are applied before money moves, so a rejected rule change cannot leave funds
    /// sitting against rules that were never applied.
    pub fn write(
        env: Env,
        rules: Option<Rules>,
        usdc_in: i128,
        xlm_to_agent: i128,
    ) -> Result<(), AllowanceError> {
        if usdc_in < 0 || xlm_to_agent < 0 {
            return Err(AllowanceError::InvalidAmount);
        }
        let owner = require_owner(&env)?;

        if let Some(rules) = rules {
            env.storage().instance().set(&DataKey::Rules, &rules);
        }

        if usdc_in > 0 {
            let token_address = token_address(&env)?;
            token::TokenClient::new(&env, &token_address).transfer(
                &owner,
                &env.current_contract_address(),
                &usdc_in,
            );
            Deposited { from: owner.clone(), amount: usdc_in }.publish(&env);
        }

        if xlm_to_agent > 0 {
            let agent: Address = env
                .storage()
                .instance()
                .get(&DataKey::Agent)
                .ok_or(AllowanceError::NotInitialized)?;
            let native: Address = env
                .storage()
                .instance()
                .get(&DataKey::Native)
                .ok_or(AllowanceError::NotInitialized)?;
            token::TokenClient::new(&env, &native).transfer(&owner, &agent, &xlm_to_agent);
        }

        Ok(())
    }

    /// Owner reclaims funds. No rules apply — the rules constrain the agent, not the owner.
    ///
    /// The destination is the stored owner and is deliberately not a parameter. Freighter shows
    /// a Soroban invocation as a contract call, not as "sending 100 USDC to G…", so a signature
    /// over a caller-supplied destination would not be meaningful review of that destination.
    /// Fixed, the worst this path can do is give the owner their own money back.
    ///
    /// The outbound transfer needs no signature: the contract is the executing contract, so
    /// its own `require_auth` is satisfied by Contract Invoker authorization.
    pub fn withdraw(env: Env, amount: i128) -> Result<(), AllowanceError> {
        if amount <= 0 {
            return Err(AllowanceError::InvalidAmount);
        }
        let owner = require_owner(&env)?;

        let token_address = token_address(&env)?;
        token::TokenClient::new(&env, &token_address).transfer(
            &env.current_contract_address(),
            &owner,
            &amount,
        );

        Withdrawn { to: owner, amount }.publish(&env);
        Ok(())
    }

    /// The agent asks to pay. Every rule is checked before a single unit moves.
    ///
    /// `reference` is the challenge id the gateway issued in its 402. It is emitted in the
    /// event so the gateway can prove this payment settles that specific request.
    pub fn spend(
        env: Env,
        to: Address,
        amount: i128,
        reference: Symbol,
    ) -> Result<(), AllowanceError> {
        if amount <= 0 {
            return Err(AllowanceError::InvalidAmount);
        }

        let revoked: bool = env
            .storage()
            .instance()
            .get(&DataKey::Revoked)
            .unwrap_or(false);
        if revoked {
            return Err(AllowanceError::Revoked);
        }

        // The agent is the transaction source, so this needs no separate auth entry.
        let agent: Address = env
            .storage()
            .instance()
            .get(&DataKey::Agent)
            .ok_or(AllowanceError::NotInitialized)?;
        agent.require_auth();

        let rules: Rules = env
            .storage()
            .instance()
            .get(&DataKey::Rules)
            .ok_or(AllowanceError::NotInitialized)?;

        if amount > rules.max_per_call {
            return Err(AllowanceError::ExceedsPerCall);
        }
        if !rules.allowlist.contains(&to) {
            return Err(AllowanceError::RecipientNotAllowed);
        }

        let (mut window, total) = prune(&env, load_window(&env), rules.window_ledgers);
        if total + amount > rules.window_cap {
            return Err(AllowanceError::ExceedsWindow);
        }
        if window.history.len() >= MAX_HISTORY {
            return Err(AllowanceError::HistoryFull);
        }

        window.history.push_back(SpendEntry {
            amount,
            ledger: env.ledger().sequence(),
        });
        window.cached_total += amount;
        env.storage().persistent().set(&DataKey::Window, &window);

        let token_address = token_address(&env)?;
        token::TokenClient::new(&env, &token_address).transfer(
            &env.current_contract_address(),
            &to,
            &amount,
        );

        SpendRecorded {
            to,
            reference,
            amount,
        }
        .publish(&env);

        Ok(())
    }

    /// Immediate, total stop. Moves no money, so it cannot fail for balance reasons —
    /// which is exactly what you want from an emergency brake.
    ///
    /// Reversible by `resume`, and deliberately so. A brake you cannot release is not a brake;
    /// it is a demolition. Recovering from one would mean creating another allowance, handing
    /// the agent another key, and moving the money across — three steps to undo a click made in
    /// a moment of doubt.
    pub fn revoke(env: Env) -> Result<(), AllowanceError> {
        let owner = require_owner(&env)?;
        env.storage().instance().set(&DataKey::Revoked, &true);
        AgentRevoked { owner }.publish(&env);
        Ok(())
    }

    /// Lets the agent spend again, under whatever the rules now say.
    ///
    /// No security is given up by allowing this. Only the owner can stop it and only the owner
    /// can start it again, and the rules are checked on every spend either way — so a resumed
    /// allowance is no more permissive than it was before it was stopped.
    ///
    /// The spend window is untouched, exactly as a rule change leaves it. An agent that hit its
    /// cap, was stopped, and is started again does not get a fresh window out of the round trip.
    pub fn resume(env: Env) -> Result<(), AllowanceError> {
        let owner = require_owner(&env)?;
        env.storage().instance().set(&DataKey::Revoked, &false);
        AgentResumed { owner }.publish(&env);
        Ok(())
    }

    /// Total spent inside the current rolling window. Read-only: prunes in memory and
    /// deliberately does not persist, or every balance check would become a write.
    pub fn spent_in_window(env: Env) -> Result<i128, AllowanceError> {
        let rules: Rules = env
            .storage()
            .instance()
            .get(&DataKey::Rules)
            .ok_or(AllowanceError::NotInitialized)?;
        let (_, total) = prune(&env, load_window(&env), rules.window_ledgers);
        Ok(total)
    }

    /// How much the agent may still spend before the window cap stops it.
    pub fn remaining(env: Env) -> Result<i128, AllowanceError> {
        let rules: Rules = env
            .storage()
            .instance()
            .get(&DataKey::Rules)
            .ok_or(AllowanceError::NotInitialized)?;
        let (_, total) = prune(&env, load_window(&env), rules.window_ledgers);
        Ok(rules.window_cap - total)
    }

    pub fn revoked(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Revoked)
            .unwrap_or(false)
    }

    /// USDC currently held by this contract.
    pub fn balance(env: Env) -> Result<i128, AllowanceError> {
        let token_address = token_address(&env)?;
        Ok(token::TokenClient::new(&env, &token_address).balance(&env.current_contract_address()))
    }

    pub fn config(env: Env) -> Result<Rules, AllowanceError> {
        env.storage()
            .instance()
            .get(&DataKey::Rules)
            .ok_or(AllowanceError::NotInitialized)
    }

    /// Who owns this allowance.
    ///
    /// Public on purpose. The claim this product makes is that one named person controls this
    /// money and the platform cannot touch it — and a claim nobody can check from outside is
    /// not worth much. Anyone holding a contract id can settle it here.
    pub fn owner(env: Env) -> Result<Address, AllowanceError> {
        env.storage()
            .instance()
            .get(&DataKey::Owner)
            .ok_or(AllowanceError::NotInitialized)
    }

    /// The one key permitted to ask this contract to spend. Set at construction, never after.
    pub fn agent(env: Env) -> Result<Address, AllowanceError> {
        env.storage()
            .instance()
            .get(&DataKey::Agent)
            .ok_or(AllowanceError::NotInitialized)
    }
}

fn require_owner(env: &Env) -> Result<Address, AllowanceError> {
    let owner: Address = env
        .storage()
        .instance()
        .get(&DataKey::Owner)
        .ok_or(AllowanceError::NotInitialized)?;
    owner.require_auth();
    Ok(owner)
}

fn load_window(env: &Env) -> Window {
    env.storage()
        .persistent()
        .get(&DataKey::Window)
        .unwrap_or(Window {
            history: Vec::new(env),
            cached_total: 0,
        })
}

/// Drops entries that have aged out of the window, decrementing the cached total as it goes.
/// Returns the pruned window and the amount still counted against the cap.
///
/// This is a genuinely rolling window: entries expire individually by age. A "reset the
/// counter when the period ends" version is a *tumbling* window and would let an agent spend
/// twice the cap across the boundary.
fn prune(env: &Env, mut window: Window, window_ledgers: u32) -> (Window, i128) {
    let sequence = env.ledger().sequence();

    // Guard, not an optimisation: `saturating_sub` would clamp the cutoff to 0 while the
    // chain is younger than the window, and then prune entries recorded at ledger 0 as
    // though they had aged out. If the chain is younger than the window, nothing can be old
    // enough to expire.
    if sequence > window_ledgers {
        let cutoff = sequence - window_ledgers;
        while let Some(entry) = window.history.get(0) {
            if entry.ledger <= cutoff {
                window.cached_total -= entry.amount;
                window.history.pop_front();
            } else {
                break;
            }
        }
    }

    let total = window.cached_total;
    (window, total)
}

fn token_address(env: &Env) -> Result<Address, AllowanceError> {
    env.storage()
        .instance()
        .get(&DataKey::Token)
        .ok_or(AllowanceError::NotInitialized)
}

mod test;
