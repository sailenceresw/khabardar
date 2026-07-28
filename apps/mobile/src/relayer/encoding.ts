import { encodeFunctionData, stringToHex } from "viem";
import { REPORT_REGISTRY_ABI } from "@khabardar/shared";

export function geohashToBytes32(geohash: string): `0x${string}` {
  return stringToHex(geohash, { size: 32 });
}

export function encodeSubmitReportCall(
  reportHash: `0x${string}`,
  cid: string,
  category: number,
  visibility: number,
  coarseGeohash: string,
  entityTag: `0x${string}`
): `0x${string}` {
  return encodeFunctionData({
    abi: REPORT_REGISTRY_ABI,
    functionName: "submitReport",
    args: [reportHash, cid, category, visibility, geohashToBytes32(coarseGeohash), entityTag],
  });
}

export function encodeCorroborateCall(reportId: number): `0x${string}` {
  return encodeFunctionData({
    abi: REPORT_REGISTRY_ABI,
    functionName: "corroborate",
    args: [BigInt(reportId)],
  });
}
