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
    /// Stand-in for the native XLM asset contract, which the constructor and `write` use to
    /// fund the agent's account.
    native: Address,
    owner: Address,
    agent: Address,
    seller: Address,
}

/// The rules every test starts from: 0.1 USDC a call, 0.5 across a 60-ledger window, one seller.
fn rules(env: &Env, seller: &Address) -> Rules {
    Rules {
        max_per_call: 1_000_000,
        window_ledgers: 60,
        window_cap: 5_000_000,
        allowlist: vec![env, seller.clone()],
    }
}

/// Deploys an allowance the way an owner now does it: one action that creates the contract and
/// funds it. `usdc_in` and `xlm_to_agent` are what the constructor moves.
fn deploy(owner_funds: i128, usdc_in: i128, xlm_to_agent: i128) -> Ctx {
    let env = Env::default();
    env.mock_all_auths();

    // Start at a realistic height. Testnet is in the millions; leaving the default 0 tests an
    // edge case that only exists at genesis and hides ordinary window behaviour.
    env.ledger().set_sequence_number(1_000_000);

    let owner = Address::generate(&env);
    let agent = Address::generate(&env);
    let seller = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let token_address = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    let native_address = env
        .register_stellar_asset_contract_v2(token_admin)
        .address();

    StellarAssetClient::new(&env, &token_address).mint(&owner, &owner_funds);
    StellarAssetClient::new(&env, &native_address).mint(&owner, &1_000_000_000);

    let contract = env.register(
        Allowance,
        (
            owner.clone(),
            token_address.clone(),
            native_address.clone(),
            agent.clone(),
            rules(&env, &seller),
            usdc_in,
            xlm_to_agent,
        ),
    );

    Ctx {
        env,
        contract,
        token: token_address,
        native: native_address,
        owner,
        agent,
        seller,
    }
}

/// An allowance created but not funded. Legal — "set it up now, fund it Monday".
fn setup(owner_funds: i128) -> Ctx {
    deploy(owner_funds, 0, 0)
}

/// The state every rule test wants: created with money already in it.
fn funded(owner_funds: i128, deposit: i128) -> Ctx {
    deploy(owner_funds, deposit, 0)
}

/// The whole point of the design: one deploy leaves the contract holding USDC and the agent's
/// account holding the XLM it needs for its own fees. Two assets, two destinations, one action.
#[test]
fn constructor_pulls_usdc_and_funds_the_agent() {
    let ctx = deploy(10_000_000, 4_000_000, 50_000_000);
    let client = AllowanceClient::new(&ctx.env, &ctx.contract);
    let usdc = TokenClient::new(&ctx.env, &ctx.token);
    let native = TokenClient::new(&ctx.env, &ctx.native);

    assert_eq!(client.balance(), 4_000_000, "contract holds the USDC");
    assert_eq!(usdc.balance(&ctx.owner), 6_000_000, "owner was debited the USDC");
    assert_eq!(native.balance(&ctx.agent), 50_000_000, "agent holds the XLM");
    assert_eq!(
        native.balance(&ctx.contract),
        0,
        "XLM passes to the agent; the contract never holds any"
    );
}

/// Both amounts may be zero. The UI discourages an unfunded allowance; the contract permits it.
#[test]
fn constructor_with_zero_amounts_creates_an_empty_allowance() {
    let ctx = setup(10_000_000);
    let client = AllowanceClient::new(&ctx.env, &ctx.contract);

    assert_eq!(client.balance(), 0);
    assert_eq!(
        TokenClient::new(&ctx.env, &ctx.token).balance(&ctx.owner),
        10_000_000,
        "nothing moved"
    );
    assert_eq!(client.config().window_cap, 5_000_000, "but the rules are set");
}

/// A constructor cannot return an error, so a negative amount has to panic. Letting one through
/// would reverse a transfer's direction without saying so.
#[test]
#[should_panic]
fn constructor_refuses_a_negative_deposit() {
    deploy(10_000_000, -1, 0);
}

#[test]
#[should_panic]
fn constructor_refuses_a_negative_xlm_amount() {
    deploy(10_000_000, 0, -1);
}

/// Anyone can ask an allowance who owns it and which key it trusts. Without this the product's
/// central claim — one person controls this money, the platform cannot — is unverifiable from
/// outside, and the API could not check that a contract being registered is really the caller's.
#[test]
fn owner_and_agent_are_readable_by_anyone() {
    let ctx = funded(10_000_000, 4_000_000);
    let client = AllowanceClient::new(&ctx.env, &ctx.contract);

    assert_eq!(client.owner(), ctx.owner);
    assert_eq!(client.agent(), ctx.agent);
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

    client.write(&None, &4_000_000, &0);

    assert_eq!(client.balance(), 4_000_000, "contract should hold the deposit");
    assert_eq!(token.balance(&ctx.owner), 6_000_000, "owner should be debited");

    client.withdraw(&4_000_000);

    assert_eq!(client.balance(), 0, "contract should be empty after withdraw");
    assert_eq!(
        token.balance(&ctx.owner),
        10_000_000,
        "owner should have every unit back"
    );
}

/// The destination is not a parameter, so there is nowhere else for it to go.
#[test]
fn withdraw_always_goes_to_the_owner() {
    let ctx = funded(10_000_000, 4_000_000);
    let client = AllowanceClient::new(&ctx.env, &ctx.contract);
    let token = TokenClient::new(&ctx.env, &ctx.token);

    client.withdraw(&4_000_000);

    assert_eq!(client.balance(), 0);
    assert_eq!(token.balance(&ctx.owner), 10_000_000, "every unit back to the owner");
}

/// `None` means leave them alone. Save sends a diff, so an edit that only added credits must
/// not arrive carrying an allowlist and quietly replace the real one.
#[test]
fn none_rules_leave_the_existing_ones_untouched() {
    let ctx = funded(10_000_000, 4_000_000);
    let client = AllowanceClient::new(&ctx.env, &ctx.contract);

    client.write(&None, &1_000_000, &0);

    let after = client.config();
    assert_eq!(after.allowlist.len(), 1, "allowlist survives a deposit-only write");
    assert_eq!(after.allowlist.get(0).unwrap(), ctx.seller);
    assert_eq!(after.window_cap, 5_000_000);
}

/// Save computes a diff and may find nothing on-chain to send — the owner changed only the
/// name. That must not be an error, or the button breaks for the commonest edit there is.
#[test]
fn an_empty_write_is_a_no_op() {
    let ctx = funded(10_000_000, 4_000_000);
    let client = AllowanceClient::new(&ctx.env, &ctx.contract);

    client.write(&None, &0, &0);

    assert_eq!(client.balance(), 4_000_000, "nothing moved");
    assert_eq!(client.config().window_cap, 5_000_000, "nothing changed");
}

/// One confirmation, three changes: new rules, more credits, more fees for the agent.
#[test]
fn write_changes_rules_and_moves_both_assets_together() {
    let ctx = funded(20_000_000, 4_000_000);
    let client = AllowanceClient::new(&ctx.env, &ctx.contract);
    let native = TokenClient::new(&ctx.env, &ctx.native);
    let new_seller = Address::generate(&ctx.env);

    client.write(
        &Some(Rules {
            max_per_call: 2_000_000,
            window_ledgers: 120,
            window_cap: 8_000_000,
            allowlist: vec![&ctx.env, new_seller.clone()],
        }),
        &3_000_000,
        &20_000_000,
    );

    assert_eq!(client.balance(), 7_000_000, "credits added to what was there");
    assert_eq!(native.balance(&ctx.agent), 20_000_000, "agent topped up");
    assert_eq!(client.config().window_cap, 8_000_000, "rules replaced");
    client.spend(&new_seller, &2_000_000, &symbol_short!("r1"));
}

/// A negative amount is a client bug. Refusing it is what stops it becoming a withdrawal.
#[test]
fn write_refuses_negative_amounts() {
    let ctx = funded(10_000_000, 4_000_000);
    let client = AllowanceClient::new(&ctx.env, &ctx.contract);

    assert_eq!(
        client.try_write(&None, &-1, &0).unwrap_err().unwrap(),
        AllowanceError::InvalidAmount
    );
    assert_eq!(
        client.try_write(&None, &0, &-1).unwrap_err().unwrap(),
        AllowanceError::InvalidAmount
    );
    assert_eq!(client.balance(), 4_000_000, "nothing moved");
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
    client.withdraw(&6_000_000);

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

    client.write(
        &Some(Rules {
            max_per_call: 2_000_000,
            window_ledgers: 60,
            window_cap: 5_000_000,
            allowlist: vec![&ctx.env, new_seller.clone()],
        }),
        &0,
        &0,
    );

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

    client.write(
        &Some(Rules {
            max_per_call: 1_000_000,
            window_ledgers: 60,
            window_cap: 3_000_000,
            allowlist: vec![&ctx.env, ctx.seller.clone()],
        }),
        &0,
        &0,
    );

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
