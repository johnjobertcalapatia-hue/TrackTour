/**
 * Leave the app for an external page (e.g. PayMongo's hosted checkout).
 * Kept in one place so tests can mock it (jsdom cannot spy on location).
 */
export function openExternalPage(url: string): void {
  window.location.assign(url)
}
