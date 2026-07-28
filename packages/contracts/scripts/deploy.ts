import * as fs from "fs";
import * as path from "path";
import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying ReportRegistry");
  console.log("  deployer / initial moderator:", deployer.address);

  const ReportRegistry = await ethers.getContractFactory("ReportRegistry");
  const registry = await ReportRegistry.deploy(deployer.address);
  await registry.waitForDeployment();

  const address = await registry.getAddress();
  const network = await ethers.provider.getNetwork();

  console.log("  ReportRegistry deployed to:", address);
  console.log("  chainId:", network.chainId.toString());

  const outDir = path.resolve(__dirname, "../deployments");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, `${network.chainId}.json`),
    JSON.stringify(
      {
        address,
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
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
