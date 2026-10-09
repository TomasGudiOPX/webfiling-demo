import type { LoaderFunctionArgs } from "react-router";
import { projectsApi } from "../.server/library-api.server";
export function loader({request}:LoaderFunctionArgs) { return projectsApi(request); }
