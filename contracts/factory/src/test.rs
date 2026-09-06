#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    vec, Address, BytesN, Env, String,
};

/// The allowance is deployed by hash, so its built artifact is what these tests need, not
/// the crate. `contractimport!` resolves its path from CARGO_MANIFEST_DIR.
mod allowance {
    // The generated client covers __check_auth, whose signature names Context.
    use soroban_sdk::auth::Context;

    soroban_sdk::contractimport!(file = "../target/wasm32v1-none/release/allowance.wasm");
}

struct Fixture {
    env: Env,
    owner: Address,
    factory: Address,
    token: Address,
}

fn setup() -> Fixture {
    let env = Env::default();
    env.mock_all_auths();

    let wasm = env.deployer().upload_contract_wasm(allowance::WASM);
    let factory = env.register(Factory, (wasm,));

    let issuer = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(issuer).address();

    Fixture {
        owner: Address::generate(&env),
        factory,
        token,
        env,
    }
}

fn setup_args(f: &Fixture) -> Setup {
    Setup {
        owner: f.owner.clone(),
        agent_key: BytesN::from_array(&f.env, &[7u8; 32]),
        name: String::from_str(&f.env, "Research agent"),
        spending: Spending {
            token: f.token.clone(),
            initial_deposit: 0,
        },
        rules: Rules {
            window_ledgers: 17_280,
            window_cap: 1_000_000,
            allowlist: vec![&f.env, f.owner.clone()],
        },
    }
}

/// What the interface computes before submitting has to be where the contract ends up, or
/// an owner would create allowances they could not find again.
#[test]
fn a_created_allowance_lands_where_address_for_predicted() {
    let f = setup();
    let factory = FactoryClient::new(&f.env, &f.factory);
    let predicted = factory.address_for(&f.owner, &0);

    assert_eq!(factory.create(&setup_args(&f), &0), predicted);
}

/// Setup is declared in this crate rather than imported, so nothing but a round trip proves
/// the two declarations encode the same bytes. The allowance decoding what the factory
/// encoded is that proof.
#[test]
fn the_allowance_constructor_ran_with_what_create_was_given() {
    let f = setup();
    let created = FactoryClient::new(&f.env, &f.factory).create(&setup_args(&f), &0);
    let config = allowance::Client::new(&f.env, &created).get_config();

    assert_eq!(config.owner, f.owner, "the owner reached the constructor");
    assert_eq!(config.token, f.token, "and so did the nested Spending");
    assert_eq!(config.name, String::from_str(&f.env, "Research agent"));
    assert_eq!(config.rules.window_cap, 1_000_000, "and the nested Rules");
}

/// The client derives this address from a secret it already holds, months after the
/// allowance was created. An address that moved with the ledger would be unfindable.
#[test]
fn the_address_does_not_depend_on_when_it_is_asked_for() {
    let f = setup();
    let factory = FactoryClient::new(&f.env, &f.factory);
    let before = factory.address_for(&f.owner, &0);

    f.env
        .ledger()
        .set_sequence_number(f.env.ledger().sequence() + 100_000);

    assert_eq!(factory.address_for(&f.owner, &0), before);
}

/// An owner holds more than one allowance, so the index has to reach the salt.
#[test]
fn a_different_index_gives_a_different_address() {
    let f = setup();
    let factory = FactoryClient::new(&f.env, &f.factory);
    assert_ne!(
        factory.address_for(&f.owner, &0),
        factory.address_for(&f.owner, &1)
    );
}

/// The owner in the salt is what stops one person occupying another's address, so it has to
/// reach the salt too.
#[test]
fn a_different_owner_gives_a_different_address() {
    let f = setup();
    let other = Address::generate(&f.env);
    let factory = FactoryClient::new(&f.env, &f.factory);
    assert_ne!(
        factory.address_for(&f.owner, &0),
        factory.address_for(&other, &0)
    );
}

/// The interface picks a free index before submitting, so this is the backstop rather than
/// the normal path. Without it a second create would silently replace the first.
#[test]
fn the_same_index_cannot_be_used_twice() {
    let f = setup();
    let factory = FactoryClient::new(&f.env, &f.factory);
    factory.create(&setup_args(&f), &0);

    assert!(
        factory.try_create(&setup_args(&f), &0).is_err(),
        "an occupied index must not be handed out again"
    );
}

/// An owner holding several allowances is the ordinary case, not an edge one.
#[test]
fn an_owner_can_hold_more_than_one() {
    let f = setup();
    let factory = FactoryClient::new(&f.env, &f.factory);

    let first = factory.create(&setup_args(&f), &0);
    let second = factory.create(&setup_args(&f), &1);

    assert_ne!(first, second);
    assert_eq!(second, factory.address_for(&f.owner, &1));
}
