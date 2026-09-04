#![cfg(test)]

use super::*;
use ed25519_dalek::{Signer, SigningKey};
use soroban_sdk::{
    auth::{Context, ContractContext},
    symbol_short,
    testutils::{Address as _, BytesN as _},
    vec, Address, BytesN, Env, IntoVal,
};

/// A day's worth of ledgers, give or take. Wide enough that the window never interferes
/// with tests that are not about the window.
const WINDOW: u32 = 17_280;

struct Fixture {
    env: Env,
    allowance: Address,
    token: Address,
    seller: Address,
    agent: SigningKey,
}

fn setup() -> Fixture {
    let env = Env::default();
    env.mock_all_auths();

    let owner = Address::generate(&env);
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

/// Regression guard, not a driven cycle: the loop was written before this test existed.
///
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
