//! Marshalling between the JSON the client sends and the circuit's signals.

use num_bigint::BigInt;
use serde::Deserialize;
use thiserror::Error;

use crate::prover::{Inputs, Proof};

#[derive(Debug, Error)]
pub enum InputError {
    #[error("inputs were not valid JSON: {0}")]
    Json(String),
    #[error("signal `{0}` is not a decimal field element")]
    NotAFieldElement(String),
}

/// Circuit inputs as the client sends them.
///
/// Every value is a decimal string, never a JSON number. Field elements are up
/// to 254 bits and a JS number carries 53 — passing them as numbers would
/// silently round the identity secret into a different one, producing a proof
/// for a member who does not exist. The type is a string here so that cannot
/// happen by accident.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SemaphoreInputs {
    pub secret: String,
    pub merkle_proof_length: String,
    pub merkle_proof_indices: Vec<String>,
    pub merkle_proof_siblings: Vec<String>,
    pub message: String,
    pub scope: String,
}

pub fn inputs_from_json(json: &str) -> Result<Inputs, InputError> {
    let raw: SemaphoreInputs =
        serde_json::from_str(json).map_err(|e| InputError::Json(e.to_string()))?;

    let mut inputs = Inputs::new();
    inputs.insert("secret".into(), vec![parse(&raw.secret, "secret")?]);
    inputs.insert(
        "merkleProofLength".into(),
        vec![parse(&raw.merkle_proof_length, "merkleProofLength")?],
    );
    inputs.insert(
        "merkleProofIndices".into(),
        parse_all(&raw.merkle_proof_indices, "merkleProofIndices")?,
    );
    inputs.insert(
        "merkleProofSiblings".into(),
        parse_all(&raw.merkle_proof_siblings, "merkleProofSiblings")?,
    );
    inputs.insert("message".into(), vec![parse(&raw.message, "message")?]);
    inputs.insert("scope".into(), vec![parse(&raw.scope, "scope")?]);

    Ok(inputs)
}

fn parse(value: &str, name: &str) -> Result<BigInt, InputError> {
    value
        .parse::<BigInt>()
        .map_err(|_| InputError::NotAFieldElement(name.to_string()))
}

fn parse_all(values: &[String], name: &str) -> Result<Vec<BigInt>, InputError> {
    values.iter().map(|v| parse(v, name)).collect()
}

pub fn proof_to_json(proof: &Proof) -> String {
    let points = proof
        .points
        .iter()
        .map(|p| quote(p))
        .collect::<Vec<_>>()
        .join(",");
    let signals = proof
        .public_signals
        .iter()
        .map(|s| quote(s))
        .collect::<Vec<_>>()
        .join(",");

    format!(r#"{{"points":[{points}],"publicSignals":[{signals}]}}"#)
}

pub fn error_to_json(message: &str) -> String {
    format!(r#"{{"error":{}}}"#, quote(message))
}

fn quote(s: &str) -> String {
    serde_json::to_string(s).unwrap_or_else(|_| "\"\"".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"{
        "secret": "1234567890",
        "merkleProofLength": "1",
        "merkleProofIndices": ["0"],
        "merkleProofSiblings": ["999"],
        "message": "42",
        "scope": "7"
    }"#;

    #[test]
    fn parses_every_signal_the_circuit_declares() {
        let inputs = inputs_from_json(SAMPLE).unwrap();
        for signal in [
            "secret",
            "merkleProofLength",
            "merkleProofIndices",
            "merkleProofSiblings",
            "message",
            "scope",
        ] {
            assert!(inputs.contains_key(signal), "missing signal {signal}");
        }
    }

    #[test]
    fn keeps_full_precision_on_large_field_elements() {
        // A real identity secret exceeds what a JS number can hold. If this
        // round-trips lossily the proof is for a different member entirely.
        let big = "21888242871839275222246405745257275088548364400416034343698204186575808495616";
        let json = SAMPLE.replace("1234567890", big);

        let inputs = inputs_from_json(&json).unwrap();
        assert_eq!(inputs["secret"][0].to_string(), big);
    }

    #[test]
    fn rejects_a_non_numeric_signal() {
        let json = SAMPLE.replace("\"1234567890\"", "\"not-a-number\"");
        assert!(matches!(
            inputs_from_json(&json),
            Err(InputError::NotAFieldElement(_))
        ));
    }

    #[test]
    fn rejects_malformed_json() {
        assert!(matches!(inputs_from_json("{"), Err(InputError::Json(_))));
    }

    #[test]
    fn serialises_a_proof_as_strings_not_numbers() {
        let proof = Proof {
            points: std::array::from_fn(|i| format!("{}", 100 + i)),
            public_signals: vec!["7".into(), "8".into()],
        };
        let json = proof_to_json(&proof);

        // Quoted, so a 254-bit value survives JSON.parse intact.
        assert!(json.contains(r#""points":["100","101""#), "got {json}");
        assert!(json.contains(r#""publicSignals":["7","8"]"#), "got {json}");
    }

    #[test]
    fn escapes_error_messages() {
        let json = error_to_json(r#"broke "badly""#);
        assert!(json.starts_with(r#"{"error":"#));
        assert!(serde_json::from_str::<serde_json::Value>(&json).is_ok());
    }
}
