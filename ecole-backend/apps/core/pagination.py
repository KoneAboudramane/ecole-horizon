from rest_framework.pagination import PageNumberPagination


class BigPages(PageNumberPagination):
    """Listes volumineuses (absences, paiements) : 500 par page par défaut, 1000 au plus (`?page_size=`)."""

    page_size = 500
    page_size_query_param = "page_size"
    max_page_size = 1000
