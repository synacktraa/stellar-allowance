#![no_std]

//! Deploys allowances at addresses derived from their owner.
//!
//! With no index to look one up in, an allowance's address has to be computable rather than
//! recorded. That needs a constant deployer, which is all this contract is.

use soroban_sdk::{contract, contractimpl, contracttype, Address, BytesN, Env, String, Vec};

/// Declared again rather than imported from the allowance crate. Importing it drags that
/// crate's exported `__constructor` symbol into this binary and the link fails. The XDR
/// encoding is structural, so these have to match the allowance's declarations field for
/// field, in order.
#[contracttype]
#[derive(Clone)]
pub struct Spending {
    pub token: Address,
    pub initial_deposit: i128,
}

#[contracttype]
#[derive(Clone)]
pub struct Rules {
    pub window_ledgers: u32,
    pub window_cap: i128,
    pub allowlist: Vec<Address>,
}

#[contracttype]
#[derive(Clone)]
pub struct Setup {
    pub owner: Address,
    pub agent_key: BytesN<32>,
    pub name: String,
    pub spending: Spending,
    pub rules: Rules,
}

#[contracttype]
enum DataKey {
    Wasm,
}

#[contract]
pub struct Factory;

#[contractimpl]
impl Factory {
    /// The allowance version this factory creates, fixed here for good. There is no setter,
    /// so a new allowance release means a new factory rather than a key that can repoint
    /// what every future allowance runs.
    pub fn __constructor(env: Env, allowance_wasm: BytesN<32>) {
        env.storage()
            .instance()
            .set(&DataKey::Wasm, &allowance_wasm);
    }
}

mod test;
