import { NexApi } from "../nex/api";
import { resumeSession, signIn, signOut } from "../nex/auth";
import { apiUrlFor, type Runtime } from "./common";

export async function login(runtime: Runtime): Promise<number> {
  const { ui } = runtime;
  ui.intro("Nex Login");
  const api = new NexApi(apiUrlFor(runtime.flags), runtime.fetch);
  const existing = await resumeSession(api);
  if (existing) {
    ui.outro(`Already signed in as ${existing.user.email}.`);
    return 0;
  }
  const session = await signIn(api, ui, { open: runtime.openBrowser, printOnly: runtime.flags.noBrowser });
  ui.outro(`Signed in as ${session.user.email}.`);
  return 0;
}

export async function logout(runtime: Runtime): Promise<number> {
  const { ui } = runtime;
  ui.intro("Nex Logout");
  const signedOut = await signOut(new NexApi(apiUrlFor(runtime.flags), runtime.fetch));
  ui.outro(signedOut ? "Signed out. The saved sign-in was revoked and removed." : "You weren't signed in.");
  return 0;
}
