import { expect } from "chai";
import { ethers } from "hardhat";
import { Group } from "@semaphore-protocol/group";
import { Identity } from "@semaphore-protocol/identity";
import { generateProof } from "@semaphore-protocol/proof";

/**
 * These tests generate REAL zero-knowledge proofs and verify them on-chain
 * against a real Semaphore deployment. They are slow (proving takes seconds)
 * and that is the point — a mocked verifier would prove nothing about whether
 * the integration actually works.
 */
describe("SemaphorePersonhoodGate", () => {
  // Proof generation downloads/compiles artifacts on first run.
  const PROVING_TIMEOUT = 180_000;

  async function deployFixture() {
    const [operator, alice, bob, outsider] = await ethers.getSigners();

    const VerifierFactory = await ethers.getContractFactory("SemaphoreVerifier");
    const verifier = await VerifierFactory.deploy();
    await verifier.waitForDeployment();

    // Semaphore's Merkle tree hashes with Poseidon, which lives in a linked
    // library rather than being inlined — it is far too large for that.
    const PoseidonFactory = await ethers.getContractFactory("PoseidonT3");
    const poseidon = await PoseidonFactory.deploy();
    await poseidon.waitForDeployment();

    const SemaphoreFactory = await ethers.getContractFactory("Semaphore", {
      libraries: { PoseidonT3: await poseidon.getAddress() },
    });
    const semaphore = await SemaphoreFactory.deploy(await verifier.getAddress());
    await semaphore.waitForDeployment();

    const GateFactory = await ethers.getContractFactory("SemaphorePersonhoodGate");
    const gate = await GateFactory.deploy(await semaphore.getAddress(), operator.address);
    await gate.waitForDeployment();

    return { semaphore, gate, operator, alice, bob, outsider };
  }

  /** Build a proof binding the member to this gate and this redeeming address. */
  async function proveFor(
    gate: any,
    group: Group,
    identity: Identity,
    redeemer: string
  ) {
    const gateAddress = await gate.getAddress();
    const scope = BigInt(gateAddress);
    const message = BigInt(redeemer);

    const proof = await generateProof(identity, group, message, scope);
    return {
      merkleTreeDepth: proof.merkleTreeDepth,
      merkleTreeRoot: proof.merkleTreeRoot,
      nullifier: proof.nullifier,
      message: proof.message,
      scope: proof.scope,
      points: proof.points,
    };
  }

  it("creates its own group on deployment", async () => {
    const { gate, semaphore } = await deployFixture();
    const groupId = await gate.groupId();
    // The gate is the group admin, so nobody else can enrol members.
    expect(await semaphore.getGroupAdmin(groupId)).to.equal(await gate.getAddress());
  });

  it("treats an unproven address as not a person", async () => {
    const { gate, alice } = await deployFixture();
    expect(await gate.isPerson(alice.address)).to.equal(false);
  });

  it("accepts a real proof of membership and makes the address eligible", async function () {
    this.timeout(PROVING_TIMEOUT);
    const { gate, operator, alice } = await deployFixture();

    const identity = new Identity();
    await (await gate.connect(operator).enroll(identity.commitment)).wait();

    const group = new Group([identity.commitment]);
    const proof = await proveFor(gate, group, identity, alice.address);

    await expect(gate.connect(alice).proveForScope(proof)).to.emit(gate, "PersonhoodProved");
    expect(await gate.isPerson(alice.address)).to.equal(true);
  });

  it("never learns which member proved", async function () {
    this.timeout(PROVING_TIMEOUT);
    // The property the allowlist gate cannot offer: two enrolled members, one
    // proves, and nothing on-chain says which. A list of everyone willing to
    // vouch for a corruption report is exactly what a subpoena asks for.
    const { gate, operator, alice } = await deployFixture();

    const first = new Identity();
    const second = new Identity();
    await (await gate.connect(operator).enrollMany([first.commitment, second.commitment])).wait();

    const group = new Group([first.commitment, second.commitment]);
    const proof = await proveFor(gate, group, second, alice.address);

    const receipt = await (await gate.connect(alice).proveForScope(proof)).wait();

    // Nothing emitted or stored contains either commitment.
    const encoded = JSON.stringify(receipt?.logs ?? []).toLowerCase();
    expect(encoded).to.not.include(first.commitment.toString(16).toLowerCase());
    expect(encoded).to.not.include(second.commitment.toString(16).toLowerCase());
  });

  it("rejects a proof from a non-member", async function () {
    this.timeout(PROVING_TIMEOUT);
    const { gate, operator, alice } = await deployFixture();

    const member = new Identity();
    const stranger = new Identity();
    await (await gate.connect(operator).enroll(member.commitment)).wait();

    // The stranger builds a group containing only themselves — a valid proof
    // for a tree whose root the gate's group has never had.
    const fakeGroup = new Group([stranger.commitment]);
    const proof = await proveFor(gate, fakeGroup, stranger, alice.address);

    await expect(gate.connect(alice).proveForScope(proof)).to.be.reverted;
    expect(await gate.isPerson(alice.address)).to.equal(false);
  });

  it("refuses to let a proof be redeemed by a different address", async function () {
    this.timeout(PROVING_TIMEOUT);
    // Without the message binding, an observer could lift a pending proof out
    // of the mempool and spend its nullifier as themselves.
    const { gate, operator, alice, bob } = await deployFixture();

    const identity = new Identity();
    await (await gate.connect(operator).enroll(identity.commitment)).wait();

    const group = new Group([identity.commitment]);
    const proofForAlice = await proveFor(gate, group, identity, alice.address);

    await expect(gate.connect(bob).proveForScope(proofForAlice)).to.be.revertedWithCustomError(
      gate,
      "ProofRejected"
    );
  });

  it("spends the nullifier so one membership cannot be redeemed twice", async function () {
    this.timeout(PROVING_TIMEOUT);
    const { gate, operator, alice } = await deployFixture();

    const identity = new Identity();
    await (await gate.connect(operator).enroll(identity.commitment)).wait();

    const group = new Group([identity.commitment]);
    const proof = await proveFor(gate, group, identity, alice.address);

    await (await gate.connect(alice).proveForScope(proof)).wait();
    await expect(gate.connect(alice).proveForScope(proof)).to.be.revertedWithCustomError(
      gate,
      "NullifierAlreadyUsed"
    );
  });

  it("expires eligibility after the TTL", async function () {
    this.timeout(PROVING_TIMEOUT);
    const { gate, operator, alice } = await deployFixture();

    const identity = new Identity();
    await (await gate.connect(operator).enroll(identity.commitment)).wait();
    const group = new Group([identity.commitment]);
    await (await gate.connect(alice).proveForScope(await proveFor(gate, group, identity, alice.address))).wait();

    expect(await gate.isPerson(alice.address)).to.equal(true);

    const ttl = Number(await gate.VERIFICATION_TTL());
    await ethers.provider.send("evm_increaseTime", [ttl + 1]);
    await ethers.provider.send("evm_mine", []);

    expect(await gate.isPerson(alice.address)).to.equal(false);
  });

  it("lets the operator expire an address early", async function () {
    this.timeout(PROVING_TIMEOUT);
    const { gate, operator, alice } = await deployFixture();

    const identity = new Identity();
    await (await gate.connect(operator).enroll(identity.commitment)).wait();
    const group = new Group([identity.commitment]);
    await (await gate.connect(alice).proveForScope(await proveFor(gate, group, identity, alice.address))).wait();

    await (await gate.connect(operator).revokeAddress(alice.address)).wait();
    expect(await gate.isPerson(alice.address)).to.equal(false);
  });

  it("blocks a non-operator from enrolling", async () => {
    const { gate, outsider } = await deployFixture();
    const identity = new Identity();
    await expect(gate.connect(outsider).enroll(identity.commitment)).to.be.revertedWithCustomError(
      gate,
      "NotOperator"
    );
  });

  it("satisfies IPersonhoodGate for the registry", async function () {
    this.timeout(PROVING_TIMEOUT);
    // End to end: a report exists, corroboration is gated, and only an address
    // that proved membership can corroborate — without revealing which member.
    const { gate, operator, alice, bob } = await deployFixture();

    const Registry = await ethers.getContractFactory("ReportRegistry");
    const registry = await Registry.deploy(operator.address);
    await registry.waitForDeployment();
    await (await registry.connect(operator).setPersonhoodGate(await gate.getAddress())).wait();

    const hash = ethers.keccak256(ethers.toUtf8Bytes("bundle"));
    const geohash = ethers.encodeBytes32String("tsj9");
    await (
      await registry.connect(bob).submitReport(hash, "bafycid", 0, 0, geohash, ethers.ZeroHash)
    ).wait();

    // Unproven: refused.
    await expect(registry.connect(alice).corroborate(0)).to.be.revertedWith(
      "ReportRegistry: personhood required"
    );

    const identity = new Identity();
    await (await gate.connect(operator).enroll(identity.commitment)).wait();
    const group = new Group([identity.commitment]);
    await (await gate.connect(alice).proveForScope(await proveFor(gate, group, identity, alice.address))).wait();

    await (await registry.connect(alice).corroborate(0)).wait();
    expect(await registry.corroborationCount(0)).to.equal(1n);
  });
});
