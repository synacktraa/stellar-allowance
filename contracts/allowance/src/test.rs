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
fn transfer_context(f: &Fixture, to: &Address, amount: i128) -> soroban_sdk::Vec<Context> {
    vec![
        &f.env,
        Context::Contract(ContractContext {
            contract: f.token.clone(),
            fn_name: symbol_short!("transfer"),
            args: vec![
                &f.env,
                f.allowance.to_val(),
                to.to_val(),
                amount.into_val(&f.env),
            ],
        }),
    ]
}

#[test]
fn agent_signature_authorises_a_payment_to_an_allowlisted_seller() {
    let f = setup();
    let payload = BytesN::random(&f.env);
    let signature = BytesN::from_array(&f.env, &sign_payload(&f.agent, &payload));
    let contexts = transfer_context(&f, &f.seller, 100);

    let result = f.env.try_invoke_contract_check_auth::<AllowanceError>(
        &f.allowance,
        &payload,
        signature.to_val(),
        &contexts,
    );

    assert!(
        result.is_ok(),
        "expected the payment to be authorised, got {result:?}"
    );
}

#[test]
fn a_signature_from_any_other_key_is_refused() {
    let f = setup();
    let impostor = SigningKey::from_bytes(&[9u8; 32]);
    let payload = BytesN::random(&f.env);
    let signature = BytesN::from_array(&f.env, &sign_payload(&impostor, &payload));
    let contexts = transfer_context(&f, &f.seller, 100);

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
