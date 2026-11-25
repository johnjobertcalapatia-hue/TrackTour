/** Leaving the app for another site (e.g. PayMongo checkout). Separate so tests can replace it. */
export const browser = {
  go(url: string) {
    window.location.assign(url)
  },
}
