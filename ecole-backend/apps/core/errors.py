from rest_framework.views import exception_handler as drf_handler


def exception_handler(exc, context):
    """Réponses d'erreur homogènes : toujours un champ `detail` lisible, `errors` pour le détail par champ."""
    resp = drf_handler(exc, context)
    if resp is None:
        return resp
    data = resp.data
    if isinstance(data, dict) and "detail" in data and len(data) == 1:
        resp.data = {"detail": str(data["detail"])}
    elif isinstance(data, dict):
        first = next((v for v in data.values()), "Requête invalide.")
        while isinstance(first, (list, tuple)) and first:
            first = first[0]
        resp.data = {"detail": str(first) if not isinstance(first, dict) else "Requête invalide.", "errors": data}
    elif isinstance(data, list):
        resp.data = {"detail": str(data[0]) if data else "Requête invalide."}
    return resp


def field_error(errors: dict, status: int = 400):
    """Réponse d'erreur au même format que celles du gestionnaire d'exceptions : `detail` lisible + `errors` par champ."""
    from rest_framework.response import Response
    first = next(iter(errors.values()))
    while isinstance(first, (list, tuple)) and first:
        first = first[0]
    return Response({"detail": str(first), "errors": errors}, status=status)
