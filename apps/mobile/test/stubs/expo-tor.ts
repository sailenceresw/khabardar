export * from "./native";
import { expoTorStub } from "./native";
export const setLauncherDisguise = expoTorStub.setLauncherDisguise;
export const startTor = expoTorStub.startTor;
export const stopTor = expoTorStub.stopTor;
export const isTorAvailable = expoTorStub.isTorAvailable;
export const getStatus = expoTorStub.getStatus;
export class TorUnavailableError extends Error {}
export const torRequest = async () => { throw new TorUnavailableError("stub"); };
export const newCircuit = async () => undefined;
