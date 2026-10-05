import "varlock/auto-load";
import { ENV } from "./env";
import { validateProductionSecrets } from "./validate-production-secrets";

validateProductionSecrets(ENV);

export { ENV };
