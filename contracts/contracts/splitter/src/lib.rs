#![no_std]

//! Payment splitter — one per registered API.
//!
//! The gateway's 402 names this contract as the recipient, so payment lands here rather than in
//! a platform-controlled account. The split is fixed at creation and enforced by code, so the
//! developer does not have to trust the platform to forward their share.

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, token, Address, Env,
};

pub const BPS_DENOMINATOR: i128 = 10_000;

#[contracttype]
#[derive(Clone)]
pub struct Config {
    pub developer: Address,
    pub platform: Address,
    pub token: Address,
    /// Platform's share in basis points. 1_000 = 10%.
    pub fee_bps: u32,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Config,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum SplitterError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    FeeTooHigh = 3,
    NothingToFlush = 4,
}

#[contractevent]
#[derive(Clone)]
pub struct Flushed {
    #[topic]
    pub developer: Address,
    pub developer_amount: i128,
    pub platform_amount: i128,
}

#[contract]
pub struct Splitter;

#[contractimpl]
impl Splitter {
    pub fn init(
        env: Env,
        developer: Address,
        platform: Address,
        token: Address,
        fee_bps: u32,
    ) -> Result<(), SplitterError> {
        if env.storage().instance().has(&DataKey::Config) {
            return Err(SplitterError::AlreadyInitialized);
        }
        if (fee_bps as i128) > BPS_DENOMINATOR {
            return Err(SplitterError::FeeTooHigh);
        }

        env.storage().instance().set(
            &DataKey::Config,
            &Config {
                developer,
                platform,
                token,
                fee_bps,
            },
        );

        Ok(())
    }

    /// Pays out the entire balance: developer share first, platform fee second.
    ///
    /// Permissionless on purpose. The money can only go to the two addresses fixed at creation,
    /// so there is nothing to protect — and it means the developer is never waiting on the
    /// platform to press a button.
    pub fn flush(env: Env) -> Result<(i128, i128), SplitterError> {
        let config = load_config(&env)?;
        let client = token::TokenClient::new(&env, &config.token);
        let here = env.current_contract_address();
        let total = client.balance(&here);

        if total <= 0 {
            return Err(SplitterError::NothingToFlush);
        }

        // Fee rounds down, so any remainder from integer division goes to the developer.
        let platform_amount = total * (config.fee_bps as i128) / BPS_DENOMINATOR;
        let developer_amount = total - platform_amount;

        // No signature needed on either leg: this contract is the executing contract, so its
        // own require_auth is satisfied by Contract Invoker authorization.
        if developer_amount > 0 {
            client.transfer(&here, &config.developer, &developer_amount);
        }
        if platform_amount > 0 {
            client.transfer(&here, &config.platform, &platform_amount);
        }

        Flushed {
            developer: config.developer,
            developer_amount,
            platform_amount,
        }
        .publish(&env);

        Ok((developer_amount, platform_amount))
    }

    pub fn balance(env: Env) -> Result<i128, SplitterError> {
        let config = load_config(&env)?;
        Ok(token::TokenClient::new(&env, &config.token).balance(&env.current_contract_address()))
    }

    pub fn config(env: Env) -> Result<Config, SplitterError> {
        load_config(&env)
    }
}

fn load_config(env: &Env) -> Result<Config, SplitterError> {
    env.storage()
        .instance()
        .get(&DataKey::Config)
        .ok_or(SplitterError::NotInitialized)
}

mod test;
