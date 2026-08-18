#![cfg(test)]

use super::*;
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Ledger as _},
    token::{StellarAssetClient, TokenClient},
    vec, Address, Env,
};

struct Ctx {
    env: Env,
    contract: Address,
    token: Address,
    owner: Address,
    agent: Address,
    seller: Address,
}

/// Deposits `amount` from the owner so the contract has something to spend.
fn funded(owner_funds: i128, deposit: i128) -> Ctx {
    let ctx = setup(owner_funds);
    AllowanceClient::new(&ctx.env, &ctx.contract).deposit(&ctx.owner, &deposit);
    ctx
}

/// Deploys a fresh allowance with a stand-in USDC and mints `owner_funds` to the owner.
fn setup(owner_funds: i128) -> Ctx {
    let env = Env::default();
    env.mock_all_auths();

    // Start at a realistic height. Testnet is in the millions; leaving the default 0 tests an
    // edge case that only exists at genesis and hides ordinary window behaviour.
    env.ledger().set_sequence_number(1_000_000);

    let owner = Address::generate(&env);
    let agent = Address::generate(&env);
    let seller = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let token = env.register_stellar_asset_contract_v2(token_admin);
    let token_address = token.address();

    let contract = env.register(Allowance, ());
    let client = AllowanceClient::new(&env, &contract);

    client.init(
        &owner,
        &token_address,
        &agent,
        &Rules {
            max_per_call: 1_000_000,          // 0.1 USDC
            window_ledgers: 60,
            window_cap: 5_000_000,            // 0.5 USDC
            allowlist: vec![&env, seller.clone()],
        },
    );

    StellarAssetClient::new(&env, &token_address).mint(&owner, &owner_funds);

    Ctx { env, contract, token: token_address, owner, agent, seller }
}

/// Test 1 — money in, money out.
///
/// This runs before any rule logic on purpose. A contract that accepts deposits but cannot
/// return them is a shredder, and that is the one bug with no recovery path.
#[test]
fn deposit_then_withdraw_returns_the_funds() {
    let ctx = setup(10_000_000);
    let client = AllowanceClient::new(&ctx.env, &ctx.contract);
    let token = TokenClient::new(&ctx.env, &ctx.token);

    client.deposit(&ctx.owner, &4_000_000);

    assert_eq!(client.balance(), 4_000_000, "contract should hold the deposit");
    assert_eq!(token.balance(&ctx.owner), 6_000_000, "owner should be debited");

    client.withdraw(&ctx.owner, &4_000_000);

    assert_eq!(client.balance(), 0, "contract should be empty after withdraw");
    assert_eq!(
        token.balance(&ctx.owner),
        10_000_000,
        "owner should have every unit back"
    );
}

/// Test 3 — the happy path. Under every limit, to an allowlisted address.
#[test]
fn spend_within_all_limits_pays_the_seller() {
    let ctx = funded(10_000_000, 6_000_000);
    let client = AllowanceClient::new(&ctx.env, &ctx.contract);
    let token = TokenClient::new(&ctx.env, &ctx.token);

    client.spend(&ctx.seller, &1_000_000, &symbol_short!("ref1"));

    assert_eq!(token.balance(&ctx.seller), 1_000_000);
    assert_eq!(client.balance(), 5_000_000);
    assert_eq!(client.spent_in_window(), 1_000_000);
}

/// Test 4 — one call bigger than `max_per_call` is refused.
#[test]
fn spend_over_per_call_cap_is_refused() {
    let ctx = funded(10_000_000, 6_000_000);
    let client = AllowanceClient::new(&ctx.env, &ctx.contract);
    let token = TokenClient::new(&ctx.env, &ctx.token);

    let err = client
        .try_spend(&ctx.seller, &1_000_001, &symbol_short!("ref1"))
        .unwrap_err()
        .unwrap();

    assert_eq!(err, AllowanceError::ExceedsPerCall);
    assert_eq!(token.balance(&ctx.seller), 0, "no money may move on refusal");
}

/// Test 5 — paying someone not on the list is refused, however small the amount.
#[test]
fn spend_to_unlisted_recipient_is_refused() {
    let ctx = funded(10_000_000, 6_000_000);
    let client = AllowanceClient::new(&ctx.env, &ctx.contract);
    let stranger = Address::generate(&ctx.env);

    let err = client
        .try_spend(&stranger, &1, &symbol_short!("ref1"))
        .unwrap_err()
        .unwrap();

    assert_eq!(err, AllowanceError::RecipientNotAllowed);
}

/// Test 6 — **the demo.** Five calls fit inside the window cap; the sixth does not.
#[test]
fn sixth_call_exceeds_the_window_cap() {
    let ctx = funded(20_000_000, 12_000_000);
    let client = AllowanceClient::new(&ctx.env, &ctx.contract);
    let token = TokenClient::new(&ctx.env, &ctx.token);

    for _ in 0..5 {
        client.spend(&ctx.seller, &1_000_000, &symbol_short!("ref"));
    }
    assert_eq!(client.spent_in_window(), 5_000_000, "window is now full");

    let err = client
        .try_spend(&ctx.seller, &1_000_000, &symbol_short!("ref6"))
        .unwrap_err()
        .unwrap();

    assert_eq!(err, AllowanceError::ExceedsWindow);
    assert_eq!(
        token.balance(&ctx.seller),
        5_000_000,
        "the sixth call must not move a single unit"
    );
}

/// Test 7 — the window is rolling, not permanent. Once it passes, spending resumes.
#[test]
fn window_rolls_and_spending_resumes() {
    let ctx = funded(20_000_000, 12_000_000);
    let client = AllowanceClient::new(&ctx.env, &ctx.contract);

    for _ in 0..5 {
        client.spend(&ctx.seller, &1_000_000, &symbol_short!("ref"));
    }
    assert!(client.try_spend(&ctx.seller, &1_000_000, &symbol_short!("r6")).is_err());

    // Advance past the 60-ledger window.
    let now = ctx.env.ledger().sequence();
    ctx.env.ledger().set_sequence_number(now + 61);

    assert_eq!(client.spent_in_window(), 0, "old spends have aged out");
    client.spend(&ctx.seller, &1_000_000, &symbol_short!("ref7"));
    assert_eq!(client.spent_in_window(), 1_000_000);
}

/// Test 8 — revoke is an immediate, total stop.
#[test]
fn revoked_agent_cannot_spend() {
    let ctx = funded(10_000_000, 6_000_000);
    let client = AllowanceClient::new(&ctx.env, &ctx.contract);

    client.revoke();

    let err = client
        .try_spend(&ctx.seller, &1, &symbol_short!("ref1"))
        .unwrap_err()
        .unwrap();

    assert_eq!(err, AllowanceError::Revoked);
}

/// Test 8b — revoking must not strand the money. The owner can still withdraw.
#[test]
fn owner_can_still_withdraw_after_revoke() {
    let ctx = funded(10_000_000, 6_000_000);
    let client = AllowanceClient::new(&ctx.env, &ctx.contract);
    let token = TokenClient::new(&ctx.env, &ctx.token);

    client.revoke();
    client.withdraw(&ctx.owner, &6_000_000);

    assert_eq!(token.balance(&ctx.owner), 10_000_000);
}

/// The owner can change the rules without redeploying — needed the moment a user wants to
/// adjust their budget, or add a recipient they did not know about at setup.
#[test]
fn owner_can_change_the_rules() {
    let ctx = funded(20_000_000, 12_000_000);
    let client = AllowanceClient::new(&ctx.env, &ctx.contract);
    let new_seller = Address::generate(&ctx.env);

    // Not on the list yet.
    assert!(client
        .try_spend(&new_seller, &1_000_000, &symbol_short!("r1"))
        .is_err());

    client.set_rules(&Rules {
        max_per_call: 2_000_000,
        window_ledgers: 60,
        window_cap: 5_000_000,
        allowlist: vec![&ctx.env, new_seller.clone()],
    });

    client.spend(&new_seller, &2_000_000, &symbol_short!("r2"));
    assert_eq!(
        TokenClient::new(&ctx.env, &ctx.token).balance(&new_seller),
        2_000_000
    );

    // The old recipient is no longer allowed.
    let err = client
        .try_spend(&ctx.seller, &1, &symbol_short!("r3"))
        .unwrap_err()
        .unwrap();
    assert_eq!(err, AllowanceError::RecipientNotAllowed);
}

/// Changing the rules must not wipe what has already been spent, or an agent at its cap
/// could be handed a fresh window by any rule edit.
#[test]
fn changing_rules_preserves_spend_history() {
    let ctx = funded(20_000_000, 12_000_000);
    let client = AllowanceClient::new(&ctx.env, &ctx.contract);

    client.spend(&ctx.seller, &1_000_000, &symbol_short!("r1"));
    assert_eq!(client.spent_in_window(), 1_000_000);

    client.set_rules(&Rules {
        max_per_call: 1_000_000,
        window_ledgers: 60,
        window_cap: 3_000_000,
        allowlist: vec![&ctx.env, ctx.seller.clone()],
    });

    assert_eq!(client.spent_in_window(), 1_000_000, "history survives a rule change");
    assert_eq!(client.remaining(), 2_000_000, "new cap of 3M minus 1M already spent");
}

/// Test 9 — reads must not write. Calling a view must not consume window state.
#[test]
fn views_do_not_mutate_window_state() {
    let ctx = funded(10_000_000, 6_000_000);
    let client = AllowanceClient::new(&ctx.env, &ctx.contract);

    client.spend(&ctx.seller, &1_000_000, &symbol_short!("ref1"));

    let first = client.spent_in_window();
    let second = client.spent_in_window();
    let third = client.remaining();

    assert_eq!(first, 1_000_000);
    assert_eq!(second, 1_000_000, "reading twice must give the same answer");
    assert_eq!(third, 4_000_000, "cap 5_000_000 minus 1_000_000 already spent");
}
