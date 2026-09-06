#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    Address, Env,
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
}

fn setup() -> Fixture {
    let env = Env::default();
    env.mock_all_auths();

    let wasm = env.deployer().upload_contract_wasm(allowance::WASM);
    let factory = env.register(Factory, (wasm,));

    Fixture {
        owner: Address::generate(&env),
        factory,
        env,
    }
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
