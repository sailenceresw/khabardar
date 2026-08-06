/**
 * Produce real Semaphore circuit inputs plus a reference proof, so the Rust
 * prover can be checked against the library everyone else uses.
 */
import { Identity } from "@semaphore-protocol/identity";
import { Group } from "@semaphore-protocol/group";
import { generateProof, verifyProof } from "@semaphore-protocol/proof";
import fs from "node:fs";
import path from "node:path";

const OUT = path.dirname(new URL(import.meta.url).pathname.replace(/^\//, ""));

// Deterministic identity so the test is reproducible.
const identity = new Identity("khabardar-test-seed");
const group = new Group([identity.commitment]);

const message = 42n;
const scope = 7n;

const proof = await generateProof(identity, group, message, scope, 1);
const ok = await verifyProof(proof);

// Rebuild the circuit inputs exactly as the library does, so Rust proves the
// same statement rather than a similar-looking one.
const merkleProof = group.generateMerkleProof(0);
const depth = 1;
const indices = [];
const siblings = [...merkleProof.siblings];
for (let i = 0; i < depth; i += 1) {
  indices.push((merkleProof.index >> i) & 1);
  if (siblings[i] === undefined) siblings[i] = 0n;
}

const inputs = {
  secret: identity.secretScalar.toString(),
  merkleProofLength: merkleProof.siblings.length.toString(),
  merkleProofIndices: indices.map(String),
  merkleProofSiblings: siblings.map(String),
  // The library hashes scope and message before they reach the circuit; the
  // proof object carries the hashed forms it actually used.
  message: proof.message.toString(),
  scope: proof.scope.toString(),
};

fs.writeFileSync(path.join(OUT, "inputs.json"), JSON.stringify(inputs, null, 2));
fs.writeFileSync(
  path.join(OUT, "reference.json"),
  JSON.stringify(
    {
      merkleTreeRoot: proof.merkleTreeRoot.toString(),
      nullifier: proof.nullifier.toString(),
      message: proof.message.toString(),
      scope: proof.scope.toString(),
      points: proof.points.map(String),
      verifies: ok,
    },
    null,
    2
  )
);

console.log("reference proof verifies:", ok);
console.log("merkleTreeRoot:", proof.merkleTreeRoot.toString());
console.log("nullifier:     ", proof.nullifier.toString());
console.log("wrote inputs.json + reference.json");
