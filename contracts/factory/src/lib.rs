#![no_std]

//! Deploys allowances at addresses derived from their owner.
//!
//! With no index to look one up in, an allowance's address has to be computable rather than
//! recorded. That needs a constant deployer, which is all this contract is.

use soroban_sdk::{
    contract, contractimpl, contracttype, xdr::ToXdr, Address, Bytes, BytesN, Env, String, Vec,
};

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

    /// Deploys an allowance and runs its constructor in the same invocation, so the owner
    /// signs once for the contract, its rules and its opening deposit.
    ///
    /// The signature demanded here is on the address the salt was derived from. The
    /// allowance constructor demands its own, on the address it stores. Those are the same
    /// address only while both declarations of `Setup` agree.
    pub fn create(env: Env, setup: Setup, index: u32) -> Address {
        setup.owner.require_auth();

        let salt = salt_for(&env, &setup.owner, index);
        let wasm: BytesN<32> = env.storage().instance().get(&DataKey::Wasm).unwrap();

        env.deployer()
            .with_current_contract(salt)
            .deploy_v2(wasm, (setup,))
    }

    /// Where an owner's allowance at this index is, whether or not it exists yet. A pure
    /// computation: it reads no ledger state and does not deploy anything.
    pub fn address_for(env: Env, owner: Address, index: u32) -> Address {
        env.deployer()
            .with_current_contract(salt_for(&env, &owner, index))
            .deployed_address()
    }
}

/// The owner is in the salt so an address can only be taken by whoever can authorize it.
/// The index is in it so an owner can hold more than one.
fn salt_for(env: &Env, owner: &Address, index: u32) -> BytesN<32> {
    let mut buf = Bytes::new(env);
    buf.append(&owner.clone().to_xdr(env));
    buf.append(&index.to_xdr(env));
    env.crypto().sha256(&buf).into()
}

mod test;
