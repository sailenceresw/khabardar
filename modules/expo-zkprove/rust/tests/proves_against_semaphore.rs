//! Proves the Rust prover produces the same statement the reference JS library
//! does, using real Semaphore artifacts and a real Groth16 proof.
//!
//! A unit test with hand-made inputs would only prove the code runs. What has
//! to be true is stronger: given the inputs `@semaphore-protocol/proof` would
//! use, this must produce the *same public signals* — the same Merkle root and,
//! critically, the same nullifier. A prover that computed a different nullifier
//! would silently let one member signal twice, which is the exact property the
//! on-chain gate depends on.
//!
//! Skipped rather than failed when the fixtures are absent, because they are
//! multi-megabyte downloads that do not belong in the repository. Generate them
//! with `npm run zk:fixtures`.

use std::collections::HashMap;
use std::path::PathBuf;

use khabardar_zkprove::{prove, validate_zkey};

fn fixture_dir() -> Option<PathBuf> {
    let dir = std::env::var("ZK_FIXTURES").ok()?;
    let path = PathBuf::from(dir);
    path.join("inputs.json").exists().then_some(path)
}



#[test]
fn produces_the_same_public_signals_as_the_reference_library() {
    let Some(dir) = fixture_dir() else {
        eprintln!("SKIPPED: set ZK_FIXTURES to a directory containing inputs.json, \
                   reference.json, semaphore-1.wasm and semaphore-1.zkey");
        return;
    };

    let inputs_json = std::fs::read_to_string(dir.join("inputs.json")).unwrap();
    let reference: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(dir.join("reference.json")).unwrap())
            .expect("reference fixture is not valid JSON");

    let wasm = dir.join("semaphore-1.wasm");
    let zkey = dir.join("semaphore-1.zkey");

    // A truncated artifact should be caught here, not deep inside proving.
    validate_zkey(zkey.to_str().unwrap()).expect("zkey did not parse");

    let inputs = khabardar_zkprove::semaphore::inputs_from_json(&inputs_json)
        .expect("fixture inputs did not parse");

    let proof = prove(wasm.to_str().unwrap(), zkey.to_str().unwrap(), inputs)
        .expect("proving failed");

    // Public signals are a deterministic function of the inputs, so they must
    // match the reference exactly regardless of proof randomness.
    let expected_root = reference["merkleTreeRoot"].as_str().unwrap();
    let expected_nullifier = reference["nullifier"].as_str().unwrap();

    assert!(
        proof.public_signals.contains(&expected_root.to_string()),
        "merkle root mismatch: expected {expected_root} among {:?}",
        proof.public_signals
    );
    assert!(
        proof.public_signals.contains(&expected_nullifier.to_string()),
        "nullifier mismatch: expected {expected_nullifier} among {:?}",
        proof.public_signals
    );

    // Eight points, all decimal field elements, none zero.
    assert_eq!(proof.points.len(), 8);
    for (i, p) in proof.points.iter().enumerate() {
        assert!(
            p.chars().all(|c| c.is_ascii_digit()),
            "point {i} is not decimal: {p}"
        );
        assert_ne!(p, "0", "point {i} is zero");
    }

    // The proof itself is checked inside `prove`, which verifies against the
    // key it just used before returning. Comparing points against a reference
    // run would prove nothing anyway — Groth16 is randomised, so two proofs of
    // the same statement differ every time.
}

#[test]
fn reports_a_missing_artifact_rather_than_panicking() {
    let inputs: HashMap<String, Vec<num_bigint::BigInt>> = HashMap::new();
    let err = prove("/nonexistent.wasm", "/nonexistent.zkey", inputs).unwrap_err();
    assert!(
        matches!(err, khabardar_zkprove::ProveError::MissingArtifact(_)),
        "got {err:?}"
    );
}
