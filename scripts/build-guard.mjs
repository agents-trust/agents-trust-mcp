// A wallet belongs only in the runtime launcher, never in a build process.
// Check presence without logging or otherwise inspecting the value.
if (process.env.AGENTS_TRUST_WALLET_PRIVATE_KEY !== undefined) {
  throw new Error('Build refused: remove AGENTS_TRUST_WALLET_PRIVATE_KEY from the build process.');
}
