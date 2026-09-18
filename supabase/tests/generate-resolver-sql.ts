// Rewrites supabase/tests/resolver_differential_test.sql from the
// shared fixture. Run with: npm run gen:resolver-sql
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { OUTPUT_URL, renderResolverSqlTest } from "./resolver-sql.ts";

writeFileSync(OUTPUT_URL, renderResolverSqlTest());
console.log(`wrote ${fileURLToPath(OUTPUT_URL)}`);
