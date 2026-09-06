#![cfg(test)]

use super::*;
use soroban_sdk::Env;

/// The allowance is deployed by hash, so its built artifact is what these tests need, not
/// the crate. `contractimport!` resolves its path from CARGO_MANIFEST_DIR.
mod allowance {
    // The generated client covers __check_auth, whose signature names Context.
    use soroban_sdk::auth::Context;

    soroban_sdk::contractimport!(file = "../target/wasm32v1-none/release/allowance.wasm");
}

#[test]
fn the_factory_deploys() {
    let env = Env::default();
    let wasm = env.deployer().upload_contract_wasm(allowance::WASM);
    env.register(Factory, (wasm,));
}
