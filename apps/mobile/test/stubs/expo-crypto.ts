export * from "./native";
import { cryptoStub } from "./native";
export const getRandomBytes = cryptoStub.getRandomBytes;
export const CryptoDigestAlgorithm = cryptoStub.CryptoDigestAlgorithm;
export const digest = cryptoStub.digest;
export default cryptoStub;
