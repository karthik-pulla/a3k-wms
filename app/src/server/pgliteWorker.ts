// PREVIEW ONLY: runs one of the preview's databases for every tab of this browser (PGlite's shared mode). One tab
// holds the database; the others send it their queries, so two tabs are two people on the same warehouse.
import { PGlite } from "@electric-sql/pglite";
import { worker } from "@electric-sql/pglite/worker";

void worker({ init: async options => new PGlite(options.dataDir) });
