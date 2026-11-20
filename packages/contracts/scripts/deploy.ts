import * as fs from "fs";
import * as path from "path";
import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying KhabardarForwarder and ReportRegistry");
  console.log("  deployer / initial admin + first juror:", deployer.address);

  // The forwarder goes first because the registry takes its address as an
  // immutable constructor argument: it is the only contract allowed to relay a
  // reporter's signed submission.
  const Forwarder = await ethers.getContractFactory("KhabardarForwarder");
  const forwarder = await Forwarder.deploy();
  await forwarder.waitForDeployment();
  const forwarderAddress = await forwarder.getAddress();
  console.log("  KhabardarForwarder deployed to:", forwarderAddress);

  const ReportRegistry = await ethers.getContractFactory("ReportRegistry");
  const registry = await ReportRegistry.deploy(deployer.address, forwarderAddress);
  await registry.waitForDeployment();

  const address = await registry.getAddress();
  const network = await ethers.provider.getNetwork();

  console.log("  ReportRegistry deployed to:", address);
  console.log("  chainId:", network.chainId.toString());

  // A one-juror jury is exactly the single-moderator centralization the jury
  // replaces, so say so loudly rather than letting a deployment quietly ship
  // with it. Deployments are cheap; a captured review process is not.
  console.log("\n⚠️  This deployment has ONE juror (the deployer).");
  console.log("    Seat at least three independent jurors before trusting any verdict:");
  console.log(`      registry.setJuror(<address>, true)   // quorum weight is 3`);
  console.log("    And point corroboration at a personhood gate before mainnet:");
  console.log(`      registry.setPersonhoodGate(<gate>)   // unset == anyone can corroborate`);

  const outDir = path.resolve(__dirname, "../deployments");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, `${network.chainId}.json`),
    JSON.stringify(
      {
        address,
        forwarder: forwarderAddress,
        chainId: Number(network.chainId),
        deployer: deployer.address,
        deployedAt: new Date().toISOString(),
      },
      null,
      2
    )
  );

  console.log("\nAdd this to your .env:");
  console.log(`EXPO_PUBLIC_REPORT_REGISTRY_ADDRESS=${address}`);
  console.log(`EXPO_PUBLIC_FORWARDER_ADDRESS=${forwarderAddress}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
