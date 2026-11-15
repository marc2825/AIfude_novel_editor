export function browserIsOffline(): boolean { return typeof navigator !== "undefined" && navigator.onLine === false; }
