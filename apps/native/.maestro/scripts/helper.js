// Calls one e2e helper endpoint: HELPER_PATH (e.g. "/sign-up?email=x@example.com").
const response = http.get(`${HELPER_URL}${HELPER_PATH}`);
if (response.status !== 200) {
  throw new Error(`helper ${HELPER_PATH} answered ${response.status}: ${response.body}`);
}
output.helper = response.body;
