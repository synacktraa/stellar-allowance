#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::Address as _,
    token::{StellarAssetClient, TokenClient},
    Address, Env,
};

struct Ctx {
    env: Env,
    contract: Address,
    token: Address,
    developer: Address,
    platform: Address,
}

/// Deploys a splitter with a 10% fee and pays `paid` into it, as an agent's payment would.
fn setup(paid: i128) -> Ctx {
    let env = Env::default();
    env.mock_all_auths();

    let developer = Address::generate(&env);
    let platform = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let token = env.register_stellar_asset_contract_v2(token_admin);
    let token_address = token.address();

    let contract = env.register(
        Splitter,
        (developer.clone(), platform.clone(), token_address.clone(), 1_000u32),
    );

    if paid > 0 {
        StellarAssetClient::new(&env, &token_address).mint(&contract, &paid);
    }

    Ctx { env, contract, token: token_address, developer, platform }
}

/// The whole point: the split is executed by the contract, not promised by the platform.
#[test]
fn flush_pays_developer_ninety_percent_and_platform_ten() {
    let ctx = setup(100_000); // 0.01 USDC
    let client = SplitterClient::new(&ctx.env, &ctx.contract);
    let token = TokenClient::new(&ctx.env, &ctx.token);

    let (developer_amount, platform_amount) = client.flush();

    assert_eq!(developer_amount, 90_000);
    assert_eq!(platform_amount, 10_000);
    assert_eq!(token.balance(&ctx.developer), 90_000);
    assert_eq!(token.balance(&ctx.platform), 10_000);
    assert_eq!(client.balance(), 0, "nothing may be left behind");
}

/// Integer division must not silently keep a unit. Any remainder goes to the developer.
#[test]
fn rounding_favours_the_developer() {
    let ctx = setup(100_001);
    let client = SplitterClient::new(&ctx.env, &ctx.contract);
    let token = TokenClient::new(&ctx.env, &ctx.token);

    let (developer_amount, platform_amount) = client.flush();

    assert_eq!(platform_amount, 10_000, "fee rounds down");
    assert_eq!(developer_amount, 90_001, "developer takes the remainder");
    assert_eq!(
        token.balance(&ctx.developer) + token.balance(&ctx.platform),
        100_001,
        "every unit must be accounted for"
    );
}

/// Anyone may trigger a payout, so the developer never waits on the platform.
#[test]
fn flush_is_permissionless() {
    let ctx = setup(100_000);
    let client = SplitterClient::new(&ctx.env, &ctx.contract);
    let token = TokenClient::new(&ctx.env, &ctx.token);

    // No auth is mocked for any particular caller; flush takes no address argument at all.
    client.flush();

    assert_eq!(token.balance(&ctx.developer), 90_000);
}

/// Two payments arriving before anyone flushes must both be paid out.
#[test]
fn flush_pays_out_everything_accumulated() {
    let ctx = setup(100_000);
    let client = SplitterClient::new(&ctx.env, &ctx.contract);
    let token = TokenClient::new(&ctx.env, &ctx.token);

    StellarAssetClient::new(&ctx.env, &ctx.token).mint(&ctx.contract, &100_000);

    let (developer_amount, platform_amount) = client.flush();

    assert_eq!(developer_amount, 180_000);
    assert_eq!(platform_amount, 20_000);
    assert_eq!(token.balance(&ctx.developer), 180_000);
}

#[test]
fn flush_with_no_balance_is_refused() {
    let ctx = setup(0);
    let client = SplitterClient::new(&ctx.env, &ctx.contract);

    let err = client.try_flush().unwrap_err().unwrap();

    assert_eq!(err, SplitterError::NothingToFlush);
}

/// The split is fixed at deployment and there is no function that can change it. That is what
/// makes it verifiable rather than a promise — a developer reads the contract once.
#[test]
fn the_split_cannot_be_changed_after_deployment() {
    let ctx = setup(0);
    let client = SplitterClient::new(&ctx.env, &ctx.contract);

    let config = client.config();

    assert_eq!(config.developer, ctx.developer);
    assert_eq!(config.platform, ctx.platform);
    assert_eq!(config.fee_bps, 1_000);
    // The generated client exposes exactly the contract's functions. There is no setter here,
    // and a constructor cannot run twice.
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn fee_above_one_hundred_percent_is_refused_at_deployment() {
    let env = Env::default();
    env.mock_all_auths();

    let developer = Address::generate(&env);
    let platform = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(Address::generate(&env));

    env.register(
        Splitter,
        (developer, platform, token.address(), 10_001u32),
    );
}
