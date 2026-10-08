import { getConfig } from "../app/.server/config";
import { indexSource } from "../app/.server/indexer.server";

const config = getConfig();
const once = process.argv.includes("--once");
const run = () => { try { console.log(indexSource()); } catch (error) { console.error(error); process.exitCode = 1; } };
run();
if (!once) setInterval(run, config.indexIntervalSeconds * 1000);
