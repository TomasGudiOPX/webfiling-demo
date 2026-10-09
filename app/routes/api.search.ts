import type { LoaderFunctionArgs } from "react-router";
import { searchApi } from "../.server/library-api.server";
export function loader({request}:LoaderFunctionArgs) { return searchApi(request); }
