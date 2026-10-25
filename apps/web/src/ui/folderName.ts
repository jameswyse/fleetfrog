export function folderName(path: string): string {
  return path.split("/").findLast((part) => part !== "") ?? path;
}
