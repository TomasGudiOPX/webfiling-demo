import { redirect } from "react-router";
export function loader() { return redirect("/file?retired=workflow",{headers:{"Cache-Control":"private, no-store"}}); }
export function action() { return Response.json({error:{code:"feature_retired",message:"Este flujo ya no forma parte de la biblioteca de archivos."}},{status:410,headers:{"Cache-Control":"private, no-store"}}); }
