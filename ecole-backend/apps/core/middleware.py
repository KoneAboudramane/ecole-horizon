from .tenancy import UNSET, reset_current, reset_cursus, set_current, set_cursus


class TenantMiddleware:
    """Garantit que le contexte d'établissement posé pendant une requête ne déborde jamais sur la suivante."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        token, ctoken = set_current(UNSET), set_cursus(UNSET)
        try:
            return self.get_response(request)
        finally:
            reset_cursus(ctoken)
            reset_current(token)
