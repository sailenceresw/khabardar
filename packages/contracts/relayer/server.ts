import * as http from "http";
import * as path from "path";
import * as dotenv from "dotenv";
import { JsonRpcProvider, Wallet, formatEther } from "ethers";
import { ALLOWED_CHAIN_IDS, createRelayer, type Relayer } from "./relayer";

/** Larger than any real submitReport request, small enough to refuse junk early. */
const MAX_BODY_BYTES = 16 * 1024;

/**
 * Wrap a relayer in a tiny HTTP server: POST /relay and GET /health.
 *
 * It does not log request bodies, sender addresses or client IPs. A reporter's
 * IP is the one thing this service sees that the chain does not, and it should
 * not be written anywhere.
 */
export function createServer(relayer: Relayer, info: Record<string, unknown>) {
  return http.createServer((req, res) => {
    // The web preview calls this from another origin.
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };

    if (req.method === "OPTIONS") return send(204, {});
    if (req.method === "GET" && req.url === "/health") return send(200, { ok: true, ...info });
    if (req.method !== "POST" || req.url !== "/relay") return send(404, { error: "not found" });

    let size = 0;
    const chunks: Buffer[] = [];
    let tooLarge = false;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      // Past the limit, keep reading but stop storing, so the reply still gets out.
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", async () => {
      if (tooLarge) return send(413, { error: "body too large" });
      let parsed: unknown;
      try {
        parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        return send(400, { error: "body must be JSON" });
      }
      const result = await relayer.relay(parsed);
      send(result.status, result.body);
    });
  });
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}. Set it in the repo root .env (see .env.example).`);
    process.exit(1);
  }
  return value;
}

async function main() {
  dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

  const rpcUrl = process.env.LINEA_SEPOLIA_RPC_URL || "https://rpc.sepolia.linea.build";
  const provider = new JsonRpcProvider(rpcUrl);
  const { chainId } = await provider.getNetwork();
  if (!ALLOWED_CHAIN_IDS.has(chainId)) {
    console.error(`Refusing to run on chain ${chainId}. This relayer is for Linea Sepolia (59141) only.`);
    process.exit(1);
  }

  const wallet = new Wallet(required("RELAYER_PRIVATE_KEY"), provider);
  const forwarderAddress = required("EXPO_PUBLIC_FORWARDER_ADDRESS");
  const registryAddress = required("EXPO_PUBLIC_REPORT_REGISTRY_ADDRESS");
  const relayer = createRelayer({ wallet, forwarderAddress, registryAddress });

  const port = Number(process.env.RELAYER_PORT || 8787);
  const info = { chainId: chainId.toString(), forwarder: forwarderAddress, registry: registryAddress };
  createServer(relayer, info).listen(port, () => {
    console.log(`Relayer listening on http://localhost:${port}`);
  });

  // The balance is the one thing worth watching: when it runs out, reports stop.
  const balance = await provider.getBalance(wallet.address);
  console.log(`Relayer wallet ${wallet.address} holds ${formatEther(balance)} ETH on chain ${chainId}.`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
