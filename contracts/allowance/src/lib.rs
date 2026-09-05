#![no_std]

//! Stellar Allowance — an on-chain spending mandate.
//!
//! The owner deposits USDC and sets rules. The agent holds no funds and cannot move any:
//! it can only ask a token contract to pay *from this contract*, and the host then asks
//! `__check_auth` whether that is allowed.

use soroban_sdk::{
    auth::{Context, CustomAccountInterface},
    contract, contracterror, contractimpl, contracttype,
    crypto::Hash,
    panic_with_error, symbol_short, token, Address, BytesN, Env, TryFromVal, Vec,
};

/// The asset this allowance spends, and what it starts with.
#[contracttype]
#[derive(Clone)]
pub struct Spending {
    pub token_address: Address,
    /// Moved from the owner into the contract at deployment. Zero is legitimate.
    pub initial_deposit: i128,
}

/// Everything an allowance is created with. None of it is stored as a `Setup`: the
/// constructor takes it apart and writes the fields it keeps.
#[contracttype]
#[derive(Clone)]
pub struct Setup {
    pub owner_address: Address,
    /// The agent's raw ed25519 public key, not an account.
    ///
    /// A Stellar account can have its master key removed from its signers while keeping the
    /// same address, so an address is no evidence of who holds a key. This is the key
    /// itself, and what `ed25519_verify` checks a signature against.
    pub agent_key: BytesN<32>,
    pub spending: Spending,
    pub rules: Rules,
}

/// What the owner sets: a rolling spend limit, and the addresses it may be spent on.
#[contracttype]
#[derive(Clone)]
pub struct Rules {
    /// Width of the rolling window, in ledgers. ~17280 is roughly a day.
    pub window_ledgers: u32,
    /// Most that may move in total across that window.
    pub window_cap: i128,
    /// The only addresses the agent may pay.
    pub allowlist: Vec<Address>,
}

/// An allowance as it stands, for anyone who wants to check it.
///
/// Returned rather than stored, so its field names cost bytes in one response and no rent.
#[contracttype]
#[derive(Clone)]
pub struct Config {
    pub owner_address: Address,
    pub agent_key: BytesN<32>,
    pub token_address: Address,
    pub rules: Rules,
    pub enabled: bool,
}

/// Spending is remembered per slice rather than per payment, so the entry is the same size
/// after a million payments as after one.
const SLICES: u32 = 24;

/// One more than there are slices, because the slice we are in has only partly elapsed.
/// With exactly `SLICES` slots the remembered span comes up short and spending ages out
/// early — about 4% over the cap. The extra slot makes the span err long instead.
const SLOTS: usize = SLICES as usize + 1;

/// What the clocks are topped back up to: the seven days an entry is born with, and no
/// further. Rent is charged on the ledgers added, and reaching for a month would make the
/// first payment past the threshold pay six times the facilitator's fee ceiling at once.
const TTL_TARGET: u32 = 120_960;

/// How far a clock may drain before a payment tops it up. `extend_ttl` writes nothing
/// above the threshold, so only the first payment after each hour of drain does any work,
/// and it buys back just that hour — around 2,600 stroops.
const TTL_THRESHOLD: u32 = TTL_TARGET - 720;

/// What the window remembers: a running total per slice, and which slice was written last.
#[contracttype]
#[derive(Clone)]
pub struct Window {
    pub slots: Vec<i128>,
    pub head: u32,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Owner,
    Token,
    AgentKey,
    Rules,
    Window,
    Disabled,
}

/// Discriminants start at 101 so that none of them can be confused with the Stellar
/// Asset Contract's own, which occupy 1-13. A contract error carries no record of which
/// contract raised it, and the token is in the call tree of every payment - so overlapping
/// numbers would have the library reporting the token's failures as this contract's rules.
/// SAC 10 is BalanceError, the commonest real failure of all.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum AllowanceError {
    NotInitialized = 101,
    /// The agent asked to pay someone the owner never approved.
    RecipientNotAllowed = 102,
    /// The invocation being authorised is not a shape this contract recognises.
    MalformedCall = 103,
    /// A transfer of a token this allowance was not set up to spend.
    WrongAsset = 104,
    /// Aimed at the right token, but not an operation the agent may authorise.
    NotATransfer = 105,
    /// More than the rolling window still allows.
    ExceedsWindow = 106,
    /// The owner has stopped the agent.
    Disabled = 107,
    /// An amount that cannot mean what it says.
    InvalidAmount = 108,
}

#[contract]
pub struct Allowance;

#[contractimpl]
impl Allowance {
    /// Runs once, at deployment. Everything set here is set for good — no function can
    /// change the owner, the token or the agent, which is shorter to audit than a guard.
    pub fn __constructor(env: Env, setup: Setup) {
        let Setup {
            owner_address: owner,
            agent_key,
            spending,
            rules,
        } = setup;
        // A constructor cannot return an error, so this panics rather than returning one.
        if spending.initial_deposit < 0 {
            panic_with_error!(&env, AllowanceError::InvalidAmount);
        }

        // Covers the nested transfer through the auth tree, so deploying and funding stay
        // a single confirmation.
        owner.require_auth();

        env.storage().instance().set(&DataKey::Owner, &owner);
        env.storage()
            .instance()
            .set(&DataKey::Token, &spending.token_address);
        env.storage().instance().set(&DataKey::AgentKey, &agent_key);
        env.storage().instance().set(&DataKey::Rules, &rules);

        // A zero deposit is a legitimate deployment: rules now, funding later.
        if spending.initial_deposit != 0 {
            token::TokenClient::new(&env, &spending.token_address).transfer(
                &owner,
                env.current_contract_address(),
                &spending.initial_deposit,
            );
        }
    }

    /// Everything the owner changes afterwards, in one invocation and one signature.
    ///
    /// `rules: None` means *leave them alone*, never *clear them*. The caller sends a diff
    /// of what the owner actually touched, so an edit that only adds credit must not arrive
    /// carrying an allowlist and overwrite the real one.
    ///
    /// The owner is loaded rather than passed. An argument that exists only to be checked
    /// against storage is an argument that can be wrong for no benefit. The agent is not a
    /// parameter at all: it cannot change.
    ///
    /// Rules are applied before money moves, so a rejected rule change cannot leave funds
    /// sitting against rules that were never applied.
    pub fn write(env: Env, rules: Option<Rules>, deposit: i128) -> Result<(), AllowanceError> {
        if deposit < 0 {
            return Err(AllowanceError::InvalidAmount);
        }
        let owner = require_owner(&env)?;

        if let Some(rules) = rules {
            env.storage().instance().set(&DataKey::Rules, &rules);
        }

        if deposit != 0 {
            token::TokenClient::new(&env, &token(&env)?).transfer(
                &owner,
                env.current_contract_address(),
                &deposit,
            );
        }
        Ok(())
    }

    /// The owner takes their own money back. `to` falls back to the stored owner.
    ///
    /// No rule applies. The window and the allowlist constrain the agent; this is not a
    /// payment and is measured against nothing.
    ///
    /// The outbound transfer needs no signature of its own: this contract is the one
    /// executing, so its `require_auth` is satisfied by Contract Invoker authorization.
    /// The signature demanded is the owner's, on the way in.
    ///
    /// A caller-supplied destination is only safe because Freighter renders a Parameters
    /// section and turns an address argument into a readable strkey, so the owner can see
    /// where the money is going before signing. Amounts render as stroops, so the app has
    /// to show the human figure before the owner ever reaches the wallet.
    pub fn withdraw(env: Env, amount: i128, to: Option<Address>) -> Result<(), AllowanceError> {
        if amount <= 0 {
            return Err(AllowanceError::InvalidAmount);
        }
        let owner = require_owner(&env)?;

        let here = env.current_contract_address();
        token::TokenClient::new(&env, &token(&env)?).transfer(&here, to.unwrap_or(owner), &amount);
        Ok(())
    }

    /// Immediate, total stop. Moves no money, so it cannot fail for balance reasons.
    /// Stops the *agent*; the owner can still take their own money out.
    ///
    /// `__check_auth` protects this function not at all — it runs only when the contract
    /// authorises itself inside someone else's transaction, and anything the contract does
    /// during its own invocation is authorised automatically. The owner check here is not
    /// defence in depth, it is the only defence.
    pub fn disable(env: Env) -> Result<(), AllowanceError> {
        require_owner(&env)?;
        env.storage().instance().set(&DataKey::Disabled, &true);
        Ok(())
    }

    /// Lets the agent spend again, under whatever the rules now say. No permissiveness is
    /// gained: every rule is still checked on every payment.
    ///
    /// The spend window is deliberately untouched. A stop and a start is not a way to buy
    /// a fresh budget.
    pub fn enable(env: Env) -> Result<(), AllowanceError> {
        require_owner(&env)?;
        env.storage().instance().set(&DataKey::Disabled, &false);
        Ok(())
    }

    /// Whether the agent may spend. Public because the claim this product makes is that one
    /// named person controls this money, and a claim nobody can check is not worth much.
    pub fn enabled(env: Env) -> bool {
        !disabled(&env)
    }

    /// Everything about an allowance except how much of it is left.
    ///
    /// One call rather than a getter each because instance storage is a single ledger
    /// entry: the host loads all of it however little is asked for, so five getters would
    /// be five loads of the same bytes. The window is left out because it lives in its own
    /// entry on its own clock, and a config read should still answer once that has expired.
    pub fn config(env: Env) -> Result<Config, AllowanceError> {
        Ok(Config {
            owner_address: owner(&env)?,
            agent_key: agent_key(&env)?,
            token_address: token(&env)?,
            rules: rules(&env)?,
            enabled: !disabled(&env),
        })
    }

    /// How much of the cap has already been spent, as of this ledger.
    ///
    /// Answering means ageing the window forward, and that roll is deliberately not saved.
    /// A read that writes would bill the owner a transaction for every glance at a
    /// dashboard, so `rolled_window` returns a copy and only the payment path stores one.
    pub fn spent_in_window(env: Env) -> Result<i128, AllowanceError> {
        let rules = rules(&env)?;
        let (window, _) = rolled_window(&env, rules.window_ledgers);
        Ok(window.slots.iter().sum())
    }
}

fn token(env: &Env) -> Result<Address, AllowanceError> {
    env.storage()
        .instance()
        .get(&DataKey::Token)
        .ok_or(AllowanceError::NotInitialized)
}

fn owner(env: &Env) -> Result<Address, AllowanceError> {
    env.storage()
        .instance()
        .get(&DataKey::Owner)
        .ok_or(AllowanceError::NotInitialized)
}

fn agent_key(env: &Env) -> Result<BytesN<32>, AllowanceError> {
    env.storage()
        .instance()
        .get(&DataKey::AgentKey)
        .ok_or(AllowanceError::NotInitialized)
}

fn rules(env: &Env) -> Result<Rules, AllowanceError> {
    env.storage()
        .instance()
        .get(&DataKey::Rules)
        .ok_or(AllowanceError::NotInitialized)
}

fn disabled(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::Disabled)
        .unwrap_or(false)
}

/// Loads the owner and demands their signature. Every owner-facing function goes through
/// here, so there is one place to look when asking who may do what.
fn require_owner(env: &Env) -> Result<Address, AllowanceError> {
    let owner = owner(env)?;
    owner.require_auth();
    Ok(owner)
}

#[contractimpl]
impl CustomAccountInterface for Allowance {
    type Signature = BytesN<64>;
    type Error = AllowanceError;

    /// The agent proves it authorised this exact transaction.
    ///
    /// `payload` is the 32-byte hash the host built from the network id, the nonce, the
    /// expiration ledger and the whole invocation tree — so a signature over it cannot be
    /// replayed onto a different call, a different network, or a second time. It is never
    /// transmitted: both sides derive it independently.
    ///
    /// `ed25519_verify` panics rather than returning, so a forged signature aborts the
    /// transaction with a host error and no contract error code. Only rule refusals below
    /// get a discriminant the library can name.
    fn __check_auth(
        env: Env,
        payload: Hash<32>,
        signature: BytesN<64>,
        contexts: Vec<Context>,
    ) -> Result<(), AllowanceError> {
        // First, and cheapest: whole-contract state, so a stopped agent never pays for an
        // ed25519 verification it was going to fail anyway.
        if disabled(&env) {
            return Err(AllowanceError::Disabled);
        }

        let agent_key = agent_key(&env)?;

        env.crypto()
            .ed25519_verify(&agent_key, &payload.into(), &signature);

        let rules = rules(&env)?;
        let token = token(&env)?;

        let (mut window, slice) = rolled_window(&env, rules.window_ledgers);
        let mut total: i128 = window.slots.iter().sum();
        let mut added: i128 = 0;

        // Every invocation the signature would cover, not just the first. A signature
        // authorises the whole tree, so a rule checked on one entry and skipped on the
        // next is not a rule.
        for context in contexts.iter() {
            let call = match context {
                Context::Contract(call) => call,
                // This contract never creates contracts, so nothing else is legitimate.
                _ => return Err(AllowanceError::MalformedCall),
            };

            // Other token functions take arguments of the same types in the same
            // positions, so neither check below can tell them apart. The name is what
            // separates paying someone from granting them a claim on the balance.
            if call.fn_name != symbol_short!("transfer") {
                return Err(AllowanceError::NotATransfer);
            }

            // Recipient and amount are read positionally below, which only means anything
            // against the standard token interface — and which interface sits behind that
            // address is the owner's choice, not this contract's.
            if call.args.len() != 3 {
                return Err(AllowanceError::MalformedCall);
            }

            // Which asset is being moved lives here, not in the arguments. Without it an
            // amount is unitless, and every rule expressed as a number is meaningless.
            if call.contract != token {
                return Err(AllowanceError::WrongAsset);
            }

            let to = call
                .args
                .get(1)
                .and_then(|arg| Address::try_from_val(&env, &arg).ok())
                .ok_or(AllowanceError::MalformedCall)?;

            if !rules.allowlist.contains(&to) {
                return Err(AllowanceError::RecipientNotAllowed);
            }

            let amount = call
                .args
                .get(2)
                .and_then(|arg| i128::try_from_val(&env, &arg).ok())
                .ok_or(AllowanceError::MalformedCall)?;

            // Against the window, not against the call. With nothing spent yet this still
            // refuses a single payment larger than the whole budget.
            total += amount;
            if total > rules.window_cap {
                return Err(AllowanceError::ExceedsWindow);
            }
            added += amount;
        }

        let here = slice % SLOTS as u32;
        window
            .slots
            .set(here, window.slots.get(here).unwrap_or(0) + added);
        env.storage().persistent().set(&DataKey::Window, &window);

        // Neither invoking a contract nor writing to it extends anything, both measured, so
        // without this the allowance stops working about a week after deployment.
        //
        // Through the deployer interface rather than `storage().instance().extend_ttl`,
        // which also extends the contract *code*. Rent scales with entry size and the code
        // entry is two orders of magnitude larger than the instance, so extending it costs
        // multiples of the facilitator's fee ceiling — every payment refused, for a reason
        // mentioning neither TTL nor rent.
        env.deployer().extend_ttl_for_contract_instance(
            env.current_contract_address(),
            TTL_THRESHOLD,
            TTL_TARGET,
        );
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Window, TTL_THRESHOLD, TTL_TARGET);

        Ok(())
    }
}

/// Loads the window and empties the slices that have aged out of it, returning the window
/// and the slice we are in now.
///
/// Slices expire one at a time as the ledger advances, which is what makes this window
/// roll. A counter reset on a fixed boundary would let an agent spend the whole cap on
/// either side of that boundary, moments apart.
fn rolled_window(env: &Env, window_ledgers: u32) -> (Window, u32) {
    // Never zero: a window narrower than the slice count still gets a ledger per slice,
    // which makes it wider than asked rather than a division by zero.
    let width = (window_ledgers / SLICES).max(1);
    let slice = env.ledger().sequence() / width;

    let mut window: Window = env
        .storage()
        .persistent()
        .get(&DataKey::Window)
        .unwrap_or(Window {
            slots: Vec::from_array(env, [0i128; SLOTS]),
            head: slice,
        });

    if slice > window.head {
        // Anything older than a full turn of the ring is gone regardless, so never clear
        // more slots than exist.
        let stale = (slice - window.head).min(SLOTS as u32);
        for n in 1..=stale {
            window.slots.set((window.head + n) % SLOTS as u32, 0);
        }
        window.head = slice;
    }

    (window, slice)
}

mod test;
