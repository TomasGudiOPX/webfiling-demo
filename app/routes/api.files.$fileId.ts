import type { LoaderFunctionArgs } from "react-router";
import { fileApi } from "../.server/library-api.server";
export function loader({request,params}:LoaderFunctionArgs) { return fileApi(request,params.fileId ?? ""); }
