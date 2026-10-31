//! Groth16 proving over BN254, driven by circom artifacts.
//!
//! BN254 and Groth16 are not choices — they are what Semaphore's circuits are
//! compiled for, and what the deployed on-chain verifier checks. Any other
//! curve or proof system here produces proofs the verifier rejects.

use std::collections::HashMap;
use std::fs::File;
use std::io::BufReader;
use std::path::Path;

use ark_bn254::{Bn254, Fr};
use ark_circom::{read_zkey, CircomReduction, WitnessCalculator};
use ark_groth16::Groth16;
use ark_std::rand::thread_rng;
use ark_std::UniformRand;
use num_bigint::BigInt;
use thiserror::Error;
use wasmer::Store;

#[derive(Debug, Error)]
pub enum ProveError {
    #[error("artifact not found: {0}")]
    MissingArtifact(String),
    #[error("could not load witness calculator: {0}")]
    Circuit(String),
    #[error("could not load proving key: {0}")]
    ProvingKey(String),
    #[error("input `{0}` is not a valid field element")]
    BadInput(String),
    #[error("witness generation failed: {0}")]
    Witness(String),
    #[error("proof generation failed: {0}")]
    Proving(String),
}

/// A generated proof, in the shape the on-chain verifier expects.
#[derive(Debug, Clone)]
pub struct Proof {
    /// The 8 field elements Semaphore's `SemaphoreProof.points` carries, as
    /// decimal strings so the FFI layer can hand them to JS without losing
    /// precision — these do not fit in a JS number.
    pub points: [String; 8],
    /// Circuit outputs then public inputs, in witness order.
    pub public_signals: Vec<String>,
}

/// Circuit inputs: signal name to one or more field elements.
pub type Inputs = HashMap<String, Vec<BigInt>>;

/// Generate a Groth16 proof.
///
/// `wasm_path` is circom's witness calculator; `zkey_path` is the proving key,
/// which also carries the constraint matrices — so no separate `.r1cs` is
/// needed, and asking for one is the mistake that produces a bare
/// "invalid magic number" from deep inside the loader.
///
/// This is CPU-bound and slow: seconds on a modern phone, longer on the cheap
/// hardware much of the intended audience actually carries. It must never run
/// on a UI thread, and the caller must show progress rather than a spinner that
/// reads as a hang.
pub fn prove(wasm_path: &str, zkey_path: &str, inputs: Inputs) -> Result<Proof, ProveError> {
    if !Path::new(wasm_path).exists() {
        return Err(ProveError::MissingArtifact(wasm_path.to_string()));
    }
    if !Path::new(zkey_path).exists() {
        return Err(ProveError::MissingArtifact(zkey_path.to_string()));
    }

    let mut store = Store::default();
    let mut calculator = WitnessCalculator::new(&mut store, wasm_path)
        .map_err(|e| ProveError::Circuit(e.to_string()))?;

    let mut reader = BufReader::new(
        File::open(zkey_path).map_err(|e| ProveError::ProvingKey(e.to_string()))?,
    );
    let (params, matrices) =
        read_zkey(&mut reader).map_err(|e| ProveError::ProvingKey(e.to_string()))?;

    let full_assignment = calculator
        .calculate_witness_element::<Fr, _>(&mut store, inputs, false)
        .map_err(|e| ProveError::Witness(e.to_string()))?;

    let num_inputs = matrices.num_instance_variables;
    let num_constraints = matrices.num_constraints;

    // Index 0 of the witness is the constant 1; the public signals follow.
    let public_signals: Vec<String> = full_assignment[1..num_inputs]
        .iter()
        .map(|f| f.to_string())
        .collect();

    let mut rng = thread_rng();
    let r = Fr::rand(&mut rng);
    let s = Fr::rand(&mut rng);

    let reduced = [matrices.a, matrices.b, matrices.c]
        .iter()
        .map(|m| m.clone().into())
        .collect::<Vec<_>>();

    let proof = Groth16::<Bn254, CircomReduction>::create_proof_with_reduction_and_matrices(
        &params,
        r,
        s,
        &reduced,
        num_inputs,
        num_constraints,
        full_assignment.as_slice(),
    )
    .map_err(|e| ProveError::Proving(e.to_string()))?;

    // Verify locally before handing it back.
    //
    // The chain will reject a bad proof anyway, but by then the user has paid
    // a relayer round trip and been told something vague went wrong. Catching
    // it here costs milliseconds against the seconds proving already took, and
    // turns "the transaction failed" into a specific, actionable failure.
    let pvk = ark_groth16::prepare_verifying_key(&params.vk);
    let verified =
        Groth16::<Bn254>::verify_proof(&pvk, &proof, &full_assignment[1..num_inputs])
            .map_err(|e| ProveError::Proving(e.to_string()))?;

    if !verified {
        return Err(ProveError::Proving(
            "the generated proof did not verify against its own key".into(),
        ));
    }

    Ok(Proof {
        points: encode_points(&proof),
        public_signals,
    })
}

/// Flatten a Groth16 proof into the 8 elements the Solidity verifier reads.
///
/// The G2 coordinate ordering is the part that silently breaks: arkworks stores
/// `c0, c1` while the Solidity pairing precompile expects `c1, c0`. Getting it
/// backwards produces a well-formed proof that always fails on-chain, with no
/// error explaining why.
fn encode_points(proof: &ark_groth16::Proof<Bn254>) -> [String; 8] {
    [
        proof.a.x.to_string(),
        proof.a.y.to_string(),
        proof.b.x.c1.to_string(),
        proof.b.x.c0.to_string(),
        proof.b.y.c1.to_string(),
        proof.b.y.c0.to_string(),
        proof.c.x.to_string(),
        proof.c.y.to_string(),
    ]
}

/// Read a proving key without proving, to check an artifact is intact.
///
/// Worth having separately: a truncated download fails deep inside proving with
/// an opaque error, and the caller would rather find out at cache time.
pub fn validate_zkey(zkey_path: &str) -> Result<(), ProveError> {
    let mut reader = BufReader::new(
        File::open(zkey_path).map_err(|e| ProveError::ProvingKey(e.to_string()))?,
    );
    read_zkey(&mut reader).map_err(|e| ProveError::ProvingKey(e.to_string()))?;
    Ok(())
}
