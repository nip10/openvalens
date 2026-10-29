// Asks the e2e helper for the sign-in link the server just printed (dev
// magic-link sink) and hands back the openvalens:// callback it redirects to.
const response = http.get(`${HELPER_URL}/magic-link`);
if (response.status !== 200) {
  throw new Error(`helper /magic-link answered ${response.status}: ${response.body}`);
}
output.link = response.body;
