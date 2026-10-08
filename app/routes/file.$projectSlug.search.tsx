import { redirect } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

export function loader({ params, request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  throw redirect(`/file/${params.projectSlug}${url.search}`);
}

export async function action({ request, params }: ActionFunctionArgs) {
  const url = new URL(request.url);
  throw redirect(`/file/${params.projectSlug}${url.search}`);
}
