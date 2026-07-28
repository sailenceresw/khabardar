import { encodeFunctionData, stringToHex } from "viem";
import { REPORT_REGISTRY_ABI } from "@khabardar/shared";

export function geohashToBytes32(geohash: string): `0x${string}` {
  return stringToHex(geohash, { size: 32 });
}

export function encodeSubmitReportCall(
  reportHash: `0x${string}`,
  category: number,
  coarseGeohash: string
): `0x${string}` {
  return encodeFunctionData({
    abi: REPORT_REGISTRY_ABI,
    functionName: "submitReport",
    args: [reportHash, category, geohashToBytes32(coarseGeohash)],
  });
}
