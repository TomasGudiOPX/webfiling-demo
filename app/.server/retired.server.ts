export function retired() {
  return Response.json(
    {
      error: {
        code: "feature_retired",
        message: "Este flujo ya no forma parte de la biblioteca de archivos.",
      },
    },
    { status: 410, headers: { "Cache-Control": "private, no-store" } },
  );
}
