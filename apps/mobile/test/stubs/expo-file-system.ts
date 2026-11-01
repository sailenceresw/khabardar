/** Nothing under test touches the filesystem; these exist so imports resolve. */
export const documentDirectory = "file:///tmp/khabardar-test/";
export const cacheDirectory = "file:///tmp/khabardar-test/cache/";
export enum EncodingType { UTF8 = "utf8", Base64 = "base64" }
export const getInfoAsync = async () => ({ exists: false, size: 0, uri: "" });
export const readAsStringAsync = async () => "";
export const writeAsStringAsync = async () => undefined;
export const deleteAsync = async () => undefined;
export const makeDirectoryAsync = async () => undefined;
export const copyAsync = async () => undefined;
export const moveAsync = async () => undefined;
export const downloadAsync = async () => ({ uri: "", status: 200 });
export default {
  documentDirectory, cacheDirectory, EncodingType, getInfoAsync,
  readAsStringAsync, writeAsStringAsync, deleteAsync, makeDirectoryAsync,
  copyAsync, moveAsync, downloadAsync,
};
