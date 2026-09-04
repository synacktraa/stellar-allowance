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
    Address, BytesN, Env, TryFromVal, Vec,
};

/// What the owner sets. Three numbers, not four: the per-call cap collapsed into the
/// rolling window, because one call larger than the whole window cap is already refused
/// by the window itself.
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

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Owner,
    Token,
    AgentKey,
    Rules,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum AllowanceError {
    NotInitialized = 1,
    /// The agent asked to pay someone the owner never approved.
    RecipientNotAllowed = 2,
    /// The invocation being authorised is not a shape this contract recognises.
    MalformedCall = 3,
    /// A transfer of a token this allowance was not set up to spend.
    WrongAsset = 4,
}

#[contract]
pub struct Allowance;

#[contractimpl]
impl Allowance {
    /// Runs once, at deployment.
    ///
    /// The agent is a raw ed25519 public key rather than an `Address`, because
    /// `__check_auth` has to verify a signature against it and an `Address` cannot be
    /// turned back into key bytes. It is set here and by nothing else: no function can
    /// change it, which is a shorter thing to audit than a runtime guard.
    pub fn __constructor(
        env: Env,
        owner: Address,
        token: Address,
        agent_key: BytesN<32>,
        rules: Rules,
    ) {
        env.storage().instance().set(&DataKey::Owner, &owner);
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage().instance().set(&DataKey::AgentKey, &agent_key);
        env.storage().instance().set(&DataKey::Rules, &rules);
    }
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
        let agent_key: BytesN<32> = env
            .storage()
            .instance()
            .get(&DataKey::AgentKey)
            .ok_or(AllowanceError::NotInitialized)?;

        env.crypto()
            .ed25519_verify(&agent_key, &payload.into(), &signature);

        let rules: Rules = env
            .storage()
            .instance()
            .get(&DataKey::Rules)
            .ok_or(AllowanceError::NotInitialized)?;

        let token: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .ok_or(AllowanceError::NotInitialized)?;

        // Every invocation the signature would cover, not just the first. A signature
        // authorises the whole tree, so a rule checked on one entry and skipped on the
        // next is not a rule.
        for context in contexts.iter() {
            let call = match context {
                Context::Contract(call) => call,
                // This contract never creates contracts, so nothing else is legitimate.
                _ => return Err(AllowanceError::MalformedCall),
            };

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
        }

        Ok(())
    }
}

mod test;
