import { getConfig } from "../app/.server/config";
import { openDatabase, seedFixtures } from "../app/.server/db.server";

const config = getConfig();
seedFixtures(openDatabase(config.databasePath));
console.log(`Fixture database ready at ${config.databasePath}`);
