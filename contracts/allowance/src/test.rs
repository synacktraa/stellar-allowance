#![cfg(test)]

use super::*;
use ed25519_dalek::{Signer, SigningKey};
use soroban_sdk::{
    auth::{Context, ContractContext},
    symbol_short,
    testutils::{
        storage::{Instance as _, Persistent as _},
        Address as _, BytesN as _, Ledger as _,
    },
    vec, Address, BytesN, Env, IntoVal,
};

/// A day's worth of ledgers, give or take. Wide enough that the window never interferes
/// with tests that are not about the window.
const WINDOW: u32 = 17_280;

struct Fixture {
    owner: Address,
    env: Env,
    allowance: Address,
    token: Address,
    seller: Address,
    agent: SigningKey,
}

fn setup() -> Fixture {
    let env = Env::default();
    env.mock_all_auths();

    // Testnet's real archival settings. The defaults are far shorter, which hides TTL
    // behaviour entirely: an entry expires mid-test and protocol 23 silently restores it.
    env.ledger().set_min_persistent_entry_ttl(120_960); // 7 days
    env.ledger().set_max_entry_ttl(3_110_400); // 180 days

    let owner = Address::generate(&env);
    let owner_addr = owner.clone();
    let token = Address::generate(&env);
    let seller = Address::generate(&env);

    let agent = SigningKey::from_bytes(&[7u8; 32]);
    let agent_key = BytesN::from_array(&env, &agent.verifying_key().to_bytes());

    let rules = Rules {
        window_ledgers: WINDOW,
        window_cap: 1_000_000,
        allowlist: vec![&env, seller.clone()],
    };

    let allowance = env.register(Allowance, (owner, token.clone(), agent_key, rules));

    Fixture {
        owner: owner_addr,
        env,
        allowance,
        token,
        seller,
        agent,
    }
}

/// What the agent actually signs: the raw 32 bytes of the payload hash, nothing wrapped
/// around them. The host hands `__check_auth` the same 32 bytes as a `Hash<32>`.
fn sign_payload(agent: &SigningKey, payload: &BytesN<32>) -> [u8; 64] {
    agent.sign(&payload.to_array()).to_bytes()
}

/// One `USDC.transfer(allowance -> to, amount)` invocation, as the host would present it.
fn transfer(f: &Fixture, to: &Address, amount: i128) -> Context {
    transfer_of(f, &f.token, to, amount)
}

/// The same call, but addressed to a token contract of the caller's choosing.
fn transfer_of(f: &Fixture, token: &Address, to: &Address, amount: i128) -> Context {
    Context::Contract(ContractContext {
        contract: token.clone(),
        fn_name: symbol_short!("transfer"),
        args: vec![
            &f.env,
            f.allowance.to_val(),
            to.to_val(),
            amount.into_val(&f.env),
        ],
    })
}

fn check_auth(f: &Fixture, contexts: soroban_sdk::Vec<Context>) -> Option<AllowanceError> {
    let payload = BytesN::random(&f.env);
    let signature = BytesN::from_array(&f.env, &sign_payload(&f.agent, &payload));
    f.env
        .try_invoke_contract_check_auth::<AllowanceError>(
            &f.allowance,
            &payload,
            signature.to_val(),
            &contexts,
        )
        .err()
        // Unwrapping the inner Result is the assertion that matters: `Ok(e)` is a contract
        // error the library can name, `Err(_)` is a host abort it cannot.
        .map(|e| e.expect("refused with a host abort, not a contract error"))
}

#[test]
fn agent_signature_authorises_a_payment_to_an_allowlisted_seller() {
    let f = setup();
    let contexts = vec![&f.env, transfer(&f, &f.seller, 100)];

    assert_eq!(check_auth(&f, contexts), None);
}

#[test]
fn a_signature_from_any_other_key_is_refused() {
    let f = setup();
    let impostor = SigningKey::from_bytes(&[9u8; 32]);
    let payload = BytesN::random(&f.env);
    let signature = BytesN::from_array(&f.env, &sign_payload(&impostor, &payload));
    let contexts = vec![&f.env, transfer(&f, &f.seller, 100)];

    let result = f.env.try_invoke_contract_check_auth::<AllowanceError>(
        &f.allowance,
        &payload,
        signature.to_val(),
        &contexts,
    );

    assert!(
        result.is_err(),
        "a forged signature must not authorise a payment"
    );
}

#[test]
fn a_payment_to_an_address_off_the_allowlist_is_refused() {
    let f = setup();
    let stranger = Address::generate(&f.env);
    let contexts = vec![&f.env, transfer(&f, &stranger, 100)];

    assert_eq!(
        check_auth(&f, contexts),
        Some(AllowanceError::RecipientNotAllowed)
    );
}

/// A signature covers the whole invocation tree, so checking only the root would let an
/// attacker append a second transfer to themselves. What makes this worth pinning is that
/// x402's `exact` scheme forbids sub-invocations — which makes "the protocol guarantees a
/// single context" an available, plausible and wrong reason to drop the loop under fee
/// pressure. The protocol constrains well-behaved clients, not attackers.
#[test]
fn a_second_invocation_smuggled_in_behind_a_legitimate_one_is_refused() {
    let f = setup();
    let stranger = Address::generate(&f.env);
    let contexts = vec![
        &f.env,
        transfer(&f, &f.seller, 100),
        transfer(&f, &stranger, 5_000),
    ];

    assert_eq!(
        check_auth(&f, contexts),
        Some(AllowanceError::RecipientNotAllowed)
    );
}

/// A call with nothing in the recipient slot must be *refused*, not panicked through.
/// Asserting a named contract error rather than a host abort is the whole point: the
/// library can tell a caller why a refusal happened only when it carries a discriminant.
#[test]
fn a_call_not_shaped_like_a_transfer_is_refused_rather_than_aborting() {
    let f = setup();
    let contexts = vec![
        &f.env,
        Context::Contract(ContractContext {
            contract: f.token.clone(),
            fn_name: symbol_short!("transfer"),
            // One argument where a transfer has three.
            args: vec![&f.env, f.allowance.to_val()],
        }),
    ];

    assert_eq!(
        check_auth(&f, contexts),
        Some(AllowanceError::MalformedCall)
    );
}

/// The asset's identity lives in `call.contract`, nowhere in the arguments. Until it is
/// checked, `100` is a number with no units — and the agent can authorise a transfer of
/// any token in existence to an allowlisted seller, including ones the owner never
/// deposited and never meant to be spendable.
#[test]
fn a_transfer_of_some_other_token_is_refused() {
    let f = setup();
    let other_token = Address::generate(&f.env);
    let contexts = vec![&f.env, transfer_of(&f, &other_token, &f.seller, 100)];

    assert_eq!(check_auth(&f, contexts), Some(AllowanceError::WrongAsset));
}

/// x402's facilitator refuses any invocation that is not a three-argument `transfer`, so a
/// call like this never reaches the chain by that route. The contract checks anyway: a
/// signed auth entry can be submitted to the network directly, and what an owner concludes
/// from reading `__check_auth` should not rest on a third party's validation.
///
/// `approve` stands in for the general case because its arguments line up with a
/// transfer's — the second is a spender rather than a recipient — so every other guard
/// here passes, and only the function name tells them apart.
#[test]
fn a_call_to_another_token_function_is_refused() {
    let f = setup();
    let contexts = vec![
        &f.env,
        Context::Contract(ContractContext {
            contract: f.token.clone(),
            fn_name: symbol_short!("approve"),
            args: vec![
                &f.env,
                f.allowance.to_val(),
                f.seller.to_val(),
                1_000_000i128.into_val(&f.env),
                200u32.into_val(&f.env),
            ],
        }),
    ];

    assert_eq!(check_auth(&f, contexts), Some(AllowanceError::NotATransfer));
}

/// The thinnest version of the cap: one payment larger than the entire window allowance.
/// It needs no history and no accumulation — a single call that could never fit, whatever
/// else has happened.
#[test]
fn a_single_payment_larger_than_the_window_cap_is_refused() {
    let f = setup();
    let contexts = vec![&f.env, transfer(&f, &f.seller, 1_000_001)];

    assert_eq!(
        check_auth(&f, contexts),
        Some(AllowanceError::ExceedsWindow)
    );
}

/// Two payments that each fit comfortably and together do not. This is the half of the
/// rule that needs memory: nothing so far survives between calls, so the second is waved
/// through and the cap has been doubled.
#[test]
fn payments_that_together_exceed_the_cap_are_refused() {
    let f = setup();

    assert_eq!(
        check_auth(&f, vec![&f.env, transfer(&f, &f.seller, 600_000)]),
        None,
        "the first payment is well inside the cap"
    );
    assert_eq!(
        check_auth(&f, vec![&f.env, transfer(&f, &f.seller, 600_000)]),
        Some(AllowanceError::ExceedsWindow),
        "the second takes the window to 1,200,000 against a cap of 1,000,000"
    );
}

/// Both halves of "rolling", in one test, because either alone can be satisfied by an
/// implementation that is wrong in the other direction.
///
/// A counter that resets on a fixed boundary passes the ageing-out assertion and fails the
/// middle one: spend the cap just before the boundary and again just after, and the agent
/// has moved twice the limit in two ledgers. A counter that never forgets passes the
/// middle one and fails the last. Only a window that expires spending individually,
/// by age, passes both.
#[test]
fn the_window_rolls_rather_than_resetting() {
    let f = setup();
    let start = f.env.ledger().sequence();

    f.env.ledger().set_sequence_number(start + WINDOW - 1);
    assert_eq!(
        check_auth(&f, vec![&f.env, transfer(&f, &f.seller, 1_000_000)]),
        None,
        "the whole cap, spent at the end of a would-be period"
    );

    f.env.ledger().set_sequence_number(start + WINDOW + 1);
    assert_eq!(
        check_auth(&f, vec![&f.env, transfer(&f, &f.seller, 1_000_000)]),
        Some(AllowanceError::ExceedsWindow),
        "two ledgers later: a resetting counter would hand over a fresh cap here"
    );

    f.env.ledger().set_sequence_number(start + WINDOW * 2 + 2);
    assert_eq!(
        check_auth(&f, vec![&f.env, transfer(&f, &f.seller, 1_000_000)]),
        None,
        "a full window after the spend, it has aged out"
    );
}

/// The two clocks a payment depends on, read from inside the contract.
fn clocks(f: &Fixture) -> (u32, u32) {
    f.env.as_contract(&f.allowance, || {
        (
            f.env.storage().instance().get_ttl(),
            f.env.storage().persistent().get_ttl(&DataKey::Window),
        )
    })
}

/// Nothing about using a contract keeps it alive — not invoking it, not writing to it.
/// Both clocks run down from the day the entry was created, so unless the payment path
/// tops them up the allowance stops working about a week after it is deployed, and the
/// only way out is a restore that costs more than a year of upkeep.
#[test]
fn a_payment_tops_up_the_clocks_it_depends_on() {
    let f = setup();

    // the first payment brings the window entry into existence
    assert_eq!(
        check_auth(&f, vec![&f.env, transfer(&f, &f.seller, 1)]),
        None
    );

    let (instance_fresh, window_fresh) = clocks(&f);

    // let a day drain away
    f.env
        .ledger()
        .set_sequence_number(f.env.ledger().sequence() + 17_280);
    let (instance_drained, window_drained) = clocks(&f);
    assert!(
        instance_drained < instance_fresh && window_drained < window_fresh,
        "the clocks should have run down on their own"
    );

    // a second payment should put them back
    assert_eq!(
        check_auth(&f, vec![&f.env, transfer(&f, &f.seller, 1)]),
        None
    );
    let (instance_after, window_after) = clocks(&f);

    assert!(
        instance_after > instance_drained,
        "the instance clock was not topped up: {instance_drained} -> {instance_after}"
    );
    assert!(
        window_after > window_drained,
        "the window clock was not topped up: {window_drained} -> {window_after}"
    );
}

/// The emergency brake. It moves no money, so it cannot fail for balance reasons — which
/// is exactly what you want from a stop button.
#[test]
fn the_owner_can_disable_the_agent() {
    let f = setup();
    let client = AllowanceClient::new(&f.env, &f.allowance);

    assert!(client.enabled(), "an allowance starts out running");

    client.disable();
    // Captured immediately: env.auths() reports the most recent invocation, and any call
    // in between would overwrite it with one that demanded nothing.
    let demanded = f.env.auths().first().map(|(who, _)| who.clone());

    assert!(!client.enabled(), "the brake is on");
    assert_eq!(
        demanded,
        Some(f.owner.clone()),
        "and it was the owner's signature that was demanded, nobody else's"
    );
}

/// Until this holds, the brake is wired to nothing: the owner can push it and the agent
/// carries on spending. Everything else about the payment here is impeccable — right
/// signer, right token, allowlisted seller, one unit against a million-unit cap.
#[test]
fn a_disabled_allowance_pays_nobody() {
    let f = setup();
    AllowanceClient::new(&f.env, &f.allowance).disable();

    assert_eq!(
        check_auth(&f, vec![&f.env, transfer(&f, &f.seller, 1)]),
        Some(AllowanceError::Disabled)
    );
}

#[test]
fn the_owner_can_start_the_agent_again() {
    let f = setup();
    let client = AllowanceClient::new(&f.env, &f.allowance);

    client.disable();
    assert_eq!(
        check_auth(&f, vec![&f.env, transfer(&f, &f.seller, 1)]),
        Some(AllowanceError::Disabled)
    );

    client.enable();

    assert!(client.enabled());
    assert_eq!(
        check_auth(&f, vec![&f.env, transfer(&f, &f.seller, 1)]),
        None
    );
}

/// Regression guard. Clearing state on resume is a plausible, well-meant change — and it
/// would turn the stop button into a way of buying a fresh budget: spend the cap, stop,
/// start, spend it again. The window belongs to the clock, not to the switch.
#[test]
fn starting_again_does_not_hand_back_a_spent_window() {
    let f = setup();
    let client = AllowanceClient::new(&f.env, &f.allowance);

    assert_eq!(
        check_auth(&f, vec![&f.env, transfer(&f, &f.seller, 1_000_000)]),
        None,
        "the whole cap, spent"
    );

    client.disable();
    client.enable();

    assert_eq!(
        check_auth(&f, vec![&f.env, transfer(&f, &f.seller, 1)]),
        Some(AllowanceError::ExceedsWindow),
        "the window survived the round trip"
    );
}
