export { secureStoreStub as default } from "./native";
export * from "./native";
import { secureStoreStub } from "./native";
export const getItemAsync = secureStoreStub.getItemAsync;
export const setItemAsync = secureStoreStub.setItemAsync;
export const deleteItemAsync = secureStoreStub.deleteItemAsync;
